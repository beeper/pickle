import { EventEmitter } from "node:events";
import type {
  MatrixCore,
  MatrixCoreEvent,
  MatrixCoreHost,
  MatrixMessageEvent,
  MatrixRoomInfo,
  MatrixStateStore,
} from "better-matrix-js";
import type { LoginRequest, LoginResponse } from "./@types/auth";
import type { ICreateClientOpts, ISendEventResponse, IStartClientOpts, UploadResponse } from "./@types/client";
import { EventType, MsgType } from "./@types/event";
import { MatrixHttpApiError } from "./http-api/errors";
import { getHttpUriForMxc, mxcUrlToHttp } from "./content-repo";
import { toMatrixEventJson } from "./event-mapper";
import { ClientEvent } from "./events/client";
import { SyncState } from "./sync";
import { MatrixEvent } from "./models/event";
import { Room, RoomEvent } from "./models/room";
import { User } from "./models/user";
import { normalizeBaseUrl, uint8ToBase64 } from "./utils";

export class MatrixClient extends EventEmitter {
  readonly baseUrl: string;
  readonly credentials: {
    accessToken: string | undefined;
    deviceId: string | undefined;
    userId: string | undefined;
  } = { accessToken: undefined, deviceId: undefined, userId: undefined };
  readonly store: unknown;
  #core: MatrixCore | undefined;
  #fetch: typeof fetch;
  #rooms = new Map<string, Room>();
  #syncTimer: ReturnType<typeof setTimeout> | undefined;
  #syncing = false;
  #stopped = true;
  #unsub: (() => void) | undefined;
  #pickleKey: string | undefined;
  #stateStore: MatrixStateStore | undefined;
  #loadCore: ((host: MatrixCoreHost) => Promise<MatrixCore>) | undefined;

  constructor(opts: ICreateClientOpts) {
    super();
    this.baseUrl = normalizeBaseUrl(opts.baseUrl ?? opts.homeserverUrl);
    this.credentials.accessToken = opts.accessToken;
    this.credentials.deviceId = opts.deviceId;
    this.credentials.userId = opts.userId;
    this.store = opts.store;
    this.#fetch = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.#loadCore = opts.loadCore;
    this.#pickleKey = opts.pickleKey;
    this.#stateStore = opts.stateStore;
  }

  getUserId(): string | undefined {
    return this.credentials.userId;
  }

  getDeviceId(): string | undefined {
    return this.credentials.deviceId;
  }

  getAccessToken(): string | undefined {
    return this.credentials.accessToken;
  }

  getHomeserverUrl(): string {
    return this.baseUrl;
  }

  async login(type: string, data: Partial<LoginRequest> = {}): Promise<LoginResponse> {
    const body: LoginRequest = { ...data, type };
    if (type === "m.login.password" && data.user && !data.identifier) {
      body.identifier = { type: "m.id.user", user: data.user };
    }
    const response = await this.http<LoginResponse>("POST", "/_matrix/client/v3/login", body, false);
    this.credentials.accessToken = response.access_token;
    this.credentials.deviceId = response.device_id;
    this.credentials.userId = response.user_id;
    await this.ensureCore();
    return response;
  }

  async startClient(opts: IStartClientOpts = {}): Promise<void> {
    await this.ensureCore();
    this.#stopped = false;
    this.emitSync(SyncState.Syncing, null);
    await this.refreshJoinedRooms();
    await this.syncOnce();
    this.emitSync(SyncState.Prepared, SyncState.Syncing);
    this.scheduleSync(opts.pollTimeout ?? 30_000);
  }

  stopClient(): void {
    this.#stopped = true;
    if (this.#syncTimer) clearTimeout(this.#syncTimer);
    this.#syncTimer = undefined;
    this.emitSync(SyncState.Stopped, null);
  }

  async clearStores(): Promise<void> {
    this.#rooms.clear();
  }

  getRoom(roomId: string | undefined): Room | null {
    if (!roomId) return null;
    return this.#rooms.get(roomId) ?? null;
  }

  getRooms(): Room[] {
    return [...this.#rooms.values()];
  }

  getUser(userId: string): User {
    return new User(userId);
  }

  async getProfileInfo(userId: string): Promise<{ avatar_url?: string; displayname?: string }> {
    const core = await this.ensureCore();
    const user = await core.getUser({ userId });
    const profile: { avatar_url?: string; displayname?: string } = {};
    if (user.avatarUrl) profile.avatar_url = user.avatarUrl;
    if (user.displayName) profile.displayname = user.displayName;
    return profile;
  }

  async getJoinedRooms(): Promise<{ joined_rooms: string[] }> {
    const core = await this.ensureCore();
    const result = await core.fetchJoinedRooms();
    return { joined_rooms: result.roomIds };
  }

  async joinRoom(roomIdOrAlias: string): Promise<Room> {
    const core = await this.ensureCore();
    const result = await core.joinRoom({ roomIdOrAlias });
    return this.upsertRoom(result.roomId);
  }

  async leave(roomId: string): Promise<Record<string, never>> {
    const core = await this.ensureCore();
    await core.leaveRoom({ roomId });
    this.#rooms.delete(roomId);
    this.emit(ClientEvent.DeleteRoom, roomId);
    return {};
  }

  async invite(roomId: string, userId: string): Promise<Record<string, never>> {
    const core = await this.ensureCore();
    await core.inviteUser({ roomId, userId });
    return {};
  }

  async sendTextMessage(roomId: string, body: string): Promise<ISendEventResponse> {
    return this.sendMessage(roomId, { body, msgtype: MsgType.Text });
  }

  async sendNotice(roomId: string, body: string): Promise<ISendEventResponse> {
    return this.sendMessage(roomId, { body, msgtype: MsgType.Notice });
  }

  async sendMessage(roomId: string, content: Record<string, any>): Promise<ISendEventResponse> {
    const core = await this.ensureCore();
    const result = await core.postMessage({
      body: String(content.body ?? ""),
      content,
      formattedBody: content.formatted_body,
      msgtype: content.msgtype ?? MsgType.Text,
      roomId,
    });
    return { event_id: result.eventId };
  }

  async sendEvent(
    roomId: string,
    eventType: string,
    content: Record<string, any>
  ): Promise<ISendEventResponse> {
    if (eventType === EventType.RoomMessage) return this.sendMessage(roomId, content);
    const core = await this.ensureCore();
    const result = await core.sendEphemeralEvent({ content, eventType, roomId });
    return { event_id: result.eventId };
  }

  async redactEvent(roomId: string, eventId: string, _txnId?: string, opts?: { reason?: string }): Promise<{}> {
    const core = await this.ensureCore();
    const deleteOptions: Parameters<MatrixCore["deleteMessage"]>[0] = { messageId: eventId, roomId };
    if (opts?.reason) deleteOptions.reason = opts.reason;
    await core.deleteMessage(deleteOptions);
    return {};
  }

  async sendReadReceipt(event: MatrixEvent): Promise<{}> {
    const core = await this.ensureCore();
    const roomId = event.getRoomId();
    const eventId = event.getId();
    if (!roomId || !eventId) throw new Error("sendReadReceipt requires an event with room_id and event_id");
    await core.markRead({ eventId, roomId });
    return {};
  }

  async setRoomReadMarkers(roomId: string, eventId: string): Promise<{}> {
    const core = await this.ensureCore();
    await core.markRead({ eventId, roomId });
    return {};
  }

  async sendTyping(roomId: string, typing: boolean, timeoutMs = 30_000): Promise<{}> {
    const core = await this.ensureCore();
    await core.setTyping({ roomId, timeoutMs, typing });
    return {};
  }

  async sendReaction(roomId: string, eventId: string, key: string): Promise<ISendEventResponse> {
    const core = await this.ensureCore();
    const result = await core.addReaction({ emoji: key, messageId: eventId, roomId });
    return { event_id: result.eventId };
  }

  async uploadContent(
    file: Blob | Uint8Array | ArrayBuffer,
    opts: { name?: string; type?: string } = {}
  ): Promise<UploadResponse> {
    const core = await this.ensureCore();
    const bytes = file instanceof Blob ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(file);
    const uploadOptions: Parameters<MatrixCore["uploadMedia"]>[0] = {
      bytesBase64: uint8ToBase64(bytes),
    };
    if (opts.type) uploadOptions.contentType = opts.type;
    if (opts.name) uploadOptions.filename = opts.name;
    const result = await core.uploadMedia(uploadOptions);
    return { content_uri: result.contentUri };
  }

  mxcUrlToHttp(mxcUrl: string, width?: number, height?: number, resizeMethod?: string): string | null {
    return mxcUrlToHttp(this.baseUrl, mxcUrl, width, height, resizeMethod);
  }

  async fetchRoomEvent(roomId: string, eventId: string): Promise<Record<string, any>> {
    const core = await this.ensureCore();
    const result = await core.fetchMessage({ messageId: eventId, roomId });
    if (!result.message) throw new Error(`Event ${eventId} not found in ${roomId}`);
    return toMatrixEventJson(result.message);
  }

  async scrollback(room: Room, limit = 30): Promise<Room> {
    const core = await this.ensureCore();
    const result = await core.fetchMessages({ direction: "backward", limit, roomId: room.roomId });
    const events = result.messages.map(
      (message: MatrixMessageEvent) => new MatrixEvent(toMatrixEventJson(message))
    );
    room.timeline.unshift(...events);
    return room;
  }

  async http<T>(
    method: string,
    path: string,
    body?: unknown,
    authenticated = true
  ): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (authenticated && this.credentials.accessToken) {
      headers.authorization = `Bearer ${this.credentials.accessToken}`;
    }
    const init: RequestInit = {
      headers,
      method,
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await this.#fetch(new URL(path, this.baseUrl), init);
    const text = await response.text();
    const json = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new MatrixHttpApiError(response.status, json);
    }
    return json as T;
  }

  async ensureCore(): Promise<MatrixCore> {
    if (this.#core) return this.#core;
    const accessToken = this.credentials.accessToken;
    if (!accessToken) throw new Error("Matrix access token is required");
    const host: MatrixCoreHost = {
      fetch: this.#fetch,
    };
    if (this.#stateStore) host.state = this.#stateStore;
    const core = await this.loadCore(host);
    const initOptions: Parameters<MatrixCore["init"]>[0] = {
      accessToken,
      homeserverUrl: this.baseUrl,
      initialSyncMode: "persisted",
    };
    if (this.credentials.deviceId) initOptions.deviceId = this.credentials.deviceId;
    if (this.#pickleKey) initOptions.pickleKey = this.#pickleKey;
    if (this.credentials.userId) initOptions.userId = this.credentials.userId;
    const whoami = await core.init(initOptions);
    this.credentials.deviceId = whoami.deviceId;
    this.credentials.userId = whoami.userId;
    this.#unsub = core.onEvent((event) => this.handleCoreEvent(event));
    this.#core = core;
    return core;
  }

  private async refreshJoinedRooms(): Promise<void> {
    const core = await this.ensureCore();
    const result = await core.fetchJoinedRooms();
    await Promise.all(result.roomIds.map(async (roomId: string) => {
      try {
        const info = await core.fetchRoom({ roomId });
        this.upsertRoom(roomId, info);
      } catch {
        this.upsertRoom(roomId);
      }
    }));
  }

  private async syncOnce(): Promise<void> {
    if (this.#syncing || this.#stopped) return;
    this.#syncing = true;
    try {
      const core = await this.ensureCore();
      await core.syncOnce();
    } catch (error) {
      this.emit(ClientEvent.SyncUnexpectedError, error);
      this.emitSync(SyncState.Error, SyncState.Syncing, { error });
    } finally {
      this.#syncing = false;
    }
  }

  private scheduleSync(timeoutMs: number): void {
    if (this.#stopped) return;
    this.#syncTimer = setTimeout(async () => {
      await this.syncOnce();
      this.scheduleSync(timeoutMs);
    }, Math.max(1000, timeoutMs));
  }

  private handleCoreEvent(event: MatrixCoreEvent): void {
    if (event.type === "message") {
      const matrixEvent = new MatrixEvent(toMatrixEventJson(event.event));
      const room = this.upsertRoom(event.event.roomId);
      room.addLiveEvents([matrixEvent]);
      room.emit(RoomEvent.Timeline, matrixEvent, room, false, false);
      this.emit(RoomEvent.Timeline, matrixEvent, room, false, false);
      this.emit(ClientEvent.Event, matrixEvent);
      return;
    }
    if (event.type === "reaction") {
      const matrixEvent = new MatrixEvent(toMatrixEventJson(event.event));
      this.emit(ClientEvent.Event, matrixEvent);
      return;
    }
    if (event.type === "invite") {
      const room = this.upsertRoom(event.event.roomId);
      this.emit(ClientEvent.Room, room);
      return;
    }
    if (event.type === "sync_status") {
      if (event.status === "syncing") this.emitSync(SyncState.Syncing, null);
      if (event.status === "synced") this.emitSync(SyncState.Prepared, SyncState.Syncing);
      if (event.status === "stopped") this.emitSync(SyncState.Stopped, null);
      return;
    }
    if (event.type === "error" || event.type === "decryption_error") {
      this.emit(ClientEvent.SyncUnexpectedError, new Error(event.error));
    }
  }

  private emitSync(state: SyncState, previous: SyncState | null, data?: unknown): void {
    this.emit(ClientEvent.Sync, state, previous, data);
    this.emit("sync", state, previous, data);
  }

  private upsertRoom(roomId: string, summary?: MatrixRoomInfo): Room {
    let room = this.#rooms.get(roomId);
    if (!room) {
      room = new Room(roomId, summary);
      this.#rooms.set(roomId, room);
      this.emit(ClientEvent.Room, room);
    } else {
      room.applySummary(summary);
    }
    return room;
  }

  private async loadCore(host: MatrixCoreHost): Promise<MatrixCore> {
    if (this.#loadCore) return this.#loadCore(host);
    if (isNodeRuntime()) {
      const { loadMatrixCoreFromNodePackage } = await import("better-matrix-js/node");
      return loadMatrixCoreFromNodePackage({ host });
    }
    const { loadMatrixCore } = await import("better-matrix-js");
    return loadMatrixCore({ host });
  }

  override removeAllListeners(eventName?: string | symbol): this {
    super.removeAllListeners(eventName);
    if (!eventName) this.#unsub?.();
    return this;
  }
}

export function createClient(opts: ICreateClientOpts | string): MatrixClient {
  if (typeof opts === "string") return new MatrixClient({ baseUrl: opts });
  return new MatrixClient(opts);
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && Boolean(process.versions?.node);
}
