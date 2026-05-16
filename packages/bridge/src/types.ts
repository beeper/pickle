import type {
  MatrixAttachment,
  MatrixAppserviceBatchSendOptions,
  MatrixAppserviceBatchSendResult,
  MatrixAppserviceInitOptions,
  MatrixAppserviceSendMessageOptions,
  MatrixAccount,
  MatrixClient,
  MatrixClientOptions,
  MatrixEventSender,
  MatrixMessageEvent,
  MatrixReactionEvent,
  MatrixStore,
  SendMediaMessageOptions,
  SentEvent,
  UploadMediaOptions,
  UploadMediaResult,
  UserInfo as MatrixUserInfo,
} from "@beeper/pickle";
import type { BridgeDataStore } from "./store";

export type BridgeID = string;
export type UserID = string;
export type UserLoginID = string;
export type PortalID = string;
export type GhostID = string;
export type MessageID = string;
export type PartID = string;
export type ReactionID = string;
export type AvatarID = string;
export type MediaID = string;
export type PaginationCursor = string;
export type TransactionID = string;
export type RawTransactionID = string;
export type RoomID = string;
export type EventID = string;

export interface PortalKey {
  id: PortalID;
  receiver?: UserLoginID;
}

export type PortalReference = PortalID | PortalKey | Portal;

export interface BridgeName {
  beeperBridgeType?: string;
  defaultCommandPrefix?: string;
  defaultPort?: number;
  displayName: string;
  networkIcon?: string;
  networkId: string;
  networkUrl?: string;
}

export interface BridgeInfoContent {
  [key: string]: unknown;
}

export interface BridgeConfigPart<T = unknown> {
  data?: T;
  example?: string;
  upgrade?: (data: unknown) => T;
}

export interface DBMetaTypes {
  ghost?: () => unknown;
  message?: () => unknown;
  portal?: () => unknown;
  reaction?: () => unknown;
  userLogin?: () => unknown;
}

export interface BridgeConnector<TConfig = unknown> {
  createLogin(ctx: LoginCreateContext, user: BridgeUser, flowId: string): LoginProcess | Promise<LoginProcess>;
  getBridgeInfoVersion(): BridgeInfoVersion;
  getCapabilities(): NetworkGeneralCapabilities;
  getConfig(): BridgeConfigPart<TConfig>;
  getDBMetaTypes(): DBMetaTypes;
  getLoginFlows(): LoginFlow[];
  getName(): BridgeName;
  init(ctx: BridgeContext): void | Promise<void>;
  loadUserLogin(ctx: LoadUserLoginContext, login: UserLogin): Promise<NetworkAPI> | NetworkAPI;
  start(ctx: BridgeStartContext): Promise<void> | void;
}

export interface HTTPProxyHandlingBridgeConnector<TConfig = unknown> extends BridgeConnector<TConfig> {
  handleHTTPProxy(ctx: BridgeRequestContext, request: {
    body?: unknown;
    method?: string;
    path?: string;
  }): Promise<{ body?: unknown; headers?: Record<string, string | string[]>; status: number } | null> | { body?: unknown; headers?: Record<string, string | string[]>; status: number } | null;
}

export interface CommandHandlingBridgeConnector<TConfig = unknown> extends BridgeConnector<TConfig> {
  handleCommand(ctx: BridgeRequestContext, command: MatrixCommand): Promise<MatrixCommandResponse> | MatrixCommandResponse;
}

export interface StoppableNetwork extends BridgeConnector {
  stop(): Promise<void> | void;
}

export interface DirectMediableNetwork extends BridgeConnector {
  download(ctx: BridgeRequestContext, mediaId: MediaID, params: Record<string, string>): Promise<GetMediaResponse>;
  setUseDirectMedia(): void;
}

export interface IdentifierValidatingNetwork extends BridgeConnector {
  validateUserID(id: UserID): boolean;
}

export interface TransactionIDGeneratingNetwork extends BridgeConnector {
  generateTransactionID(userId: string, roomId: string, eventType: string): RawTransactionID;
}

export interface PortalBridgeInfoFillingNetwork extends BridgeConnector {
  fillPortalBridgeInfo(portal: Portal, content: BridgeInfoContent): void;
}

export interface ConfigValidatingNetwork extends BridgeConnector {
  validateConfig(): Promise<void> | void;
}

export interface MaxFileSizingNetwork extends BridgeConnector {
  setMaxFileSize(maxSize: number): void;
}

export interface NetworkResettingNetwork extends BridgeConnector {
  resetHTTPTransport(): void;
  resetNetworkConnections(): void;
}

export interface PushParsingNetwork extends BridgeConnector {
  parsePushNotification(ctx: BridgeRequestContext, data: unknown): Promise<PushNotificationParseResult>;
}

export interface NetworkAPI {
  connect(ctx: ConnectContext): Promise<void> | void;
  disconnect(): Promise<void> | void;
  getCapabilities?(ctx: BridgeRequestContext, portal: Portal): RoomFeatures;
}

export interface PushableNetworkAPI extends NetworkAPI {
  getPushConfigs(): PushConfig;
  registerPushNotifications(ctx: BridgeRequestContext, pushType: PushType, token: string): Promise<void>;
}

export interface BackgroundSyncingNetworkAPI extends NetworkAPI {
  backgroundSync(ctx: BridgeRequestContext, params?: unknown): Promise<void>;
}

export interface ChatViewingNetworkAPI extends NetworkAPI {
  markChatViewed(ctx: BridgeRequestContext, portal: Portal, message?: Message): Promise<void>;
}

export interface BackfillingNetworkAPI extends NetworkAPI {
  fetchMessages(ctx: BridgeRequestContext, params: FetchMessagesParams): Promise<FetchMessagesResponse>;
}

export interface IdentifierResolvingNetworkAPI extends NetworkAPI {
  resolveIdentifier(ctx: BridgeRequestContext, identifier: ResolveIdentifierParams): Promise<ResolveIdentifierResponse>;
}

export interface MessageRequestHandlingNetworkAPI extends NetworkAPI {
  handleMessageRequest(ctx: BridgeRequestContext, request: MessageRequest): Promise<MessageRequest>;
}

export interface StickerImportingNetworkAPI extends NetworkAPI {
  downloadImagePack(ctx: BridgeRequestContext, url: string): Promise<ImportedImagePack>;
  listImagePacks(ctx: BridgeRequestContext): Promise<ImagePackMetadata[]>;
}

export interface MessageHandlingNetworkAPI extends NetworkAPI {
  handleMatrixMessage(ctx: BridgeRequestContext, msg: MatrixMessage): Promise<MatrixMessageResponse>;
}

export interface EditHandlingNetworkAPI extends NetworkAPI {
  handleMatrixEdit(ctx: BridgeRequestContext, msg: MatrixEdit): Promise<MatrixMessageResponse>;
}

export interface ReactionHandlingNetworkAPI extends NetworkAPI {
  handleMatrixReaction(ctx: BridgeRequestContext, msg: MatrixReaction): Promise<Reaction | null>;
  preHandleMatrixReaction?(ctx: BridgeRequestContext, msg: MatrixReaction): Promise<MatrixReactionPreResponse>;
}

export interface RedactionHandlingNetworkAPI extends NetworkAPI {
  handleMatrixRedaction(ctx: BridgeRequestContext, msg: MatrixRedaction): Promise<void>;
}

export interface ReadReceiptHandlingNetworkAPI extends NetworkAPI {
  handleMatrixReadReceipt(ctx: BridgeRequestContext, msg: MatrixReadReceipt): Promise<void>;
}

export interface TypingHandlingNetworkAPI extends NetworkAPI {
  handleMatrixTyping(ctx: BridgeRequestContext, msg: MatrixTyping): Promise<void>;
}

export interface ReactionRemoveHandlingNetworkAPI extends NetworkAPI {
  handleMatrixReactionRemove(ctx: BridgeRequestContext, msg: MatrixReactionRemove): Promise<void>;
}

export interface PollHandlingNetworkAPI extends NetworkAPI {
  handleMatrixPollStart(ctx: BridgeRequestContext, msg: MatrixPollStart): Promise<MatrixMessageResponse>;
  handleMatrixPollVote(ctx: BridgeRequestContext, msg: MatrixPollVote): Promise<MatrixMessageResponse>;
}

export interface DisappearTimerChangingNetworkAPI extends NetworkAPI {
  handleMatrixDisappearTimer(ctx: BridgeRequestContext, msg: MatrixDisappearTimer): Promise<void>;
}

export interface MembershipHandlingNetworkAPI extends NetworkAPI {
  handleMatrixMembership(ctx: BridgeRequestContext, msg: MatrixMembership): Promise<void>;
}

export interface RoomNameHandlingNetworkAPI extends NetworkAPI {
  handleMatrixRoomName(ctx: BridgeRequestContext, msg: MatrixRoomName): Promise<void>;
}

export interface RoomTopicHandlingNetworkAPI extends NetworkAPI {
  handleMatrixRoomTopic(ctx: BridgeRequestContext, msg: MatrixRoomTopic): Promise<void>;
}

export interface RoomAvatarHandlingNetworkAPI extends NetworkAPI {
  handleMatrixRoomAvatar(ctx: BridgeRequestContext, msg: MatrixRoomAvatar): Promise<void>;
}

export interface MuteHandlingNetworkAPI extends NetworkAPI {
  handleMatrixMute(ctx: BridgeRequestContext, msg: MatrixMute): Promise<void>;
}

export interface TagHandlingNetworkAPI extends NetworkAPI {
  handleMatrixTag(ctx: BridgeRequestContext, msg: MatrixTag): Promise<void>;
}

export interface MarkedUnreadHandlingNetworkAPI extends NetworkAPI {
  handleMatrixMarkedUnread(ctx: BridgeRequestContext, msg: MatrixMarkedUnread): Promise<void>;
}

export interface DeleteChatHandlingNetworkAPI extends NetworkAPI {
  handleMatrixDeleteChat(ctx: BridgeRequestContext, msg: MatrixDeleteChat): Promise<void>;
}

export type MatrixOutboundNetworkAPI =
  | MessageHandlingNetworkAPI
  | EditHandlingNetworkAPI
  | ReactionHandlingNetworkAPI
  | RedactionHandlingNetworkAPI
  | ReadReceiptHandlingNetworkAPI
  | TypingHandlingNetworkAPI
  | ReactionRemoveHandlingNetworkAPI
  | PollHandlingNetworkAPI
  | DisappearTimerChangingNetworkAPI
  | MembershipHandlingNetworkAPI
  | RoomNameHandlingNetworkAPI
  | RoomTopicHandlingNetworkAPI
  | RoomAvatarHandlingNetworkAPI
  | MuteHandlingNetworkAPI
  | TagHandlingNetworkAPI
  | MarkedUnreadHandlingNetworkAPI
  | DeleteChatHandlingNetworkAPI;

export interface LoginProcess {
  cancel(ctx?: BridgeRequestContext): Promise<void> | void;
  start(ctx?: BridgeRequestContext): Promise<LoginStep>;
}

export interface LoginProcessWithOverride extends LoginProcess {
  startWithOverride(override: UserLogin): Promise<LoginStep>;
  startWithOverride(ctx: BridgeRequestContext | undefined, override: UserLogin): Promise<LoginStep>;
}

export interface LoginProcessDisplayAndWait extends LoginProcess {
  wait(ctx?: BridgeRequestContext): Promise<LoginStep>;
}

export interface LoginProcessUserInput extends LoginProcess {
  submitUserInput(input: LoginUserInput): Promise<LoginStep>;
  submitUserInput(ctx: BridgeRequestContext | undefined, input: LoginUserInput): Promise<LoginStep>;
}

export interface LoginProcessCookies extends LoginProcess {
  submitCookies(cookies: LoginCookieInput): Promise<LoginStep>;
  submitCookies(ctx: BridgeRequestContext | undefined, cookies: LoginCookieInput): Promise<LoginStep>;
}

export interface LoginFlow {
  description: string;
  id: string;
  name: string;
}

export type LoginStepType = "user_input" | "cookies" | "display_and_wait" | "complete";
export type LoginDisplayType = "qr" | "emoji" | "code" | "nothing";
export type LoginUserInput = Record<string, string>;
export type LoginCookieInput = Record<string, string>;
export type LoginInputFieldType =
  | "username"
  | "password"
  | "phone_number"
  | "email"
  | "2fa_code"
  | "token"
  | "url"
  | "domain"
  | "select"
  | "captcha_code";

export interface LoginStep {
  complete?: LoginCompleteParams;
  cookies?: LoginCookiesParams;
  displayAndWait?: LoginDisplayAndWaitParams;
  instructions: string;
  stepId: string;
  type: LoginStepType;
  userInput?: LoginUserInputParams;
}

export interface LoginDisplayAndWaitParams {
  data?: string;
  imageUrl?: string;
  type: LoginDisplayType;
}

export type LoginCookieFieldSourceType = "cookie" | "local_storage" | "request_header" | "request_body" | "special";

export interface LoginCookieFieldSource {
  cookieDomain?: string;
  name: string;
  requestUrlRegex?: string;
  type: LoginCookieFieldSourceType;
}

export interface LoginCookieField {
  id: string;
  pattern?: string;
  required: boolean;
  sources: LoginCookieFieldSource[];
}

export interface LoginCookiesParams {
  extractJs?: string;
  fields: LoginCookieField[];
  url: string;
  userAgent?: string;
  waitForUrlPattern?: string;
}

export interface LoginInputDataField {
  defaultValue?: string;
  description: string;
  id: string;
  name: string;
  options?: string[];
  pattern?: string;
  type: LoginInputFieldType;
  validate?: (value: string) => string | Promise<string>;
}

export interface LoginUserInputParams {
  fields: LoginInputDataField[];
}

export interface LoginCompleteParams {
  userLogin?: UserLogin;
  userLoginId: UserLoginID;
}

export type RemoteEventType =
  | "unknown"
  | "message"
  | "message_upsert"
  | "edit"
  | "reaction"
  | "reaction_remove"
  | "reaction_sync"
  | "message_remove"
  | "read_receipt"
  | "delivery_receipt"
  | "mark_unread"
  | "typing"
  | "chat_info_change"
  | "chat_resync"
  | "chat_delete"
  | "backfill";

export interface RemoteEvent {
  addLogContext?(data: Record<string, unknown>): Record<string, unknown>;
  getPortalKey(): PortalKey;
  getSender(): EventSender;
  getType(): RemoteEventType;
}

export interface RemoteEventWithContextMutation extends RemoteEvent {
  mutateContext(ctx: BridgeRequestContext): BridgeRequestContext;
}

export interface RemoteEventWithUncertainPortalReceiver extends RemoteEvent {
  portalReceiverIsUncertain(): boolean;
}

export interface RemotePreHandler extends RemoteEvent {
  preHandle(ctx: BridgeRequestContext, portal: Portal): Promise<void> | void;
}

export interface RemotePostHandler extends RemoteEvent {
  postHandle(ctx: BridgeRequestContext, portal: Portal): Promise<void> | void;
}

export interface RemoteChatInfoChange extends RemoteEvent {
  getChatInfoChange(ctx: BridgeRequestContext): Promise<ChatInfoChange>;
}

export interface RemoteChatResync extends RemoteEvent {}

export interface RemoteChatResyncWithInfo extends RemoteChatResync {
  getChatInfo(ctx: BridgeRequestContext, portal: Portal): Promise<ChatInfo>;
}

export interface RemoteChatResyncBackfill extends RemoteChatResync {
  checkNeedsBackfill(ctx: BridgeRequestContext, latestMessage?: Message): Promise<boolean>;
}

export interface RemoteChatResyncBackfillBundle extends RemoteChatResyncBackfill {
  getBundledBackfillData(): unknown;
}

export interface RemoteBackfill extends RemoteEvent {
  getBackfillData(ctx: BridgeRequestContext, portal: Portal): Promise<FetchMessagesResponse>;
}

export interface RemoteDeleteOnlyForMe extends RemoteEvent {
  deleteOnlyForMe(): boolean;
}

export interface RemoteChatDelete extends RemoteDeleteOnlyForMe {}

export interface RemoteChatDeleteWithChildren extends RemoteChatDelete {
  deleteChildren(): boolean;
}

export interface RemoteEventThatMayCreatePortal extends RemoteEvent {
  shouldCreatePortal(): boolean;
}

export interface RemoteEventWithTargetMessage extends RemoteEvent {
  getTargetMessage(): MessageID;
}

export interface RemoteEventWithBundledParts extends RemoteEventWithTargetMessage {
  getTargetDBMessage(): Message[];
}

export interface RemoteEventWithTargetPart extends RemoteEventWithTargetMessage {
  getTargetMessagePart(): PartID;
}

export interface RemoteEventWithTimestamp extends RemoteEvent {
  getTimestamp(): Date;
}

export interface RemoteEventWithStreamOrder extends RemoteEvent {
  getStreamOrder(): number;
}

export interface RemoteMessage extends RemoteEvent {
  convertMessage(ctx: BridgeRequestContext, portal: Portal, intent: MatrixIntent): Promise<ConvertedMessage>;
  getID(): MessageID;
}

export interface RemoteMessageWithTransactionID extends RemoteMessage {
  getTransactionID(): TransactionID;
}

export interface RemoteMessageUpsert extends RemoteMessage {
  handleExisting(ctx: BridgeRequestContext, portal: Portal, intent: MatrixIntent, existing: Message[]): Promise<UpsertResult>;
}

export interface RemoteEdit extends RemoteEventWithTargetMessage {
  convertEdit(ctx: BridgeRequestContext, portal: Portal, intent: MatrixIntent, existing: Message[]): Promise<ConvertedEdit>;
}

export interface RemoteReaction extends RemoteEventWithTargetMessage {
  getEmoji(): string;
  getID(): ReactionID;
}

export interface RemoteReactionRemove extends RemoteEventWithTargetMessage {
  getEmoji?(): string;
  getID?(): ReactionID;
}

export interface RemoteMessageRemove extends RemoteEventWithTargetMessage {}

export interface RemoteReadReceipt extends RemoteEventWithTargetMessage {}

export interface RemoteDeliveryReceipt extends RemoteEventWithTargetMessage {}

export interface RemoteMarkUnread extends RemoteEventWithTargetMessage {
  getUnread(): boolean;
}

export interface RemoteTyping extends RemoteEvent {
  getTimeoutMs?(): number;
  isTyping(): boolean;
}

export interface PickleBridge {
  readonly client: MatrixClient | null;
  readonly connector: BridgeConnector;
  readonly context: BridgeContext | null;
  acceptMessageRequest(portalKey: PortalKey): Promise<MessageRequest>;
  createLogin(user: BridgeUser, flowId: string): Promise<LoginProcess>;
  createManagementRoom(options: BridgeCreateManagementRoomOptions): Promise<ManagementRoom>;
  backfill(options: BridgeBackfillOptions): Promise<MatrixAppserviceBatchSendResult>;
  backfillMessages(login: UserLogin, params: FetchMessagesParams): Promise<MatrixAppserviceBatchSendResult>;
  backfillPortal(login: UserLogin, portal: PortalReference, params?: Omit<FetchMessagesParams, "portal">): Promise<MatrixAppserviceBatchSendResult>;
  queueBackfill(login: UserLogin, params: BackfillQueueParams): Promise<BackfillQueueResult>;
  createPortal(login: UserLogin, options: BridgeCreatePortalOptions): Promise<Portal>;
  createPortalRoom(options: BridgeCreatePortalRoomOptions): Promise<Portal>;
  downloadMedia(options: DownloadMediaOptions): Promise<DownloadMediaResult>;
  flushRemoteEvents(): Promise<void>;
  getBridgeState(): BridgeState | null;
  getBridgeStatus(): BridgeStatus | null;
  getGhost(id: GhostID): Ghost | null;
  ghostUserId(localId: string): UserID;
  getMessageRequest(portalKey: PortalKey): Promise<MessageRequest | null>;
  getOwnProfile(): Promise<UserProfile>;
  getOwnUserId(): UserID | null;
  getPortal(portalKey: PortalKey): Portal | null;
  getPortalByMXID(mxid: RoomID): Portal | null;
  getUserInfo(userId: UserID): Promise<MatrixUserInfo>;
  loadUserLogin(login: UserLogin): Promise<NetworkAPI>;
  queue(login: UserLogin): RemoteEventQueue;
  queueRemoteEvent(login: UserLogin, event: RemoteEvent): QueueRemoteEventResult;
  registerGhost(ghost: Ghost): void;
  registerManagementRoom(room: ManagementRoom): void;
  registerPortal(portal: Portal): void;
  resolveIdentifier(login: UserLogin, identifier: ResolveIdentifierParams): Promise<ResolveIdentifierResponse>;
  sendMedia(options: BridgeSendMediaOptions): Promise<SentEvent>;
  setBridgeState(state: BridgeState): Promise<void>;
  setBridgeStatus(status: BridgeStatus): Promise<void>;
  sendMessageCheckpoints(checkpoints: MessageCheckpoint[]): boolean;
  setMessageRequest(request: MessageRequest): Promise<void>;
  setOwnProfile(profile: UserProfileUpdate): Promise<void>;
  setPortalMetadata(portalKey: PortalKey, metadata: unknown): Promise<Portal>;
  start(): Promise<void>;
  stop(): Promise<void>;
  uploadMedia(options: UploadMediaOptions): Promise<UploadMediaResult>;
}

export interface CreateBridgeOptions {
  appservice?: MatrixAppserviceInitOptions;
  beeper?: BridgeBeeperOptions;
  connector: BridgeConnector;
  dataStore?: BridgeDataStore;
  log?: BridgeLogger;
  matrix: BridgeMatrixConfig;
}

export interface BridgeBeeperOptions {
  bridge: string;
  bridgeType?: string;
  ownerUserId?: UserID;
}

export interface CreateBeeperBridgeOptions extends Omit<CreateBridgeOptions, "appservice" | "matrix"> {
  account: MatrixAccount;
  address?: string;
  baseDomain?: string;
  bridge: string;
  bridgeType?: string;
  getOnly?: boolean;
  homeserverDomain?: string;
  matrix?: Partial<Omit<BridgeMatrixConfig, "account">>;
  store?: MatrixStore;
}

export interface BridgeMatrixConfig extends Pick<MatrixClientOptions, "account" | "appservice" | "beeper" | "deviceId" | "fetch" | "homeserver" | "logger" | "pickleKey" | "randomBytes" | "recoveryKey" | "store" | "token" | "verifyRecoveryOnStart" | "wasmBytes" | "wasmModule" | "wasmUrl"> {
  store: MatrixStore;
}

export interface NodeBridgeMatrixConfig extends Omit<BridgeMatrixConfig, "wasmUrl"> {
  wasmExecPath?: string;
  wasmPath?: string;
}

export interface CreateNodeBridgeOptions extends Omit<CreateBridgeOptions, "matrix"> {
  matrix: NodeBridgeMatrixConfig;
}

export interface CreateNodeBeeperBridgeOptions extends Omit<CreateBeeperBridgeOptions, "matrix"> {
  dataDir?: string;
  matrix?: Partial<NodeBridgeMatrixConfig>;
}

export interface BridgeContext {
  bridge: PickleBridge;
  client: MatrixClient;
  dataStore?: BridgeDataStore;
  log: BridgeLogger;
  queue(login: UserLogin): RemoteEventQueue;
  queueRemoteEvent(login: UserLogin, event: RemoteEvent): QueueRemoteEventResult;
}

export interface BridgeStartContext extends BridgeContext {}

export interface BridgeRequestContext extends BridgeContext {
  signal?: AbortSignal;
}

export interface LoginCreateContext extends BridgeRequestContext {}

export interface LoadUserLoginContext extends BridgeRequestContext {}

export interface ConnectContext extends BridgeRequestContext {
  login: UserLogin;
}

export interface BridgeLogger {
  (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void;
}

export interface QueueRemoteEventResult {
  event: RemoteEvent;
  queued: boolean;
}

export interface RemoteEventQueue {
  backfill(options: BridgeRemoteBackfillOptions): QueueRemoteEventResult;
  event(event: RemoteEvent | BridgeRemoteEventOptions): QueueRemoteEventResult;
  message<T = unknown>(options: BridgeRemoteMessageOptions<T>): QueueRemoteEventResult;
}

export interface BridgeRemoteBackfillOptions {
  cursor?: PaginationCursor;
  forward?: boolean;
  hasMore?: boolean;
  markRead?: boolean;
  messages: BridgeRemoteBackfillMessageOptions[];
  portal: PortalReference;
  progress?: BackfillProgress;
}

export interface BridgeRemoteBackfillMessageOptions<T = unknown> extends Omit<BridgeRemoteMessageOptions<T>, "portal"> {
  portal?: PortalReference;
}

export interface BridgeCreatePortalRoomOptions {
  avatarUrl?: string;
  info?: ChatInfo;
  initialState?: { content: Record<string, unknown>; stateKey: string; type: string }[];
  invite?: UserID[];
  messageRequest?: boolean;
  metadata?: unknown;
  name?: string;
  portalKey: PortalKey;
  roomType?: "dm" | "group_dm" | "default" | "space" | string;
  topic?: string;
  userId?: string;
}

export interface BridgeCreatePortalOptions extends Omit<BridgeCreatePortalRoomOptions, "portalKey" | "userId"> {
  id: PortalID;
  sender?: GhostID;
}

export interface BridgeBackfillOptions extends MatrixAppserviceBatchSendOptions {}

export interface BridgeCreateManagementRoomOptions {
  invite?: UserID[];
  metadata?: unknown;
  name?: string;
  topic?: string;
  userId?: string;
}

export interface ManagementRoom {
  metadata?: unknown;
  mxid: RoomID;
}

export interface MatrixCommand {
  args: string[];
  body: string;
  command: string;
  event: MatrixMessageEvent;
  prefix: string;
  room: ManagementRoom;
  sender: MatrixEventSender;
  text: string;
}

export interface MatrixCommandResponse {
  content?: Record<string, unknown>;
  handled: boolean;
  text?: string;
}

export type {
  MatrixAppserviceInitOptions,
  MatrixAppserviceSendMessageOptions,
};

export interface MatrixDispatchResult {
  dispatched: boolean;
  eventId?: EventID;
  handlers: number;
  kind: string;
  roomId?: RoomID;
}

export interface BridgeInfoVersion {
  capabilities: number;
  info: number;
}

export interface NetworkGeneralCapabilities {
  aggressiveUpdateInfo?: boolean;
  disappearingMessages?: boolean;
  implicitReadReceipts?: boolean;
  native?: boolean;
  provisioning?: ProvisioningCapabilities;
}

export interface ProvisioningCapabilities {
  groupCreation?: Record<string, GroupTypeCapabilities>;
  resolveIdentifier?: ResolveIdentifierCapabilities;
}

export interface ResolveIdentifierCapabilities {
  contactList?: boolean;
  createDM?: boolean;
  lookupPhone?: boolean;
  lookupUsername?: boolean;
}

export interface GroupTypeCapabilities {
  name?: GroupFieldCapability;
  participants?: GroupFieldCapability;
  topic?: GroupFieldCapability;
}

export interface GroupFieldCapability {
  allowed: boolean;
  maxLength?: number;
  minLength?: number;
  required?: boolean;
}

export interface RoomFeatures {
  [key: string]: unknown;
  id: string;
}

export type PushType = "fcm" | "web" | "apns";

export interface PushConfig {
  apns?: { bundleId: string };
  fcm?: { senderId: string };
  web?: { vapidKey: string };
}

export interface PushNotificationParseResult {
  data?: unknown;
  userLoginId: UserLoginID;
}

export interface GetMediaResponse {
  body: BodyInit | Uint8Array | ArrayBuffer;
  contentLength?: number;
  contentType?: string;
  filename?: string;
}

export interface ImportedImagePack {
  content: Record<string, unknown>;
  extra?: Record<string, unknown>;
  shortcode?: string;
}

export interface ImagePackMetadata {
  [key: string]: unknown;
}

export interface EventSender {
  isFromMe: boolean;
  sender: UserID;
  senderLogin?: UserLoginID;
}

export interface BridgeUser {
  id: string;
  metadata?: unknown;
}

export interface UserLogin {
  client?: NetworkAPI;
  id: UserLoginID;
  metadata?: unknown;
  remoteName?: string;
  userId?: string;
}

export interface Portal {
  id: PortalID;
  metadata?: unknown;
  mxid?: string;
  portalKey: PortalKey;
  receiver?: UserLoginID;
  roomType?: "dm" | "group" | "space" | string;
}

export interface Ghost {
  avatar?: Avatar;
  displayName?: string;
  id: GhostID;
  metadata?: unknown;
  mxid?: string;
}

export type BridgeState = "starting" | "running" | "stopping" | "stopped" | "degraded" | "error";

export type BridgeStateEvent =
  | "STARTING"
  | "UNCONFIGURED"
  | "RUNNING"
  | "BRIDGE_UNREACHABLE"
  | "CONNECTING"
  | "BACKFILLING"
  | "CONNECTED"
  | "TRANSIENT_DISCONNECT"
  | "BAD_CREDENTIALS"
  | "UNKNOWN_ERROR"
  | "LOGGED_OUT";

export interface RemoteProfile {
  avatar?: Avatar;
  displayName?: string;
  metadata?: unknown;
}

export interface BridgeStatePayload {
  error?: string;
  info?: Record<string, unknown>;
  message?: string;
  reason?: string;
  remote_id?: UserLoginID;
  remote_name?: string;
  remote_profile?: RemoteProfile;
  source?: string;
  state_event: BridgeStateEvent;
  timestamp: number;
  ttl: number;
  user_action?: string;
  user_id?: UserID;
}

export interface BridgeStatus {
  bridgeState?: BridgeStatePayload;
  logins?: Record<UserLoginID, BridgeStatePayload>;
  message?: string;
  metadata?: unknown;
  state: BridgeState;
  updatedAt: Date;
}

export interface MessageRequest {
  metadata?: unknown;
  portalKey: PortalKey;
  requestedBy?: UserID;
  status: "pending" | "accepted" | "rejected";
  updatedAt: Date;
}

export interface ResolveIdentifierParams {
  createDM?: boolean;
  identifier: string;
  type?: "phone" | "username" | "mxid" | "email";
}

export interface ResolveIdentifierResponse {
  ghost?: Ghost;
  metadata?: unknown;
  portal?: Portal;
  userId?: UserID;
}

export interface UserProfile {
  avatarUrl?: string;
  displayName?: string;
}

export interface UserProfileUpdate extends UserProfile {}

export interface DownloadMediaOptions {
  contentUri: string;
  params?: Record<string, string>;
}

export interface DownloadMediaResult extends GetMediaResponse {
  bytes?: Uint8Array;
}

export interface BridgeSendMediaOptions extends SendMediaMessageOptions {}

export interface Message {
  id: MessageID;
  metadata?: unknown;
  mxid?: string;
  partId?: PartID;
  senderId?: UserID;
  timestamp?: Date;
}

export interface Reaction {
  id?: ReactionID;
  metadata?: unknown;
  mxid?: string;
}

export interface ConvertedMessage {
  disappearingTimer?: number;
  parts: ConvertedMessagePart[];
}

export interface ConvertedMessagePart {
  content: Record<string, unknown>;
  extra?: Record<string, unknown>;
  id?: PartID;
  type: string;
}

export interface ConvertedEdit {
  modifiedParts: ConvertedMessagePart[];
}

export interface UpsertResult {
  deleteExisting?: boolean;
  handled?: boolean;
}

export interface MatrixIntent {
  client: MatrixClient;
  sendMessage(roomId: RoomID, content: Record<string, unknown>): Promise<SentEvent>;
}

export interface CreateRemoteMessageOptions<T = unknown> {
  convert(ctx: BridgeRequestContext, portal: Portal, intent: MatrixIntent, data: T): Promise<ConvertedMessage> | ConvertedMessage;
  createPortal?: boolean;
  data: T;
  id: MessageID;
  portalKey: PortalKey;
  sender: EventSender;
  streamOrder?: number;
  timestamp?: Date;
  transactionId?: TransactionID;
  type?: "message" | "message_upsert";
}

export interface BridgeRemoteEventOptions {
  event: Omit<RemoteEvent, "getPortalKey" | "getSender"> & Record<string, unknown>;
  portal: PortalReference;
  sender?: GhostID | EventSender;
}

export interface BridgeRemoteMessageOptions<T = unknown> extends Omit<Partial<CreateRemoteMessageOptions<T>>, "portalKey" | "sender"> {
  content?: Record<string, unknown>;
  data?: T;
  id: MessageID;
  parts?: ConvertedMessagePart[];
  portal: PortalReference;
  sender: GhostID | EventSender;
  text?: string;
}

export interface MatrixMessageResponse {
  db?: Message;
  pending?: boolean;
  postSave?: (ctx: BridgeRequestContext, message: Message) => Promise<void> | void;
  removePending?: TransactionID;
  streamOrder?: number;
}

export interface MatrixReactionPreResponse {
  emoji: string;
  maxReactions?: number;
  senderId?: UserID;
}

export interface MatrixMessage {
  attachments: MatrixAttachment[];
  content: Record<string, unknown>;
  event: MatrixMessageEvent;
  inputTransactionId?: TransactionID;
  portal: Portal;
  replyTo?: Message;
  sender: MatrixEventSender;
  text: string;
  threadRoot?: Message;
}

export interface MatrixEdit extends MatrixMessage {
  existing: Message[];
  targetMessage: Message;
}

export interface MatrixReaction {
  content: MatrixReactionEvent["content"];
  event: MatrixReactionEvent;
  inputTransactionId?: TransactionID;
  portal: Portal;
  preHandleResp?: MatrixReactionPreResponse;
  targetMessage: Message;
}

export interface MatrixReactionRemove extends MatrixReaction {
  targetReaction: Reaction;
}

export interface MatrixRedaction {
  eventId: EventID;
  portal: Portal;
  targetMessage?: Message;
}

export interface MatrixReadReceipt {
  portal: Portal;
  targetMessage: Message;
}

export interface MatrixTyping {
  portal: Portal;
  timeoutMs?: number;
  typing: boolean;
  userId: string;
}

export interface MatrixPollStart extends MatrixMessage {}

export interface MatrixPollVote extends MatrixMessage {
  voteTo: Message;
}

export interface MatrixDisappearTimer {
  portal: Portal;
  timerSeconds?: number;
}

export interface MatrixMembership {
  action: "invite" | "revoke_invite" | "leave" | "ban" | "kick";
  portal: Portal;
  userId: string;
}

export interface MatrixRoomName {
  name?: string;
  portal: Portal;
}

export interface MatrixRoomTopic {
  portal: Portal;
  topic?: string;
}

export interface MatrixRoomAvatar {
  avatarUrl?: string;
  portal: Portal;
}

export interface MatrixMute {
  muted: boolean;
  portal: Portal;
}

export interface MatrixTag {
  portal: Portal;
  tag: string;
  tagged: boolean;
}

export interface MatrixMarkedUnread {
  portal: Portal;
  unread: boolean;
}

export interface MatrixDeleteChat {
  onlyForMe?: boolean;
  portal: Portal;
}

export type MessageCheckpointReportedBy = "ASMUX" | "BRIDGE" | "HUNGRYSERV";
export type MessageCheckpointStatus =
  | "SUCCESS"
  | "WILL_RETRY"
  | "PERM_FAILURE"
  | "UNSUPPORTED"
  | "TIMEOUT"
  | "DELIVERED"
  | "DELIVERY_FAILED";
export type MessageCheckpointStep =
  | "CLIENT"
  | "HOMESERVER"
  | "BRIDGE"
  | "DECRYPTED"
  | "REMOTE"
  | "COMMAND";

export interface MessageCheckpoint {
  clientType?: string;
  clientVersion?: string;
  eventId: EventID;
  eventType: string;
  info?: string;
  manualRetryCount?: number;
  messageType?: string;
  originalEventId?: EventID;
  reportedBy: MessageCheckpointReportedBy;
  retryNum: number;
  roomId: RoomID;
  status: MessageCheckpointStatus;
  step: MessageCheckpointStep;
  timestamp: Date | number;
}

export interface MessageCheckpoints {
  checkpoints: MessageCheckpoint[];
}

export interface ChatInfo {
  avatar?: Avatar;
  name?: string;
  participants?: UserID[];
  topic?: string;
}

export interface ChatInfoChange {
  avatar?: Avatar;
  name?: string;
  participantsAdded?: UserID[];
  participantsRemoved?: UserID[];
  topic?: string;
}

export interface Avatar {
  id?: AvatarID;
  mxc?: string;
  remove?: boolean;
  url?: string;
}

export interface FetchMessagesParams {
  anchorMessage?: Message;
  bundledData?: unknown;
  count?: number;
  cursor?: PaginationCursor;
  forward?: boolean;
  limit?: number;
  portal: Portal;
  task?: BackfillQueueTask;
  threadRoot?: MessageID;
}

export interface FetchMessagesResponse {
  cursor?: PaginationCursor;
  forward?: boolean;
  hasMore?: boolean;
  markRead?: boolean;
  messages: BackfillMessage[];
  progress?: BackfillProgress;
}

export interface BackfillMessage {
  event: RemoteMessage;
  reactions?: BackfillReaction[];
}

export interface BackfillReaction {
  event: RemoteReaction;
}

export interface BackfillProgress {
  approximate?: number;
  remainingCount?: number;
  totalCount?: number;
}

export interface BackfillQueueTask {
  batchCount?: number;
  bridgeId?: BridgeID;
  completedAt?: Date;
  cursor?: PaginationCursor;
  dispatchedAt?: Date;
  done?: boolean;
  nextDispatchAt?: Date;
  oldestMessageId?: MessageID;
  pending?: boolean;
  portalKey: PortalKey;
  userLoginId: UserLoginID;
}

export interface BackfillQueueParams extends FetchMessagesParams {
  login?: UserLogin;
  markRead?: boolean;
  pending?: boolean;
  progress?: BackfillProgress;
}

export interface BackfillQueueResult {
  cursor?: PaginationCursor;
  forward?: boolean;
  hasMore?: boolean;
  markRead?: boolean;
  pending?: boolean;
  progress?: BackfillProgress;
  queued: boolean;
  task?: BackfillQueueTask;
}
