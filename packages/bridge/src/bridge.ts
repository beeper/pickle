import { createMatrixClient } from "@beeper/pickle";
import type { MatrixClient, MatrixClientEvent, MatrixMessageEvent, MatrixReactionEvent, MatrixSubscription, SentEvent } from "@beeper/pickle";
import type {
  BridgeContext,
  BridgeLogger,
  BridgeRequestContext,
  CreateBridgeOptions,
  BridgeBackfillOptions,
  BridgeCreatePortalRoomOptions,
  MatrixAppserviceCreateRoomOptions,
  MatrixAppserviceSendMessageOptions,
  LoginProcess,
  NetworkAPI,
  PickleBridge,
  Portal,
  QueueRemoteEventResult,
  RemoteEvent,
  UserLogin,
  BridgeUser,
  MatrixDispatchResult,
  MatrixMessage,
  MatrixReaction,
  MatrixRedaction,
  MatrixTyping,
  MatrixIntent,
  RemoteMessage,
} from "./types";

type GenericMatrixEvent = Extract<MatrixClientEvent, { content: Record<string, unknown>; kind: string }>;

export function createBridge(options: CreateBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export class RuntimeBridge implements PickleBridge {
  readonly connector: CreateBridgeOptions["connector"];
  readonly #appserviceOptions: CreateBridgeOptions["appservice"];
  readonly #networkClients = new Map<string, NetworkAPI>();
  readonly #messages = new Map<string, SentEvent>();
  readonly #portalsByKey = new Map<string, Portal>();
  readonly #portalsByRoom = new Map<string, Portal>();
  readonly #remoteEvents: Array<{ event: RemoteEvent; login: UserLogin }> = [];
  readonly #matrixClient: MatrixClient;
  readonly #subscriptions = new Set<MatrixSubscription>();
  #context: BridgeContext | null = null;
  #drainPromise: Promise<void> | null = null;
  #started = false;
  #ownUserId: string | null = null;

  constructor(options: CreateBridgeOptions, client: MatrixClient) {
    this.connector = options.connector;
    this.#appserviceOptions = options.appservice;
    this.#matrixClient = client;
  }

  get client(): MatrixClient | null {
    return this.#started ? this.#matrixClient : null;
  }

  get context(): BridgeContext | null {
    return this.#context;
  }

  async start(): Promise<void> {
    if (this.#started) return;
    const whoami = await this.#matrixClient.boot();
    this.#ownUserId = whoami.userId;
    if (this.#appserviceOptions) {
      await this.#matrixClient.appservice.init(this.#appserviceOptions);
    }
    this.#context = this.#createContext();
    if ("validateConfig" in this.connector && typeof this.connector.validateConfig === "function") {
      await this.connector.validateConfig();
    }
    await this.connector.init(this.#context);
    await this.connector.start(this.#context);
    await this.#subscribeMatrixEvents();
    this.#started = true;
  }

  async stop(): Promise<void> {
    const subscriptions = Array.from(this.#subscriptions);
    this.#subscriptions.clear();
    await Promise.allSettled(subscriptions.map((subscription) => subscription.stop()));
    const clients = Array.from(this.#networkClients.values());
    this.#networkClients.clear();
    await Promise.allSettled(clients.map((client) => client.disconnect()));
    if ("stop" in this.connector && typeof this.connector.stop === "function") {
      await this.connector.stop();
    }
    await this.#matrixClient.close();
    this.#context = null;
    this.#started = false;
  }

  async createLogin(user: BridgeUser, flowId: string): Promise<LoginProcess> {
    return this.connector.createLogin(this.#requestContext(), user, flowId);
  }

  async createPortalRoom(options: BridgeCreatePortalRoomOptions): Promise<Portal> {
    this.#requestContext();
    const createOptions = stripUndefined({
      beeperAutoJoinInvites: options.beeperAutoJoinInvites,
      beeperBridgeAccountId: options.beeperBridgeAccountId,
      beeperBridgeName: options.beeperBridgeName,
      beeperInitialMembers: options.beeperInitialMembers,
      beeperLocalRoomId: options.beeperLocalRoomId,
      creationContent: options.creationContent,
      initialState: options.initialState?.map((state) => ({
        content: state.content,
        stateKey: state.stateKey ?? "",
        type: state.type,
      })),
      invite: options.invite,
      isDirect: options.isDirect,
      meowCreateTs: options.meowCreateTs,
      meowRoomId: options.meowRoomId,
      name: options.name,
      preset: options.preset,
      roomAliasName: options.roomAliasName,
      roomVersion: options.roomVersion,
      topic: options.topic,
      userId: options.userId,
      visibility: options.visibility,
    });
    const result = await this.#matrixClient.appservice.createRoom(createOptions as MatrixAppserviceCreateRoomOptions);
    const portal: Portal = {
      id: options.portalKey.id,
      metadata: options.metadata,
      mxid: result.roomId,
      portalKey: options.portalKey,
      ...(options.portalKey.receiver ? { receiver: options.portalKey.receiver } : {}),
    };
    this.registerPortal(portal);
    return portal;
  }

  async backfill(options: BridgeBackfillOptions) {
    this.#requestContext();
    return this.#matrixClient.appservice.batchSend(options);
  }

  async loadUserLogin(login: UserLogin): Promise<NetworkAPI> {
    const existing = this.#networkClients.get(login.id);
    if (existing) return existing;
    const client = await this.connector.loadUserLogin(this.#requestContext(), login);
    login.client = client;
    this.#networkClients.set(login.id, client);
    await client.connect({ ...this.#requestContext(), login });
    return client;
  }

  queueRemoteEvent(login: UserLogin, event: RemoteEvent): QueueRemoteEventResult {
    this.#remoteEvents.push({ event, login });
    this.#scheduleDrain();
    return { event, queued: true };
  }

  registerPortal(portal: Portal): void {
    this.#portalsByKey.set(portalKeyString(portal.portalKey), portal);
    if (portal.mxid) {
      this.#portalsByRoom.set(portal.mxid, portal);
    }
  }

  async flushRemoteEvents(): Promise<void> {
    await this.#drainRemoteEvents();
  }

  remoteEventBacklog(): readonly { event: RemoteEvent; login: UserLogin }[] {
    return this.#remoteEvents;
  }

  async dispatchMatrixEvent(event: MatrixClientEvent): Promise<MatrixDispatchResult> {
    if (!this.#context) {
      throw new Error("Bridge has not been started");
    }
    if (event.kind === "message") {
      return this.#dispatchMatrixMessage(event);
    }
    if (event.kind === "reaction") {
      return this.#dispatchMatrixReaction(event);
    }
    if (isGenericEvent(event, "redaction")) {
      return this.#dispatchMatrixRedaction(event);
    }
    if (isGenericEvent(event, "typing")) {
      return this.#dispatchMatrixTyping(event);
    }
    return { dispatched: false, handlers: 0, kind: event.kind };
  }

  #requestContext(): BridgeRequestContext {
    if (!this.#context) {
      throw new Error("Bridge has not been started");
    }
    return this.#context;
  }

  #createContext(): BridgeContext {
    return {
      bridge: this,
      client: this.#matrixClient,
      log: defaultLogger,
      queueRemoteEvent: (login, event) => this.queueRemoteEvent(login, event),
    };
  }

  async #subscribeMatrixEvents(): Promise<void> {
    const subscription = await this.#matrixClient.subscribe(
      { kind: ["message", "reaction", "redaction", "typing"] },
      (event) => void this.dispatchMatrixEvent(event).catch((error: unknown) => {
        defaultLogger("error", "matrix_dispatch_failed", { error });
      }),
      { live: true }
    );
    this.#subscriptions.add(subscription);
  }

  async #dispatchMatrixMessage(event: MatrixMessageEvent): Promise<MatrixDispatchResult> {
    if (event.sender.isMe || event.sender.userId === this.#ownUserId) {
      return { dispatched: false, eventId: event.eventId, handlers: 0, kind: event.kind, roomId: event.roomId };
    }
    const portal = this.#portalForRoom(event.roomId);
    const msg: MatrixMessage = {
      attachments: event.attachments,
      content: event.content,
      event,
      portal,
      sender: event.sender,
      text: event.text,
      ...(event.threadRoot ? { threadRoot: { id: event.threadRoot } } : {}),
    };
    let handlers = 0;
    for (const client of this.#networkClients.values()) {
      if (!hasMethod(client, "handleMatrixMessage")) continue;
      handlers += 1;
      await client.handleMatrixMessage(this.#requestContext(), msg);
    }
    return { dispatched: handlers > 0, eventId: event.eventId, handlers, kind: event.kind, roomId: event.roomId };
  }

  async #dispatchMatrixReaction(event: MatrixReactionEvent): Promise<MatrixDispatchResult> {
    if (event.sender.isMe || event.sender.userId === this.#ownUserId) {
      return { dispatched: false, eventId: event.eventId, handlers: 0, kind: event.kind, roomId: event.roomId };
    }
    const portal = this.#portalForRoom(event.roomId);
    const msg: MatrixReaction = {
      content: event.content,
      event,
      portal,
      targetMessage: { id: event.relatesTo },
    };
    let handlers = 0;
    for (const client of this.#networkClients.values()) {
      if (!hasMethod(client, "handleMatrixReaction")) continue;
      handlers += 1;
      await client.handleMatrixReaction(this.#requestContext(), msg);
    }
    return { dispatched: handlers > 0, eventId: event.eventId, handlers, kind: event.kind, roomId: event.roomId };
  }

  async #dispatchMatrixRedaction(event: GenericMatrixEvent): Promise<MatrixDispatchResult> {
    const roomId = event.roomId;
    if (!roomId || !event.eventId) {
      return roomId
        ? { dispatched: false, handlers: 0, kind: event.kind, roomId }
        : { dispatched: false, handlers: 0, kind: event.kind };
    }
    const msg: MatrixRedaction = {
      eventId: event.eventId,
      portal: this.#portalForRoom(roomId),
    };
    let handlers = 0;
    for (const client of this.#networkClients.values()) {
      if (!hasMethod(client, "handleMatrixRedaction")) continue;
      handlers += 1;
      await client.handleMatrixRedaction(this.#requestContext(), msg);
    }
    return { dispatched: handlers > 0, eventId: event.eventId, handlers, kind: event.kind, roomId };
  }

  async #dispatchMatrixTyping(event: GenericMatrixEvent): Promise<MatrixDispatchResult> {
    const roomId = event.roomId;
    if (!roomId) {
      return { dispatched: false, handlers: 0, kind: event.kind };
    }
    const content = event.content;
    const userIds = Array.isArray(content.user_ids)
      ? content.user_ids.filter((userId: unknown): userId is string => typeof userId === "string")
      : [];
    let handlers = 0;
    for (const userId of userIds) {
      if (userId === this.#ownUserId) continue;
      const msg: MatrixTyping = {
        portal: this.#portalForRoom(roomId),
        typing: true,
        userId,
      };
      for (const client of this.#networkClients.values()) {
        if (!hasMethod(client, "handleMatrixTyping")) continue;
        handlers += 1;
        await client.handleMatrixTyping(this.#requestContext(), msg);
      }
    }
    return { dispatched: handlers > 0, handlers, kind: event.kind, roomId };
  }

  #portalForRoom(roomId: string): Portal {
    const existing = this.#portalsByRoom.get(roomId);
    if (existing) return existing;
    const portal: Portal = {
      id: roomId,
      mxid: roomId,
      portalKey: { id: roomId },
    };
    this.#portalsByRoom.set(roomId, portal);
    return portal;
  }

  #portalForRemoteEvent(event: RemoteEvent): Portal | null {
    return this.#portalsByKey.get(portalKeyString(event.getPortalKey())) ?? null;
  }

  #scheduleDrain(): void {
    this.#drainPromise ??= this.#drainRemoteEvents().finally(() => {
      this.#drainPromise = null;
      if (this.#remoteEvents.length > 0) this.#scheduleDrain();
    });
  }

  async #drainRemoteEvents(): Promise<void> {
    if (!this.#context) return;
    while (this.#remoteEvents.length > 0) {
      const item = this.#remoteEvents.shift();
      if (!item) continue;
      await this.#handleRemoteEvent(item.login, item.event);
    }
  }

  async #handleRemoteEvent(_login: UserLogin, event: RemoteEvent): Promise<void> {
    const type = event.getType();
    if (type === "message" || type === "message_upsert") {
      await this.#handleRemoteMessage(event as RemoteMessage);
      return;
    }
    this.#context?.log("debug", "remote_event_ignored", { type });
  }

  async #handleRemoteMessage(event: RemoteMessage): Promise<void> {
    const portal = this.#portalForRemoteEvent(event);
    if (!portal?.mxid) {
      throw new Error(`No Matrix room registered for portal ${portalKeyString(event.getPortalKey())}`);
    }
    const converted = await event.convertMessage(this.#requestContext(), portal, this.#matrixIntent());
    for (const [index, part] of converted.parts.entries()) {
      const sender = event.getSender();
      const sent = await this.#sendRemoteMessagePart(portal.mxid, sender.sender, part.content, eventTimestamp(event));
      this.#messages.set(messagePartKey(event.getID(), part.id ?? String(index)), {
        eventId: sent.eventId,
        raw: sent.raw,
        roomId: sent.roomId,
      });
    }
  }

  #matrixIntent(): MatrixIntent {
    return {
      client: this.#matrixClient,
      sendMessage: async (roomId, content) => {
        const type = typeof content.msgtype === "string" ? "m.room.message" : "m.room.message";
        const transactionId = `pickle-bridge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const result = await this.#matrixClient.raw.request({
          body: content,
          method: "PUT",
          path: `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/${encodeURIComponent(type)}/${transactionId}`,
        });
        const eventId = eventIdFromRaw(result.body);
        return { eventId, raw: result.raw ?? result.body ?? result, roomId };
      },
    };
  }

  async #sendRemoteMessagePart(roomId: string, sender: string, content: Record<string, unknown>, timestamp?: number): Promise<SentEvent> {
    if (this.#appserviceOptions && sender.startsWith("@")) {
      const sendOptions = stripUndefined({
        content,
        roomId,
        timestamp,
        userId: sender,
      });
      return this.#matrixClient.appservice.sendMessage(sendOptions as MatrixAppserviceSendMessageOptions);
    }
    return this.#matrixIntent().sendMessage(roomId, content);
  }
}

const defaultLogger: BridgeLogger = (level, message, data) => {
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(`[pickle-bridge] ${message}`, data ?? "");
};

function isGenericEvent(event: MatrixClientEvent, kind: string): event is GenericMatrixEvent {
  return event.kind === kind && "content" in event && typeof event.content === "object" && event.content !== null;
}

function hasMethod<T extends string>(value: object, method: T): value is object & Record<T, (...args: unknown[]) => unknown> {
  return method in value && typeof (value as Record<string, unknown>)[method] === "function";
}

function portalKeyString(portalKey: { id: string; receiver?: string }): string {
  return `${portalKey.receiver ?? ""}\u0000${portalKey.id}`;
}

function messagePartKey(messageId: string, partId: string): string {
  return `${messageId}\u0000${partId}`;
}

function eventIdFromRaw(body: unknown): string {
  if (body && typeof body === "object" && typeof (body as { event_id?: unknown }).event_id === "string") {
    return (body as { event_id: string }).event_id;
  }
  if (body && typeof body === "object" && typeof (body as { eventId?: unknown }).eventId === "string") {
    return (body as { eventId: string }).eventId;
  }
  return "";
}

function eventTimestamp(event: RemoteEvent): number | undefined {
  if ("getTimestamp" in event && typeof event.getTimestamp === "function") {
    const timestamp = event.getTimestamp();
    return timestamp instanceof Date ? timestamp.getTime() : undefined;
  }
  return undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}
