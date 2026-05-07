import { createMatrixClient } from "@beeper/pickle";
import type { MatrixAppserviceBatchSendOptions, MatrixAppserviceInitOptions, MatrixClient, MatrixClientEvent, MatrixMessageEvent, MatrixReactionEvent, MatrixSubscription, SentEvent } from "@beeper/pickle";
import { AppserviceWebsocket, type HTTPProxyRequest, type HTTPProxyResponse } from "./appservice-websocket";
import { createBeeperAppServiceInit } from "./beeper";
import { createRemoteMessage } from "./events";
import type {
  BridgeContext,
  BridgeLogger,
  BridgeRequestContext,
  CreateBeeperBridgeOptions,
  CreateBridgeOptions,
  BridgeBackfillOptions,
  BridgeCreateManagementRoomOptions,
  BridgeCreatePortalOptions,
  BridgeCreatePortalRoomOptions,
  BackfillingNetworkAPI,
  MatrixAppserviceSendMessageOptions,
  LoginProcess,
  NetworkAPI,
  PickleBridge,
  Portal,
  PortalKey,
  PortalReference,
  QueueRemoteEventResult,
  RemoteEventQueue,
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
  EventSender,
  MatrixIntent,
  MatrixCommand,
  MatrixCommandResponse,
  ConvertedMessage,
  ManagementRoom,
  MessageRequest,
  MessageRequestHandlingNetworkAPI,
  RemoteMessage,
  RemoteMessageWithTransactionID,
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
  LoginStep,
  LoginUserInput,
  BridgeStateEvent,
  BridgeStatePayload,
  BridgeBeeperOptions,
  BridgeRemoteBackfillOptions,
  BridgeRemoteEventOptions,
  BridgeRemoteMessageOptions,
  BackfillQueueParams,
  BackfillQueueResult,
  ChatViewingNetworkAPI,
  MessageCheckpoint,
  MessageCheckpointStatus,
  MessageCheckpointStep,
} from "./types";

type GenericMatrixEvent = Extract<MatrixClientEvent, { content: Record<string, unknown>; kind: string }>;

export function createBridge(options: CreateBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateBeeperBridgeOptions): Promise<PickleBridge> {
  if (!options.store) throw new Error("createBeeperBridge requires store outside the Node entrypoint");
  const matrix = {
    ...options.matrix,
    account: options.account,
    homeserver: options.matrix?.homeserver ?? options.account.homeserver,
    store: options.store,
    token: options.matrix?.token ?? options.account.accessToken,
  };
  return createBeeperBridgeWithClient({ ...options, matrix }, createMatrixClient(matrix));
}

export async function createBeeperBridgeWithClient(options: CreateBeeperBridgeOptions, client: MatrixClient): Promise<PickleBridge> {
  const store = options.store ?? options.matrix?.store;
  if (!store) throw new Error("createBeeperBridgeWithClient requires store");
  const matrix = {
    ...options.matrix,
    account: options.account,
    homeserver: options.matrix?.homeserver ?? options.account.homeserver,
    store,
    token: options.matrix?.token ?? options.account.accessToken,
  };
  const appservice = await createBeeperAppServiceInit(beeperAppServiceOptions({
    address: options.address,
    baseDomain: options.baseDomain,
    bridge: options.bridge,
    bridgeType: options.bridgeType,
    getOnly: options.getOnly,
    homeserverDomain: options.homeserverDomain,
    token: options.account.accessToken,
  }));
  const runtimeOptions: CreateBridgeOptions = {
    appservice,
    beeper: {
      bridge: options.bridge,
      ownerUserId: options.account.userId,
      ...(options.bridgeType ? { bridgeType: options.bridgeType } : {}),
    },
    connector: options.connector,
    matrix,
  };
  if (options.dataStore) runtimeOptions.dataStore = options.dataStore;
  return new RuntimeBridge(runtimeOptions, client);
}

export class RuntimeBridge implements PickleBridge {
  readonly connector: CreateBridgeOptions["connector"];
  readonly #appserviceOptions: CreateBridgeOptions["appservice"];
  readonly #beeperOptions: BridgeBeeperOptions | undefined;
  readonly #dataStore: CreateBridgeOptions["dataStore"];
  readonly #networkClients = new Map<string, NetworkAPI>();
  readonly #messages = new Map<string, SentEvent>();
  readonly #ghosts = new Map<string, Ghost>();
  readonly #messageRequests = new Map<string, MessageRequest>();
  readonly #managementRooms = new Map<string, ManagementRoom>();
  readonly #provisioningLogins = new Map<string, { nextStep: LoginStep; process: LoginProcess }>();
  readonly #portalsByKey = new Map<string, Portal>();
  readonly #portalsByRoom = new Map<string, Portal>();
  readonly #remoteEvents: Array<{ event: RemoteEvent; login: UserLogin }> = [];
  readonly #networkClientLoads = new Map<string, Promise<NetworkAPI>>();
  readonly #userLogins = new Map<string, UserLogin>();
  readonly #loginStates = new Map<string, BridgeStatePayload>();
  readonly #matrixClient: MatrixClient;
  readonly #subscriptions = new Set<MatrixSubscription>();
  #appserviceWebsocket: AppserviceWebsocket | null = null;
  #bridgeStatus: BridgeStatus | null = null;
  #context: BridgeContext | null = null;
  #drainPromise: Promise<void> | null = null;
  #started = false;
  #ownerUserId: string | null = null;
  #ownUserId: string | null = null;

  constructor(options: CreateBridgeOptions, client: MatrixClient) {
    this.connector = options.connector;
    this.#appserviceOptions = options.appservice;
    this.#beeperOptions = options.beeper;
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
    await this.#loadPersistedStatus();
    await this.setBridgeState("starting");
    const whoami = await this.#matrixClient.boot();
    this.#ownerUserId = whoami.userId;
    this.#ownUserId = whoami.userId;
    defaultLogger("info", "bridge_matrix_booted", { userId: whoami.userId });
    if (this.#appserviceOptions) {
      const result = await this.#matrixClient.appservice.init(this.#appserviceOptions);
      defaultLogger("info", "bridge_appservice_initialized", {
        botUserId: appserviceBotUserId(this.#appserviceOptions),
        homeserver: this.#appserviceOptions.homeserver,
        registrationId: this.#appserviceOptions.registration.id,
        result,
      });
      this.#ownUserId = appserviceBotUserId(this.#appserviceOptions);
    }
    this.#context = this.#createContext();
    if ("validateConfig" in this.connector && typeof this.connector.validateConfig === "function") {
      await this.connector.validateConfig();
    }
    await this.connector.init(this.#context);
    await this.#loadPersistedPortals();
    await this.#loadPersistedUserLogins();
    await this.connector.start(this.#context);
    await this.#subscribeMatrixEvents();
    this.#startAppserviceWebsocket();
    this.#started = true;
    await this.setBridgeState("running");
    this.#sendCurrentBridgeStatus();
    this.#scheduleDrain();
  }

  async stop(): Promise<void> {
    await this.setBridgeState("stopping");
    for (const login of this.#userLogins.values()) {
      await this.#setLoginBridgeState(login, "BRIDGE_UNREACHABLE");
    }
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
    const invite = autoJoinInvite(options.invite, this.#beeperOptions?.ownerUserId);
    const result = await this.#matrixClient.appservice.createManagementRoom(stripUndefined({
      autoJoinInvites: this.#beeperOptions ? true : undefined,
      initialMembers: this.#beeperOptions ? invite : undefined,
      invite,
      name: options.name,
      topic: options.topic,
      userId: options.userId,
    }));
    const room: ManagementRoom = {
      metadata: options.metadata,
      mxid: result.roomId,
    };
    this.registerManagementRoom(room);
    return room;
  }

  async createPortalRoom(options: BridgeCreatePortalRoomOptions): Promise<Portal> {
    this.#requestContext();
    const invite = autoJoinInvite(options.invite, this.#beeperOptions?.ownerUserId);
    const info = options.info ?? {};
    const name = info.name ?? options.name;
    const topic = info.topic ?? options.topic;
    const result = await this.#matrixClient.appservice.createPortalRoom(stripUndefined({
      autoJoinInvites: this.#beeperOptions ? true : undefined,
      avatarUrl: info.avatar?.mxc ?? options.avatarUrl,
      bridge: this.connector.getName(),
      bridgeName: this.#beeperOptions?.bridge,
      initialMembers: this.#beeperOptions ? invite : undefined,
      invite,
      isDirect: options.roomType === "dm",
      messageRequest: options.messageRequest,
      name,
      portalKey: options.portalKey,
      roomType: options.roomType,
      topic,
      userId: options.userId,
    }));
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

  async createPortal(login: UserLogin, options: BridgeCreatePortalOptions): Promise<Portal> {
    const { id, sender, ...roomOptions } = options;
    return this.createPortalRoom({
      ...roomOptions,
      portalKey: { id, receiver: login.id },
      ...(sender ? { userId: this.ghostUserId(sender) } : {}),
    });
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
    const result = await this.backfill({ events, roomId: portal.mxid });
    if (response.markRead && hasMethod(client, "markChatViewed")) {
      await (client as ChatViewingNetworkAPI).markChatViewed(this.#requestContext(), portal);
    }
    return result;
  }

  async backfillPortal(login: UserLogin, portal: PortalReference, params: Omit<Parameters<BackfillingNetworkAPI["fetchMessages"]>[1], "portal"> = {}) {
    return this.backfillMessages(login, { ...params, portal: this.#resolvePortalReference(login, portal) });
  }

  queue(login: UserLogin): RemoteEventQueue {
    return {
      backfill: (options) => this.#queueBackfillEvent(login, options),
      event: (event) => this.#queueEvent(login, event),
      message: (options) => this.#queueMessage(login, options),
    };
  }

  #queueMessage<T>(login: UserLogin, options: BridgeRemoteMessageOptions<T>): QueueRemoteEventResult {
    return this.queueRemoteEvent(login, this.#remoteMessageEvent(login, options));
  }

  #queueBackfillEvent(login: UserLogin, options: BridgeRemoteBackfillOptions): QueueRemoteEventResult {
    const portalKey = this.#portalKeyReference(login, options.portal);
    const event: RemoteBackfill = {
      getBackfillData: () => Promise.resolve(stripUndefined({
        cursor: options.cursor,
        forward: options.forward,
        hasMore: options.hasMore,
        markRead: options.markRead,
        messages: options.messages.map((message) => ({ event: this.#remoteMessageEvent(login, { ...message, portal: message.portal ?? options.portal }) })),
        progress: options.progress,
      })),
      getPortalKey: () => portalKey,
      getSender: () => ({ isFromMe: true, sender: login.userId ?? this.#ownerUserId ?? "" }),
      getType: () => "backfill",
    };
    return this.queueRemoteEvent(login, event);
  }

  #queueEvent(login: UserLogin, input: RemoteEvent | BridgeRemoteEventOptions): QueueRemoteEventResult {
    if (!("event" in input)) return this.queueRemoteEvent(login, input);
    const portalKey = this.#portalKeyReference(login, input.portal);
    const sender = this.#eventSenderReference(login, input.sender ?? { isFromMe: true, sender: login.userId ?? this.#ownerUserId ?? "" });
    return this.queueRemoteEvent(login, {
      ...input.event,
      getPortalKey: () => portalKey,
      getSender: () => sender,
    });
  }

  #remoteMessageEvent<T>(login: UserLogin, options: BridgeRemoteMessageOptions<T>): RemoteMessage | RemoteMessageWithTransactionID {
    return createRemoteMessage({
      ...options,
      convert: options.convert ?? (() => convertedMessageFromOptions(options)),
      data: options.data as T,
      portalKey: this.#portalKeyReference(login, options.portal),
      sender: this.#eventSenderReference(login, options.sender),
    });
  }

  async queueBackfill(login: UserLogin, params: BackfillQueueParams): Promise<BackfillQueueResult> {
    const client = await this.loadUserLogin(login);
    if (!hasMethod(client, "fetchMessages")) {
      throw new Error(`Login ${login.id} does not support backfill`);
    }
    const task = params.task ?? stripUndefined({
      portalKey: params.portal.portalKey,
      userLoginId: login.id,
      ...(params.cursor !== undefined ? { cursor: params.cursor } : {}),
      ...(params.pending !== undefined ? { pending: params.pending } : {}),
    });
    await this.#setLoginBridgeState(login, "BACKFILLING", { message: `Backfilling ${portalKeyString(params.portal.portalKey)}` });
    const response = await (client as BackfillingNetworkAPI).fetchMessages(this.#requestContext(), { ...params, task });
    const portal = params.portal;
    if (!portal.mxid) {
      throw new Error(`Cannot backfill portal ${portalKeyString(portal.portalKey)} without a Matrix room`);
    }
    const events = await this.#convertBackfillMessages(portal, response.messages.map((message) => message.event));
    await this.backfill({ events, roomId: portal.mxid });
    if ((response.markRead ?? params.markRead) && hasMethod(client, "markChatViewed")) {
      await (client as ChatViewingNetworkAPI).markChatViewed(this.#requestContext(), portal);
    }
    await this.#setLoginBridgeState(login, "CONNECTED");
    return stripUndefined({
      queued: false,
      task: stripUndefined({
        ...task,
        completedAt: new Date(),
        done: !response.hasMore,
        pending: false,
        ...((response.cursor ?? task.cursor) !== undefined ? { cursor: response.cursor ?? task.cursor } : {}),
      }),
      ...(response.cursor !== undefined ? { cursor: response.cursor } : {}),
      ...(response.forward !== undefined ? { forward: response.forward } : {}),
      ...(response.hasMore !== undefined ? { hasMore: response.hasMore } : {}),
      ...((response.markRead ?? params.markRead) !== undefined ? { markRead: response.markRead ?? params.markRead } : {}),
      ...(params.pending !== undefined ? { pending: params.pending } : {}),
      ...((response.progress ?? params.progress) !== undefined ? { progress: response.progress ?? params.progress } : {}),
    });
  }

  async loadUserLogin(login: UserLogin): Promise<NetworkAPI> {
    const existing = this.#networkClients.get(login.id);
    if (existing) return existing;
    const loading = this.#networkClientLoads.get(login.id);
    if (loading) return loading;
    const promise = this.#loadUserLogin(login);
    this.#networkClientLoads.set(login.id, promise);
    try {
      return await promise;
    } finally {
      this.#networkClientLoads.delete(login.id);
    }
  }

  async #loadUserLogin(login: UserLogin): Promise<NetworkAPI> {
    await this.#setLoginBridgeState(login, "CONNECTING");
    const client = await this.connector.loadUserLogin(this.#requestContext(), login);
    await client.connect({ ...this.#requestContext(), login });
    login.client = client;
    this.#userLogins.set(login.id, login);
    this.#networkClients.set(login.id, client);
    if (this.#dataStore && hasMethod(this.#dataStore, "setUserLogin")) {
      await this.#dataStore.setUserLogin(login);
    }
    await this.#setLoginBridgeState(login, "CONNECTED");
    defaultLogger("info", "user_login_loaded", { loginId: login.id, remoteName: login.remoteName, userId: login.userId });
    this.#sendCurrentBridgeStatus();
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
    const bridgeState = status.bridgeState ?? bridgeStatePayload(bridgeStateEvent(status.state), undefined, status);
    const logins = status.logins ?? this.#loginStatesRecord();
    this.#bridgeStatus = { ...status, bridgeState, logins };
    if (this.#dataStore && hasMethod(this.#dataStore, "setBridgeStatus")) {
      await this.#dataStore.setBridgeStatus(this.#bridgeStatus);
    }
    if (this.#dataStore && hasMethod(this.#dataStore, "setBridgeState")) {
      await this.#dataStore.setBridgeState(status.state);
    }
    defaultLogger("info", "bridge_state_updated", { state: status.state });
    this.#sendCurrentBridgeStatus();
  }

  sendMessageCheckpoints(checkpoints: MessageCheckpoint[]): boolean {
    return this.#sendMessageCheckpoints(checkpoints);
  }

  getGhost(id: string): Ghost | null {
    return this.#ghosts.get(id) ?? null;
  }

  ghostUserId(localId: string): string {
    const escaped = escapeMatrixLocalpart(localId);
    if (this.#appserviceOptions) {
      return ghostUserIdFromRegistration(this.#appserviceOptions, escaped);
    }
    return `@${escaped}:${domainFromUserID(this.#ownerUserId ?? this.#ownUserId ?? "@bridge:example")}`;
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

  #portalKeyReference(login: UserLogin, portal: PortalReference): PortalKey {
    if (typeof portal === "string") return { id: portal, receiver: login.id };
    if ("portalKey" in portal) return { ...portal.portalKey, receiver: portal.portalKey.receiver ?? portal.receiver ?? login.id };
    return { ...portal, receiver: portal.receiver ?? login.id };
  }

  #resolvePortalReference(login: UserLogin, portal: PortalReference): Portal {
    if (typeof portal !== "string" && "portalKey" in portal) return portal;
    const portalKey = this.#portalKeyReference(login, portal);
    const resolved = this.getPortal(portalKey);
    if (!resolved) throw new Error(`No portal registered for ${portalKeyString(portalKey)}`);
    return resolved;
  }

  #eventSenderReference(login: UserLogin, sender: string | EventSender): EventSender {
    return typeof sender === "string" ? { isFromMe: false, sender: this.ghostUserId(sender), senderLogin: login.id } : sender;
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
    const key = portalKeyString(portal.portalKey);
    const existing = this.#portalsByKey.get(key);
    if (existing?.mxid && existing.mxid !== portal.mxid) {
      this.#portalsByRoom.delete(existing.mxid);
    }
    this.#portalsByKey.set(key, portal);
    if (portal.mxid) {
      this.#portalsByRoom.set(portal.mxid, portal);
    }
    void this.#dataStore?.setPortal(portal).catch((error: unknown) => {
      defaultLogger("warn", "portal_store_failed", { error });
    });
  }

  registerManagementRoom(room: ManagementRoom, persist = true): void {
    this.#managementRooms.set(room.mxid, room);
    if (!persist) return;
    void this.#persistManagementRoom(room).catch((error: unknown) => {
      defaultLogger("warn", "management_room_store_failed", { error });
    });
  }

  async flushRemoteEvents(): Promise<void> {
    this.#scheduleDrain();
    await this.#drainPromise;
  }

  remoteEventBacklog(): readonly { event: RemoteEvent; login: UserLogin }[] {
    return this.#remoteEvents;
  }

  async dispatchMatrixEvent(event: MatrixClientEvent): Promise<MatrixDispatchResult> {
    if (!this.#context) {
      throw new Error("Bridge has not been started");
    }
    defaultLogger("debug", "matrix_event_received", {
      eventId: "eventId" in event ? event.eventId : undefined,
      kind: event.kind,
      roomId: "roomId" in event ? event.roomId : undefined,
      sender: "sender" in event ? event.sender.userId : undefined,
    });
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
      queue: (login) => this.queue(login),
      queueRemoteEvent: (login, event) => this.queueRemoteEvent(login, event),
    };
    if (this.#dataStore) context.dataStore = this.#dataStore;
    return context;
  }

  async #loadPersistedStatus(): Promise<void> {
    if (!this.#dataStore || !hasMethod(this.#dataStore, "getBridgeStatus")) return;
    const status = await this.#dataStore.getBridgeStatus();
    if (!status) return;
    this.#bridgeStatus = status;
    for (const [loginId, state] of Object.entries(status.logins ?? {})) {
      this.#loginStates.set(loginId, state);
    }
  }

  async #loadPersistedUserLogins(): Promise<void> {
    if (!this.#dataStore || !hasMethod(this.#dataStore, "listUserLogins")) return;
    const logins = await this.#dataStore.listUserLogins();
    if (!logins?.length) return;
    for (const login of logins) {
      try {
        await this.loadUserLogin(login);
      } catch (error: unknown) {
        await this.#setLoginBridgeState(login, "UNKNOWN_ERROR", { error: errorMessage(error) });
        defaultLogger("warn", "user_login_load_failed", { error, loginId: login.id });
      }
    }
  }

  async #loadPersistedPortals(): Promise<void> {
    if (!this.#dataStore || !hasMethod(this.#dataStore, "listPortals")) return;
    const portals = await this.#dataStore.listPortals();
    if (!portals?.length) return;
    for (const portal of portals) {
      this.#portalsByKey.set(portalKeyString(portal.portalKey), portal);
      if (portal.mxid) {
        this.#portalsByRoom.set(portal.mxid, portal);
      }
    }
    defaultLogger("info", "portals_loaded", { count: portals.length });
  }

  async #setLoginBridgeState(login: UserLogin, stateEvent: BridgeStateEvent, options: { error?: string; message?: string; reason?: string } = {}): Promise<void> {
    const payload = bridgeStatePayload(stateEvent, login, options);
    this.#loginStates.set(login.id, payload);
    if (this.#bridgeStatus) {
      this.#bridgeStatus = { ...this.#bridgeStatus, logins: this.#loginStatesRecord() };
      if (this.#dataStore && hasMethod(this.#dataStore, "setBridgeStatus")) {
        await this.#dataStore.setBridgeStatus(this.#bridgeStatus);
      }
    }
  }

  #loginStatesRecord(): Record<string, BridgeStatePayload> {
    return Object.fromEntries(this.#loginStates);
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
    if (!this.#appserviceOptions) return;
    if (hasPushURL(this.#appserviceOptions.registration.url)) {
      defaultLogger("info", "appservice_websocket_skipped", { reason: "registration_url_is_push_url" });
      return;
    }
    defaultLogger("info", "appservice_websocket_starting", { homeserver: this.#appserviceOptions.homeserver });
    this.#appserviceWebsocket = new AppserviceWebsocket({
      appservice: this.#appserviceOptions,
      dispatch: (event) => this.dispatchMatrixEvent(event),
      handleHTTPProxy: (request) => this.#handleHTTPProxy(request),
      log: defaultLogger,
      onOpen: () => this.#sendCurrentBridgeStatus(),
    });
    this.#appserviceWebsocket.start();
  }

  async #handleHTTPProxy(request: HTTPProxyRequest): Promise<HTTPProxyResponse | null> {
    const path = request.path ?? "";
    const method = request.method ?? "GET";
    defaultLogger("debug", "provisioning_http_request", { method, path });
    if (method === "GET" && path === "/_matrix/provision/v3/capabilities") {
      return jsonHTTPResponse(200, provisioningCapabilities(this.connector.getCapabilities()));
    }
    if (method === "GET" && path === "/_matrix/provision/v3/login/flows") {
      return jsonHTTPResponse(200, { flows: this.connector.getLoginFlows() });
    }
    if (method === "GET" && path === "/_matrix/provision/v3/logins") {
      return jsonHTTPResponse(200, { login_ids: Array.from(this.#networkClients.keys()) });
    }
    const startMatch = /^\/_matrix\/provision\/v3\/login\/start\/([^/]+)$/.exec(path);
    if (method === "POST" && startMatch) {
      const flowId = decodeURIComponent(startMatch[1] ?? "");
      defaultLogger("info", "provisioning_login_start", { flowId });
      const process = await this.createLogin({ id: this.#ownerUserId ?? this.#ownUserId ?? "" }, flowId);
      const step = await process.start();
      const loginId = randomID("login");
      this.#provisioningLogins.set(loginId, { nextStep: step, process });
      return jsonHTTPResponse(200, loginStepResponse(loginId, step));
    }
    const stepMatch = /^\/_matrix\/provision\/v3\/login\/step\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(path);
    if (method === "POST" && stepMatch) {
      const loginId = decodeURIComponent(stepMatch[1] ?? "");
      const stepId = decodeURIComponent(stepMatch[2] ?? "");
      const stepType = decodeURIComponent(stepMatch[3] ?? "");
      const login = this.#provisioningLogins.get(loginId);
      if (!login) return jsonHTTPResponse(404, matrixError("M_NOT_FOUND", "Login not found"));
      if (login.nextStep.stepId !== stepId) return jsonHTTPResponse(400, matrixError("M_BAD_STATE", "Step ID does not match"));
      if (login.nextStep.type !== stepType) return jsonHTTPResponse(400, matrixError("M_BAD_STATE", "Step type does not match"));
      let nextStep: LoginStep;
      if (stepType === "user_input" && hasMethod(login.process, "submitUserInput")) {
        nextStep = await (login.process as LoginProcessUserInput).submitUserInput(this.#requestContext(), stringMap(request.body));
      } else if (stepType === "cookies" && hasMethod(login.process, "submitCookies")) {
        nextStep = await (login.process as LoginProcessCookies).submitCookies(this.#requestContext(), stringMap(request.body));
      } else if (stepType === "display_and_wait" && hasMethod(login.process, "wait")) {
        nextStep = await (login.process as LoginProcessDisplayAndWait).wait(this.#requestContext());
      } else {
        return jsonHTTPResponse(400, matrixError("M_BAD_REQUEST", `Unsupported login step type ${stepType}`));
      }
      if (nextStep.type === "complete") {
        defaultLogger("info", "provisioning_login_complete", { loginId });
        this.#provisioningLogins.delete(loginId);
        if (nextStep.complete?.userLogin) await this.loadUserLogin(nextStep.complete.userLogin);
        else if (nextStep.complete?.userLoginId) await this.loadUserLogin({ id: nextStep.complete.userLoginId });
      } else {
        login.nextStep = nextStep;
      }
      return jsonHTTPResponse(200, loginStepResponse(loginId, nextStep));
    }
    return null;
  }

  async #dispatchMatrixMessage(event: MatrixMessageEvent): Promise<MatrixDispatchResult> {
    if (event.sender.isMe || event.sender.userId === this.#ownUserId) {
      defaultLogger("debug", "matrix_message_ignored_own", { eventId: event.eventId, roomId: event.roomId, sender: event.sender.userId });
      return { dispatched: false, eventId: event.eventId, handlers: 0, kind: event.kind, roomId: event.roomId };
    }
    const command = this.#parseManagementCommand(event);
    if (command) {
      try {
        const result = await this.#dispatchMatrixCommand(command);
        this.#sendMatrixEventCheckpoint(event, "COMMAND", result.dispatched ? "SUCCESS" : "UNSUPPORTED");
        return result;
      } catch (error: unknown) {
        this.#sendMatrixEventCheckpoint(event, "COMMAND", "PERM_FAILURE", errorMessage(error));
        throw error;
      }
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
    try {
      for (const client of this.#networkClientsForPortal(portal)) {
        if (!hasMethod(client, "handleMatrixMessage")) continue;
        handlers += 1;
        defaultLogger("debug", "matrix_message_to_network", { eventId: event.eventId, loginHandlers: handlers, roomId: event.roomId });
        await client.handleMatrixMessage(this.#requestContext(), msg);
      }
      this.#sendMatrixEventCheckpoint(event, "BRIDGE", handlers > 0 ? "SUCCESS" : "UNSUPPORTED");
    } catch (error: unknown) {
      this.#sendMatrixEventCheckpoint(event, "BRIDGE", "PERM_FAILURE", errorMessage(error));
      throw error;
    }
    return { dispatched: handlers > 0, eventId: event.eventId, handlers, kind: event.kind, roomId: event.roomId };
  }

  async #dispatchMatrixCommand(command: MatrixCommand): Promise<MatrixDispatchResult> {
    const builtinResponse = await this.#handleBuiltinCommand(command);
    if (builtinResponse) {
      await this.#sendCommandReply(command.event.roomId, builtinResponse.content ?? {
        body: builtinResponse.text ?? "",
        msgtype: "m.notice",
      });
      return { dispatched: true, eventId: command.event.eventId, handlers: 1, kind: command.event.kind, roomId: command.event.roomId };
    }
    if (!hasMethod(this.connector, "handleCommand")) {
      return { dispatched: false, eventId: command.event.eventId, handlers: 0, kind: command.event.kind, roomId: command.event.roomId };
    }
    const response = await this.connector.handleCommand(this.#requestContext(), command) as MatrixCommandResponse;
    if (response?.text || response?.content) {
      await this.#sendCommandReply(command.event.roomId, response.content ?? {
        body: response.text,
        msgtype: "m.notice",
      });
    }
    return { dispatched: response?.handled ?? true, eventId: command.event.eventId, handlers: 1, kind: command.event.kind, roomId: command.event.roomId };
  }

  #parseManagementCommand(event: MatrixMessageEvent): MatrixCommand | null {
    const explicitRoom = this.#managementRooms.get(event.roomId);
    if (!explicitRoom && this.#portalsByRoom.has(event.roomId)) return null;
    const text = event.text || stringContent(event.content.body);
    if (!text) return null;
    const prefix = this.connector.getName().defaultCommandPrefix ?? "";
    const hasPrefix = Boolean(prefix && text.startsWith(prefix));
    const implicitRoom = !explicitRoom && this.#isImplicitManagementEvent(event);
    if (!explicitRoom && !implicitRoom && !hasPrefix) return null;
    const room = explicitRoom ?? (implicitRoom ? this.#implicitManagementRoom(event) : { mxid: event.roomId });
    const body = hasPrefix ? text.slice(prefix.length).trimStart() : text.trim();
    if (!body) return null;
    const [command = "", ...args] = body.split(/\s+/);
    if (!command) return null;
    defaultLogger("info", "management_command_received", {
      args,
      command,
      eventId: event.eventId,
      roomId: event.roomId,
      sender: event.sender.userId,
    });
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

  #isImplicitManagementEvent(event: MatrixMessageEvent): boolean {
    return Boolean(this.#ownerUserId && event.sender.userId === this.#ownerUserId);
  }

  #implicitManagementRoom(event: MatrixMessageEvent): ManagementRoom {
    const room: ManagementRoom = { mxid: event.roomId };
    this.registerManagementRoom(room);
    return room;
  }

  async #handleBuiltinCommand(command: MatrixCommand): Promise<MatrixCommandResponse | null> {
    switch (command.command) {
      case "help":
        return { handled: true, text: this.#managementHelpText(command) };
      case "list-logins":
        return { handled: true, text: this.#listLoginsText() };
      case "login":
        return this.#handleLoginCommand(command);
      case "logout":
        return this.#handleLogoutCommand(command);
      case "cancel-login":
        return this.#handleCancelLoginCommand(command);
      case "set-management-room":
        return this.#handleSetManagementRoomCommand(command);
      default:
        return null;
    }
  }

  #managementHelpText(command: MatrixCommand): string {
    const commands = [
      "help",
      "list-logins",
      "login <flow-id>",
      "logout <login-id>",
      "cancel-login <login-id>",
      "set-management-room",
    ];
    const prefix = this.connector.getName().defaultCommandPrefix;
    const prefixHelp = command.room.mxid === command.event.roomId && this.#managementRooms.has(command.event.roomId)
      ? ""
      : prefix ? ` Prefix commands with ${prefix} outside management rooms.` : "";
    return `Available commands: ${commands.join(", ")}.${prefixHelp}`;
  }

  #listLoginsText(): string {
    const logins = Array.from(this.#userLogins.values());
    if (logins.length === 0) return "No logins.";
    return logins.map((login) => {
      const details = [login.remoteName, login.userId].filter(Boolean).join(" ");
      return details ? `${login.id} (${details})` : login.id;
    }).join("\n");
  }

  async #handleLoginCommand(command: MatrixCommand): Promise<MatrixCommandResponse> {
    const flowId = command.args[0];
    if (!flowId) {
      const flows = this.connector.getLoginFlows();
      if (flows.length === 0) return { handled: true, text: "No login flows are available." };
      return { handled: true, text: `Usage: login <flow-id>\nAvailable flows:\n${flows.map((flow) => `${flow.id}: ${flow.name}`).join("\n")}` };
    }
    const process = await this.createLogin({ id: command.sender.userId }, flowId);
    const step = await process.start();
    if (step.type === "complete" && step.complete?.userLoginId) {
      await this.loadUserLogin({ id: step.complete.userLoginId, userId: command.sender.userId });
      return { handled: true, text: `Login complete: ${step.complete.userLoginId}` };
    }
    const loginId = randomID("login");
    this.#provisioningLogins.set(loginId, { nextStep: step, process });
    return { handled: true, text: `Login started: ${loginId}\n${loginStepText(step)}` };
  }

  async #handleLogoutCommand(command: MatrixCommand): Promise<MatrixCommandResponse> {
    const loginId = command.args[0];
    if (!loginId) return { handled: true, text: "Usage: logout <login-id>" };
    const client = this.#networkClients.get(loginId);
    const login = this.#userLogins.get(loginId);
    if (!client && !login) return { handled: true, text: `Login not found: ${loginId}` };
    if (client) await client.disconnect();
    this.#networkClients.delete(loginId);
    this.#userLogins.delete(loginId);
    await this.#deleteStoredUserLogin(loginId);
    this.#sendCurrentBridgeStatus();
    return { handled: true, text: `Logged out: ${loginId}` };
  }

  async #handleCancelLoginCommand(command: MatrixCommand): Promise<MatrixCommandResponse> {
    const loginId = command.args[0];
    if (!loginId) return { handled: true, text: "Usage: cancel-login <login-id>" };
    const login = this.#provisioningLogins.get(loginId);
    if (!login) return { handled: true, text: `Login not found: ${loginId}` };
    await login.process.cancel(this.#requestContext());
    this.#provisioningLogins.delete(loginId);
    return { handled: true, text: `Cancelled login: ${loginId}` };
  }

  async #handleSetManagementRoomCommand(command: MatrixCommand): Promise<MatrixCommandResponse> {
    this.registerManagementRoom(command.room, false);
    await this.#persistManagementRoom(command.room);
    return { handled: true, text: `Management room registered: ${command.room.mxid}` };
  }

  async #deleteStoredUserLogin(loginId: string): Promise<void> {
    if (!this.#dataStore) return;
    const store = this.#dataStore as object;
    if (hasMethod(store, "deleteUserLogin")) {
      await store.deleteUserLogin(loginId);
    } else if (hasMethod(store, "removeUserLogin")) {
      await store.removeUserLogin(loginId);
    }
  }

  async #persistManagementRoom(room: ManagementRoom): Promise<void> {
    if (!this.#dataStore) return;
    const store = this.#dataStore as object;
    if (hasMethod(store, "setManagementRoom")) {
      await store.setManagementRoom(room);
    } else if (hasMethod(store, "registerManagementRoom")) {
      await store.registerManagementRoom(room);
    }
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
    for (const client of this.#networkClientsForPortal(portal)) {
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
    for (const client of this.#networkClientsForPortal(msg.portal)) {
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
      const portal = this.#portalForRoom(roomId);
      const msg: MatrixTyping = {
        portal,
        typing: true,
        userId,
      };
      for (const client of this.#networkClientsForPortal(portal)) {
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
    if (!this.#context) return;
    this.#drainPromise ??= this.#drainRemoteEvents().finally(() => {
      this.#drainPromise = null;
      if (this.#context && this.#remoteEvents.length > 0) this.#scheduleDrain();
    });
  }

  async #drainRemoteEvents(): Promise<void> {
    if (!this.#context) return;
    while (this.#remoteEvents.length > 0) {
      const item = this.#remoteEvents[0];
      if (!item) continue;
      await this.#handleRemoteEvent(item.login, item.event);
      this.#remoteEvents.shift();
    }
  }

  #networkClientsForPortal(portal: Portal): NetworkAPI[] {
    const receiver = portal.portalKey.receiver ?? portal.receiver;
    if (!receiver) return Array.from(this.#networkClients.values());
    const client = this.#networkClients.get(receiver);
    return client ? [client] : [];
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
        const type = "m.room.message";
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

  async #sendCommandReply(roomId: string, content: Record<string, unknown>): Promise<SentEvent> {
    try {
      const sender = this.#appserviceOptions ? appserviceBotUserId(this.#appserviceOptions) : null;
      const result = sender
        ? await this.#matrixClient.appservice.sendMessage({ content, roomId, userId: sender } as MatrixAppserviceSendMessageOptions)
        : await this.#matrixIntent().sendMessage(roomId, content);
      defaultLogger("info", "management_command_reply_sent", { eventId: result.eventId, roomId, sender });
      return result;
    } catch (error: unknown) {
      defaultLogger("error", "management_command_reply_failed", { error, roomId });
      throw error;
    }
  }

  #sendCurrentBridgeStatus(): void {
    const websocket = this.#appserviceWebsocket;
    if (!websocket) return;
    const bridgeState = this.#bridgeStatus?.bridgeState
      ?? bridgeStatePayload(bridgeStateEvent(this.#bridgeStatus?.state ?? "starting"));
    const logins = Object.values(this.#bridgeStatus?.logins ?? this.#loginStatesRecord());
    let sent = websocket.send("bridge_status", bridgeState) ? 1 : 0;
    for (const loginState of logins) {
      if (websocket.send("bridge_status", loginState)) sent += 1;
    }
    defaultLogger("debug", "bridge_status_sent", { loginCount: logins.length, sent, stateEvent: bridgeState.state_event });
  }

  #sendMatrixEventCheckpoint(
    event: MatrixMessageEvent,
    step: MessageCheckpointStep,
    status: MessageCheckpointStatus,
    info?: string
  ): boolean {
    const checkpoint = stripUndefined({
      eventId: event.eventId,
      eventType: event.type,
      info,
      messageType: event.messageType,
      reportedBy: "BRIDGE",
      retryNum: 0,
      roomId: event.roomId,
      status,
      step,
      timestamp: Date.now(),
    }) as MessageCheckpoint;
    return this.#sendMessageCheckpoints([checkpoint]);
  }

  #sendMessageCheckpoints(checkpoints: MessageCheckpoint[]): boolean {
    if (!this.#appserviceWebsocket) return false;
    const sent = this.#appserviceWebsocket.send("message_checkpoint", {
      checkpoints: checkpoints.map(messageCheckpointPayload),
    });
    defaultLogger("debug", "message_checkpoints_sent", { count: checkpoints.length, sent });
    return sent;
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

function appserviceBotUserId(options: MatrixAppserviceInitOptions): string {
  return `@${options.registration.senderLocalpart}:${options.homeserverDomain}`;
}

function ghostUserIdFromRegistration(options: MatrixAppserviceInitOptions, escapedLocalId: string): string {
  const botUserId = appserviceBotUserId(options);
  for (const namespace of options.registration.namespaces.users ?? []) {
    const userId = userIdFromNamespaceRegex(namespace.regex, escapedLocalId);
    if (userId && userId !== botUserId) return userId;
  }
  return `@${options.registration.senderLocalpart}_${escapedLocalId}:${options.homeserverDomain}`;
}

function userIdFromNamespaceRegex(regex: string, escapedLocalId: string): string | null {
  const match = /^@(.+?)(?:\\?\.?[+*]|\[|\(|\$)/.exec(regex);
  if (!match?.[1]) return null;
  const domainMatch = /:([^:]+)$/.exec(regex);
  if (!domainMatch?.[1]) return null;
  const prefix = unescapeRegexLiteral(match[1]);
  const domain = unescapeRegexLiteral(domainMatch[1].replace(/\$$/, ""));
  return `@${prefix}${escapedLocalId}:${domain}`;
}

function unescapeRegexLiteral(value: string): string {
  return value.replace(/\\([\\.^$*+?()[\]{}|/-])/g, "$1");
}

function escapeMatrixLocalpart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9._=-]/g, "_");
}

function bridgeStateEvent(state: BridgeState): BridgeStateEvent {
  switch (state) {
    case "starting":
      return "STARTING";
    case "running":
      return "RUNNING";
    case "stopping":
    case "stopped":
      return "BRIDGE_UNREACHABLE";
    case "degraded":
      return "TRANSIENT_DISCONNECT";
    case "error":
      return "UNKNOWN_ERROR";
  }
}

function bridgeStatePayload(
  stateEvent: BridgeStateEvent,
  login?: UserLogin,
  options: { error?: string; message?: string; reason?: string; updatedAt?: Date; metadata?: unknown } = {}
): BridgeStatePayload {
  const info = typeof options.metadata === "object" && options.metadata !== null
    ? options.metadata as Record<string, unknown>
    : undefined;
  return stripUndefined({
    error: options.error,
    info,
    message: options.message,
    reason: options.reason,
    remote_id: login?.id,
    remote_name: login?.remoteName,
    source: "bridge",
    state_event: stateEvent,
    timestamp: Math.floor((options.updatedAt?.getTime() ?? Date.now()) / 1000),
    ttl: bridgeStateTTL(stateEvent),
    user_id: login?.userId,
  }) as BridgeStatePayload;
}

function bridgeStateTTL(stateEvent: BridgeStateEvent): number {
  switch (stateEvent) {
    case "BAD_CREDENTIALS":
    case "BRIDGE_UNREACHABLE":
    case "LOGGED_OUT":
    case "TRANSIENT_DISCONNECT":
    case "UNKNOWN_ERROR":
      return 3600;
    default:
      return 21600;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function provisioningCapabilities(capabilities: { provisioning?: { groupCreation?: unknown; resolveIdentifier?: unknown } }): unknown {
  const provisioning = capabilities.provisioning;
  if (provisioning) {
    return {
      group_creation: provisioning.groupCreation ?? {},
      resolve_identifier: provisioning.resolveIdentifier ?? {},
    };
  }
  return {
    group_creation: {},
    resolve_identifier: {},
  };
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

function autoJoinInvite(invite: string[] | undefined, ownerUserId: string | undefined): string[] | undefined {
  if (!ownerUserId) return invite;
  const members = new Set(invite ?? []);
  members.add(ownerUserId);
  return Array.from(members);
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

function messageCheckpointPayload(checkpoint: MessageCheckpoint): Record<string, unknown> {
  return stripUndefined({
    client_type: checkpoint.clientType,
    client_version: checkpoint.clientVersion,
    event_id: checkpoint.eventId,
    event_type: checkpoint.eventType,
    info: checkpoint.info,
    manual_retry_count: checkpoint.manualRetryCount,
    message_type: checkpoint.messageType,
    original_event_id: checkpoint.originalEventId,
    reported_by: checkpoint.reportedBy,
    retry_num: checkpoint.retryNum,
    room_id: checkpoint.roomId,
    status: checkpoint.status,
    step: checkpoint.step,
    timestamp: checkpoint.timestamp instanceof Date ? checkpoint.timestamp.getTime() : checkpoint.timestamp,
  });
}

function stringContent(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type StripUndefined<T extends object> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function stripUndefined<T extends Record<string, unknown>>(value: T): StripUndefined<T> {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) {
      delete value[key];
    }
  }
  return value as StripUndefined<T>;
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
  homeserverDomain: string | undefined;
  token: string;
}) {
  const output = {
    bridge: input.bridge,
    token: input.token,
  } as Parameters<typeof createBeeperAppServiceInit>[0];
  if (input.address !== undefined) output.address = input.address;
  if (input.baseDomain !== undefined) output.baseDomain = input.baseDomain;
  if (input.bridgeType !== undefined) output.bridgeType = input.bridgeType;
  if (input.getOnly !== undefined) output.getOnly = input.getOnly;
  if (input.homeserverDomain !== undefined) output.homeserverDomain = input.homeserverDomain;
  return output;
}

function jsonHTTPResponse(status: number, body: unknown): HTTPProxyResponse {
  return {
    body,
    headers: { "content-type": ["application/json"] },
    status,
  };
}

function matrixError(errcode: string, error: string): Record<string, string> {
  return { errcode, error };
}

function loginStepResponse(loginId: string, step: LoginStep): Record<string, unknown> {
  return {
    login_id: loginId,
    ...loginStepJSON(step),
  };
}

function loginStepText(step: LoginStep): string {
  const lines = [`Step ${step.stepId} (${step.type})`];
  if (step.instructions) lines.push(step.instructions);
  return lines.join("\n");
}

function loginStepJSON(step: LoginStep): Record<string, unknown> {
  return stripUndefined({
    complete: step.complete ? stripUndefined({
      user_login_id: step.complete.userLoginId,
    }) : undefined,
    cookies: step.cookies ? stripUndefined({
      extract_js: step.cookies.extractJs,
      fields: step.cookies.fields.map((field) => stripUndefined({
        id: field.id,
        pattern: field.pattern,
        required: field.required,
        sources: field.sources.map((source) => stripUndefined({
          cookie_domain: source.cookieDomain,
          name: source.name,
          request_url_regex: source.requestUrlRegex,
          type: source.type,
        })),
      })),
      url: step.cookies.url,
      user_agent: step.cookies.userAgent,
      wait_for_url_pattern: step.cookies.waitForUrlPattern,
    }) : undefined,
    display_and_wait: step.displayAndWait ? stripUndefined({
      data: step.displayAndWait.data,
      image_url: step.displayAndWait.imageUrl,
      type: step.displayAndWait.type,
    }) : undefined,
    instructions: step.instructions,
    step_id: step.stepId,
    type: step.type,
    user_input: step.userInput ? {
      fields: step.userInput.fields.map((field) => stripUndefined({
        default_value: field.defaultValue,
        description: field.description,
        id: field.id,
        name: field.name,
        options: field.options,
        pattern: field.pattern,
        type: field.type,
      })),
    } : undefined,
  });
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function randomID(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function convertedMessageFromOptions(options: BridgeRemoteMessageOptions<unknown>): ConvertedMessage {
  if (options.parts) return { parts: options.parts };
  if (options.content) return { parts: [{ content: options.content, type: "m.room.message" }] };
  if (options.text !== undefined) {
    return {
      parts: [{
        content: {
          body: options.text,
          msgtype: "m.text",
        },
        type: "m.room.message",
      }],
    };
  }
  throw new Error("queueMessage requires text, content, parts, or convert");
}
