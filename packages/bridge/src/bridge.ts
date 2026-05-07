import { createMatrixClient } from "@beeper/pickle";
import type { MatrixAppserviceBatchSendOptions, MatrixClient, MatrixClientEvent, MatrixMessageEvent, MatrixReactionEvent, MatrixSubscription, SentEvent } from "@beeper/pickle";
import { AppserviceWebsocket } from "./appservice-websocket";
import { createBeeperAppServiceInit } from "./beeper";
import type {
  BridgeContext,
  BridgeLogger,
  BridgeRequestContext,
  CreateBeeperBridgeOptions,
  CreateBridgeOptions,
  BridgeBackfillOptions,
  BridgeCreateManagementRoomOptions,
  BridgeCreatePortalRoomOptions,
  BackfillingNetworkAPI,
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
  BridgeSendMediaOptions,
  BridgeState,
  BridgeStatus,
  DownloadMediaOptions,
  DownloadMediaResult,
  Ghost,
  MatrixDispatchResult,
  MatrixMessage,
  MatrixReaction,
  MatrixRedaction,
  MatrixTyping,
  MatrixIntent,
  MatrixCommand,
  MatrixCommandResponse,
  ManagementRoom,
  MessageRequest,
  MessageRequestHandlingNetworkAPI,
  RemoteMessage,
  RemoteBackfill,
  RemoteChatDelete,
  RemoteChatInfoChange,
  UserProfile,
  UserProfileUpdate,
  ResolveIdentifierParams,
  ResolveIdentifierResponse,
  IdentifierResolvingNetworkAPI,
  LoginCookieInput,
  LoginProcessCookies,
  LoginProcessDisplayAndWait,
  LoginProcessUserInput,
  LoginProcessWithOverride,
  LoginUserInput,
} from "./types";

type GenericMatrixEvent = Extract<MatrixClientEvent, { content: Record<string, unknown>; kind: string }>;

export function createBridge(options: CreateBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateBeeperBridgeOptions): Promise<PickleBridge> {
  const matrix = {
    ...options.matrix,
    account: options.account,
    homeserver: options.matrix.homeserver ?? options.account.homeserver,
    token: options.matrix.token ?? options.account.accessToken,
  };
  return createBeeperBridgeWithClient({ ...options, matrix }, createMatrixClient(matrix));
}

export async function createBeeperBridgeWithClient(options: CreateBeeperBridgeOptions, client: MatrixClient): Promise<PickleBridge> {
  const matrix = {
    ...options.matrix,
    account: options.account,
    homeserver: options.matrix.homeserver ?? options.account.homeserver,
    token: options.matrix.token ?? options.account.accessToken,
  };
  const appservice = await createBeeperAppServiceInit(beeperAppServiceOptions({
    address: options.address,
    baseDomain: options.baseDomain,
    bridge: options.bridge,
    bridgeType: options.bridgeType,
    getOnly: options.getOnly,
    homeserverDomain: domainFromUserID(options.account.userId),
    token: options.account.accessToken,
  }));
  const runtimeOptions: CreateBridgeOptions = {
    appservice,
    connector: options.connector,
    matrix,
  };
  if (options.dataStore) runtimeOptions.dataStore = options.dataStore;
  return new RuntimeBridge(runtimeOptions, client);
}

export class RuntimeBridge implements PickleBridge {
  readonly connector: CreateBridgeOptions["connector"];
  readonly #appserviceOptions: CreateBridgeOptions["appservice"];
  readonly #dataStore: CreateBridgeOptions["dataStore"];
  readonly #networkClients = new Map<string, NetworkAPI>();
  readonly #messages = new Map<string, SentEvent>();
  readonly #ghosts = new Map<string, Ghost>();
  readonly #messageRequests = new Map<string, MessageRequest>();
  readonly #managementRooms = new Map<string, ManagementRoom>();
  readonly #portalsByKey = new Map<string, Portal>();
  readonly #portalsByRoom = new Map<string, Portal>();
  readonly #remoteEvents: Array<{ event: RemoteEvent; login: UserLogin }> = [];
  readonly #matrixClient: MatrixClient;
  readonly #subscriptions = new Set<MatrixSubscription>();
  #appserviceWebsocket: AppserviceWebsocket | null = null;
  #bridgeStatus: BridgeStatus | null = null;
  #context: BridgeContext | null = null;
  #drainPromise: Promise<void> | null = null;
  #started = false;
  #ownUserId: string | null = null;

  constructor(options: CreateBridgeOptions, client: MatrixClient) {
    this.connector = options.connector;
    this.#appserviceOptions = options.appservice;
    this.#dataStore = options.dataStore;
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
    await this.setBridgeState("starting");
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
    this.#startAppserviceWebsocket();
    this.#started = true;
    await this.setBridgeState("running");
  }

  async stop(): Promise<void> {
    await this.setBridgeState("stopping");
    const subscriptions = Array.from(this.#subscriptions);
    this.#subscriptions.clear();
    await Promise.allSettled(subscriptions.map((subscription) => subscription.stop()));
    const clients = Array.from(this.#networkClients.values());
    this.#networkClients.clear();
    this.#appserviceWebsocket?.stop();
    this.#appserviceWebsocket = null;
    await Promise.allSettled(clients.map((client) => client.disconnect()));
    if ("stop" in this.connector && typeof this.connector.stop === "function") {
      await this.connector.stop();
    }
    await this.#matrixClient.close();
    this.#context = null;
    this.#started = false;
    await this.setBridgeState("stopped");
  }

  async createLogin(user: BridgeUser, flowId: string): Promise<LoginProcess> {
    const process = await this.connector.createLogin(this.#requestContext(), user, flowId);
    return bindLoginProcess(process, () => this.#requestContext());
  }

  async createManagementRoom(options: BridgeCreateManagementRoomOptions): Promise<ManagementRoom> {
    this.#requestContext();
    const createOptions = stripUndefined({
      creationContent: options.creationContent,
      initialState: options.initialState?.map((state) => ({
        content: state.content,
        stateKey: state.stateKey ?? "",
        type: state.type,
      })),
      invite: options.invite,
      isDirect: false,
      name: options.name,
      preset: options.preset,
      roomAliasName: options.roomAliasName,
      roomVersion: options.roomVersion,
      topic: options.topic,
      userId: options.userId,
      visibility: options.visibility,
    });
    const result = await this.#matrixClient.appservice.createRoom(createOptions as MatrixAppserviceCreateRoomOptions);
    const room: ManagementRoom = {
      metadata: options.metadata,
      mxid: result.roomId,
    };
    this.registerManagementRoom(room);
    return room;
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

  async backfillMessages(login: UserLogin, params: Parameters<BackfillingNetworkAPI["fetchMessages"]>[1]) {
    const client = await this.loadUserLogin(login);
    if (!hasMethod(client, "fetchMessages")) {
      throw new Error(`Login ${login.id} does not support backfill`);
    }
    const response = await (client as BackfillingNetworkAPI).fetchMessages(this.#requestContext(), params);
    const portal = params.portal;
    if (!portal.mxid) {
      throw new Error(`Cannot backfill portal ${portalKeyString(portal.portalKey)} without a Matrix room`);
    }
    const events = await this.#convertBackfillMessages(portal, response.messages.map((message) => message.event));
    return this.backfill({ events, roomId: portal.mxid });
  }

  async loadUserLogin(login: UserLogin): Promise<NetworkAPI> {
    const existing = this.#networkClients.get(login.id);
    if (existing) return existing;
    const client = await this.connector.loadUserLogin(this.#requestContext(), login);
    login.client = client;
    this.#networkClients.set(login.id, client);
    await this.#dataStore?.setUserLogin(login);
    await client.connect({ ...this.#requestContext(), login });
    return client;
  }

  getBridgeState(): BridgeState | null {
    return this.#bridgeStatus?.state ?? null;
  }

  getBridgeStatus(): BridgeStatus | null {
    return this.#bridgeStatus;
  }

  async setBridgeState(state: BridgeState): Promise<void> {
    await this.setBridgeStatus({ state, updatedAt: new Date() });
  }

  async setBridgeStatus(status: BridgeStatus): Promise<void> {
    this.#bridgeStatus = status;
    await this.#dataStore?.setBridgeStatus(status);
    await this.#dataStore?.setBridgeState(status.state);
  }

  getGhost(id: string): Ghost | null {
    return this.#ghosts.get(id) ?? null;
  }

  registerGhost(ghost: Ghost): void {
    this.#ghosts.set(ghost.id, ghost);
    void this.#dataStore?.setGhost(ghost).catch((error: unknown) => {
      defaultLogger("warn", "ghost_store_failed", { error });
    });
  }

  getPortal(portalKey: { id: string; receiver?: string }): Portal | null {
    return this.#portalsByKey.get(portalKeyString(portalKey)) ?? null;
  }

  getPortalByMXID(mxid: string): Portal | null {
    return this.#portalsByRoom.get(mxid) ?? null;
  }

  async setPortalMetadata(portalKey: { id: string; receiver?: string }, metadata: unknown): Promise<Portal> {
    const portal = this.getPortal(portalKey);
    if (!portal) throw new Error(`No portal registered for ${portalKeyString(portalKey)}`);
    const updated = { ...portal, metadata };
    this.registerPortal(updated);
    return updated;
  }

  async getMessageRequest(portalKey: { id: string; receiver?: string }): Promise<MessageRequest | null> {
    const key = portalKeyString(portalKey);
    return this.#messageRequests.get(key) ?? (await this.#dataStore?.getMessageRequest(key)) ?? null;
  }

  async setMessageRequest(request: MessageRequest): Promise<void> {
    const key = portalKeyString(request.portalKey);
    this.#messageRequests.set(key, request);
    await this.#dataStore?.setMessageRequest(request);
  }

  async acceptMessageRequest(portalKey: { id: string; receiver?: string }): Promise<MessageRequest> {
    const request = await this.getMessageRequest(portalKey);
    if (!request) throw new Error(`No message request for ${portalKeyString(portalKey)}`);
    const next: MessageRequest = { ...request, status: "accepted", updatedAt: new Date() };
    const client = next.portalKey.receiver ? this.#networkClients.get(next.portalKey.receiver) : undefined;
    const handled = client && hasMethod(client, "handleMessageRequest")
      ? await (client as MessageRequestHandlingNetworkAPI).handleMessageRequest(this.#requestContext(), next)
      : next;
    await this.setMessageRequest(handled);
    return handled;
  }

  async resolveIdentifier(login: UserLogin, identifier: ResolveIdentifierParams): Promise<ResolveIdentifierResponse> {
    const client = await this.loadUserLogin(login);
    if (!hasMethod(client, "resolveIdentifier")) {
      throw new Error(`Login ${login.id} does not support identifier resolution`);
    }
    return (client as IdentifierResolvingNetworkAPI).resolveIdentifier(this.#requestContext(), identifier);
  }

  getUserInfo(userId: string) {
    return this.#matrixClient.users.get({ userId });
  }

  async getOwnProfile(): Promise<UserProfile> {
    const [displayName, avatarUrl] = await Promise.all([
      this.#matrixClient.users.getOwnDisplayName(),
      this.#matrixClient.users.getOwnAvatarUrl(),
    ]);
    const profile: UserProfile = {};
    if (avatarUrl.avatarUrl !== undefined) profile.avatarUrl = avatarUrl.avatarUrl;
    if (displayName.displayName !== undefined) profile.displayName = displayName.displayName;
    return profile;
  }

  async setOwnProfile(profile: UserProfileUpdate): Promise<void> {
    await Promise.all([
      profile.displayName === undefined ? undefined : this.#matrixClient.users.setOwnDisplayName({ displayName: profile.displayName }),
      profile.avatarUrl === undefined ? undefined : this.#matrixClient.users.setOwnAvatarUrl({ avatarUrl: profile.avatarUrl }),
    ]);
  }

  uploadMedia(options: Parameters<MatrixClient["media"]["upload"]>[0]) {
    return this.#matrixClient.media.upload(options);
  }

  async downloadMedia(options: DownloadMediaOptions): Promise<DownloadMediaResult> {
    if (hasMethod(this.connector, "download")) {
      return this.connector.download(this.#requestContext(), options.contentUri, options.params ?? {}) as Promise<DownloadMediaResult>;
    }
    const result = await this.#matrixClient.media.download({ contentUri: options.contentUri });
    return { body: result.bytes, bytes: result.bytes };
  }

  sendMedia(options: BridgeSendMediaOptions): Promise<SentEvent> {
    return this.#matrixClient.messages.sendMedia(options);
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
    void this.#dataStore?.setPortal(portal).catch((error: unknown) => {
      defaultLogger("warn", "portal_store_failed", { error });
    });
  }

  registerManagementRoom(room: ManagementRoom): void {
    this.#managementRooms.set(room.mxid, room);
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
    const context: BridgeContext = {
      bridge: this,
      client: this.#matrixClient,
      log: defaultLogger,
      queueRemoteEvent: (login, event) => this.queueRemoteEvent(login, event),
    };
    if (this.#dataStore) context.dataStore = this.#dataStore;
    return context;
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

  #startAppserviceWebsocket(): void {
    if (!this.#appserviceOptions || hasPushURL(this.#appserviceOptions.registration.url)) return;
    this.#appserviceWebsocket = new AppserviceWebsocket({
      appservice: this.#appserviceOptions,
      dispatch: (event) => this.dispatchMatrixEvent(event),
      log: defaultLogger,
    });
    this.#appserviceWebsocket.start();
  }

  async #dispatchMatrixMessage(event: MatrixMessageEvent): Promise<MatrixDispatchResult> {
    if (event.sender.isMe || event.sender.userId === this.#ownUserId) {
      return { dispatched: false, eventId: event.eventId, handlers: 0, kind: event.kind, roomId: event.roomId };
    }
    const command = this.#parseManagementCommand(event);
    if (command) {
      return this.#dispatchMatrixCommand(command);
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

  async #dispatchMatrixCommand(command: MatrixCommand): Promise<MatrixDispatchResult> {
    if (!hasMethod(this.connector, "handleCommand")) {
      return { dispatched: false, eventId: command.event.eventId, handlers: 0, kind: command.event.kind, roomId: command.event.roomId };
    }
    const response = await this.connector.handleCommand(this.#requestContext(), command) as MatrixCommandResponse;
    if (response?.text || response?.content) {
      await this.#matrixIntent().sendMessage(command.event.roomId, response.content ?? {
        body: response.text,
        msgtype: "m.notice",
      });
    }
    return { dispatched: response?.handled ?? true, eventId: command.event.eventId, handlers: 1, kind: command.event.kind, roomId: command.event.roomId };
  }

  #parseManagementCommand(event: MatrixMessageEvent): MatrixCommand | null {
    const room = this.#managementRooms.get(event.roomId);
    if (!room) return null;
    const text = event.text || stringContent(event.content.body);
    if (!text) return null;
    const prefix = this.connector.getName().defaultCommandPrefix ?? "";
    const body = prefix && text.startsWith(prefix) ? text.slice(prefix.length).trimStart() : text.trim();
    if (!body) return null;
    const [command = "", ...args] = body.split(/\s+/);
    if (!command) return null;
    return {
      args,
      body,
      command,
      event,
      prefix,
      room,
      sender: event.sender,
      text,
    };
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
    if (type === "backfill") {
      await this.#handleRemoteBackfill(event as RemoteBackfill);
      return;
    }
    if (type === "chat_info_change") {
      await this.#handleRemoteChatInfoChange(event as RemoteChatInfoChange);
      return;
    }
    if (type === "chat_delete") {
      await this.#handleRemoteChatDelete(event as RemoteChatDelete);
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
      const messageKey = messagePartKey(event.getID(), part.id ?? String(index));
      const message = {
        eventId: sent.eventId,
        raw: sent.raw,
        roomId: sent.roomId,
      };
      this.#messages.set(messageKey, message);
      await this.#dataStore?.setMessage(messageKey, message);
    }
  }

  async #handleRemoteBackfill(event: RemoteBackfill): Promise<void> {
    const portal = this.#portalForRemoteEvent(event);
    if (!portal?.mxid) {
      throw new Error(`No Matrix room registered for portal ${portalKeyString(event.getPortalKey())}`);
    }
    const response = await event.getBackfillData(this.#requestContext(), portal);
    const events = await this.#convertBackfillMessages(portal, response.messages.map((message) => message.event));
    await this.backfill({ events, roomId: portal.mxid });
  }

  async #handleRemoteChatInfoChange(event: RemoteChatInfoChange): Promise<void> {
    const portal = this.#portalForRemoteEvent(event);
    if (!portal) return;
    const change = await event.getChatInfoChange(this.#requestContext());
    const metadata = {
      ...(typeof portal.metadata === "object" && portal.metadata !== null ? portal.metadata : {}),
      chatInfo: change,
    };
    await this.setPortalMetadata(portal.portalKey, metadata);
  }

  async #handleRemoteChatDelete(event: RemoteChatDelete): Promise<void> {
    const portal = this.#portalForRemoteEvent(event);
    if (!portal) return;
    if (event.deleteOnlyForMe()) {
      await this.setPortalMetadata(portal.portalKey, {
        ...(typeof portal.metadata === "object" && portal.metadata !== null ? portal.metadata : {}),
        deletedForMe: true,
      });
      return;
    }
    this.#portalsByKey.delete(portalKeyString(portal.portalKey));
    if (portal.mxid) this.#portalsByRoom.delete(portal.mxid);
    await this.#dataStore?.deletePortal(portalKeyString(portal.portalKey));
  }

  async #convertBackfillMessages(portal: Portal, messages: RemoteMessage[]): Promise<MatrixAppserviceBatchSendOptions["events"]> {
    const events: MatrixAppserviceBatchSendOptions["events"] = [];
    for (const message of messages) {
      const converted = await message.convertMessage(this.#requestContext(), portal, this.#matrixIntent());
      for (const part of converted.parts) {
        const event: MatrixAppserviceBatchSendOptions["events"][number] = {
          content: part.content,
          sender: message.getSender().sender,
        };
        const timestamp = eventTimestamp(message);
        if (timestamp !== undefined) event.timestamp = timestamp;
        events.push(event);
      }
    }
    return events;
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

function hasPushURL(url: string | undefined): boolean {
  return Boolean(url && url !== "websocket");
}

function bindLoginProcess(process: LoginProcess, getContext: () => BridgeRequestContext): LoginProcess {
  const bound: LoginProcess = {
    cancel: (ctx?: BridgeRequestContext) => process.cancel(ctx ?? getContext()),
    start: (ctx?: BridgeRequestContext) => process.start(ctx ?? getContext()),
  };

  if (hasMethod(process, "startWithOverride")) {
    const processWithOverride = process as LoginProcessWithOverride;
    Object.assign(bound, {
      startWithOverride: (ctxOrOverride?: BridgeRequestContext | UserLogin, override?: UserLogin) => {
        const ctx = override ? ctxOrOverride as BridgeRequestContext | undefined : undefined;
        const login = override ?? ctxOrOverride as UserLogin;
        return processWithOverride.startWithOverride(ctx ?? getContext(), login);
      },
    });
  }

  if (hasMethod(process, "wait")) {
    const waitingProcess = process as LoginProcessDisplayAndWait;
    Object.assign(bound, {
      wait: (ctx?: BridgeRequestContext) => waitingProcess.wait(ctx ?? getContext()),
    });
  }

  if (hasMethod(process, "submitUserInput")) {
    const inputProcess = process as LoginProcessUserInput;
    Object.assign(bound, {
      submitUserInput: (ctxOrInput?: BridgeRequestContext | LoginUserInput, input?: LoginUserInput) => {
        const ctx = input ? ctxOrInput as BridgeRequestContext | undefined : undefined;
        const values = input ?? ctxOrInput as LoginUserInput;
        return inputProcess.submitUserInput(ctx ?? getContext(), values);
      },
    });
  }

  if (hasMethod(process, "submitCookies")) {
    const cookieProcess = process as LoginProcessCookies;
    Object.assign(bound, {
      submitCookies: (ctxOrCookies?: BridgeRequestContext | LoginCookieInput, cookies?: LoginCookieInput) => {
        const ctx = cookies ? ctxOrCookies as BridgeRequestContext | undefined : undefined;
        const values = cookies ?? ctxOrCookies as LoginCookieInput;
        return cookieProcess.submitCookies(ctx ?? getContext(), values);
      },
    });
  }

  return bound;
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

function stringContent(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value;
}

function domainFromUserID(userId: string): string {
  const index = userId.indexOf(":");
  if (index === -1 || index === userId.length - 1) {
    throw new Error(`Cannot infer homeserver domain from Matrix user ID ${userId}`);
  }
  return userId.slice(index + 1);
}

function beeperAppServiceOptions(input: {
  address: string | undefined;
  baseDomain: string | undefined;
  bridge: string;
  bridgeType: string | undefined;
  getOnly: boolean | undefined;
  homeserverDomain: string;
  token: string;
}) {
  const output = {
    bridge: input.bridge,
    homeserverDomain: input.homeserverDomain,
    token: input.token,
  } as Parameters<typeof createBeeperAppServiceInit>[0];
  if (input.address !== undefined) output.address = input.address;
  if (input.baseDomain !== undefined) output.baseDomain = input.baseDomain;
  if (input.bridgeType !== undefined) output.bridgeType = input.bridgeType;
  if (input.getOnly !== undefined) output.getOnly = input.getOnly;
  return output;
}
