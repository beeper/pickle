export interface MatrixStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  set(key: string, value: Uint8Array): Promise<void>;
}

export interface MatrixLogger {
  (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown): void;
}

export interface MatrixClientOptions {
  beeperStreaming?: boolean;
  deviceId?: string;
  fetch?: typeof fetch;
  homeserver: string;
  initialSync?: "persisted" | "latest" | "catchUp";
  logger?: MatrixLogger;
  pickleKey?: string;
  randomBytes?: (length: number) => Uint8Array;
  recoveryKey?: string;
  since?: string;
  store?: MatrixStore;
  token: string;
  userId?: string;
  verifyRecoveryOnStart?: boolean;
  wasmBytes?: BufferSource;
  wasmModule?: WebAssembly.Module;
  wasmUrl?: string | URL;
}

export interface MatrixBeeperStreamDescriptor {
  descriptor: Record<string, unknown>;
}

export type MatrixStream = AsyncIterable<string | Record<string, unknown>>;

export interface SendMatrixStreamOptions {
  mode?: "auto" | "beeper" | "edits";
  roomId: string;
  stream: MatrixStream;
  text?: string;
  threadRoot?: string;
  updateIntervalMs?: number;
}

export interface CreateBeeperStreamOptions {
  roomId: string;
  streamType?: string;
}

export interface RegisterBeeperStreamOptions {
  descriptor: Record<string, unknown>;
  eventId: string;
  roomId: string;
}

export interface PublishBeeperStreamOptions {
  content?: Record<string, unknown>;
  eventId: string;
  roomId: string;
}

export interface SendBeeperEphemeralOptions {
  content?: Record<string, unknown>;
  eventType?: string;
  roomId: string;
  transactionId?: string;
}

export interface MatrixSession {
  accessToken: string;
  deviceId: string;
  homeserver: string;
  userId: string;
}

export interface MatrixWhoami {
  deviceId: string;
  userId: string;
}

export interface MatrixMentions {
  room?: boolean;
  userIds?: string[];
}

export interface MatrixMediaInfo {
  contentType?: string;
  duration?: number;
  height?: number;
  size?: number;
  width?: number;
}

export interface MatrixEncryptedFile {
  hashes: { sha256: string };
  iv: string;
  key: {
    alg: "A256CTR";
    ext: true;
    k: string;
    key_ops: ["encrypt", "decrypt"];
    kty: "oct";
  };
  url: string;
  v: "v2";
}

export interface MatrixAttachment extends MatrixMediaInfo {
  contentUri?: string;
  encryptedFile?: MatrixEncryptedFile;
  filename?: string;
  kind: "image" | "video" | "audio" | "file";
}

export interface MatrixEventSender {
  isMe: boolean;
  userId: string;
}

export interface MatrixBaseEvent {
  class: "message" | "state" | "ephemeral" | "accountData" | "toDevice" | "unknown";
  content: Record<string, unknown>;
  eventId?: string;
  raw: unknown;
  roomId?: string;
  sender?: MatrixEventSender;
  stateKey?: string;
  timestamp?: number;
  type: string;
  unsigned?: Record<string, unknown>;
}

export type MatrixRelation =
  | { eventId: string; type: "m.replace" }
  | { eventId: string; key: string; type: "m.annotation" }
  | { eventId: string; isFallback?: boolean; replyTo?: string; type: "m.thread" }
  | { eventId: string; type: "m.reference" };

export interface MatrixMessageEvent extends MatrixBaseEvent {
  attachments: MatrixAttachment[];
  edited: boolean;
  encrypted: boolean;
  eventId: string;
  html?: string;
  kind: "message";
  mentions?: MatrixMentions;
  messageType: "m.text" | "m.notice" | "m.emote" | "m.image" | "m.video" | "m.audio" | "m.file" | string;
  relation?: MatrixRelation;
  replyTo?: string;
  replaces?: string;
  roomId: string;
  sender: MatrixEventSender;
  text: string;
  threadRoot?: string;
  type: "m.room.message" | string;
}

export interface MatrixReactionEvent extends MatrixBaseEvent {
  added: boolean;
  eventId: string;
  kind: "reaction";
  key: string;
  relatesTo: string;
  roomId: string;
  sender: MatrixEventSender;
  type: "m.reaction" | string;
}

export interface MatrixInviteEvent {
  inviter?: string;
  kind: "invite";
  raw: unknown;
  roomId: string;
}

export interface MatrixSyncStatusEvent {
  durationMs?: number;
  error?: string;
  failures?: number;
  kind: "sync";
  nextRetryMs?: number;
  state: "initialized" | "initStep" | "syncing" | "synced" | "retrying" | "stopped";
  step?: string;
}

export interface MatrixCryptoStatusEvent {
  error?: string;
  keyBackupVersion?: string;
  keyId?: string;
  kind: "crypto";
  state:
    | "enabled"
    | "keyBackupUnavailable"
    | "recoveryCacheUnavailable"
    | "recoveryKeyCached"
    | "recoveryKeyLoaded"
    | "recoveryRestored"
    | "recoveryUnverified";
}

export interface MatrixCryptoStatus {
  deviceId?: string;
  hasRecoveryKey: boolean;
  keyBackupVersion?: string;
  pendingDecryptionCount: number;
  state:
    | "disabled"
    | "enabled"
    | "keyBackupUnavailable"
    | "recoveryCacheUnavailable"
    | "recoveryKeyCached"
    | "recoveryKeyLoaded"
    | "recoveryRestored"
    | "recoveryUnverified";
  storeBacked: boolean;
  userId?: string;
}

export interface MatrixDecryptionErrorEvent {
  error: string;
  event?: Pick<MatrixBaseEvent, "eventId" | "roomId"> & { senderId?: string };
  kind: "decryptionError";
}

export interface MatrixErrorEvent {
  error: string;
  kind: "error";
}

export type MatrixClientEvent =
  | MatrixMessageEvent
  | MatrixReactionEvent
  | MatrixInviteEvent
  | MatrixSyncStatusEvent
  | MatrixCryptoStatusEvent
  | MatrixDecryptionErrorEvent
  | MatrixErrorEvent;

export interface SendMessageOptions {
  content?: Record<string, unknown>;
  html?: string;
  mentions?: MatrixMentions;
  messageType?: "m.text" | "m.notice" | "m.emote";
  replyTo?: string;
  roomId: string;
  text: string;
  threadRoot?: string;
}

export interface EditMessageOptions {
  content?: Record<string, unknown>;
  eventId: string;
  html?: string;
  mentions?: MatrixMentions;
  messageType?: "m.text" | "m.notice" | "m.emote";
  roomId: string;
  text: string;
}

export interface RedactMessageOptions {
  eventId: string;
  reason?: string;
  roomId: string;
}

export interface FetchMessageOptions {
  eventId: string;
  roomId: string;
}

export interface FetchMessageResult {
  message: MatrixMessageEvent | null;
}

export interface FetchMessagesOptions {
  cursor?: string;
  direction?: "backward" | "forward";
  limit?: number;
  roomId: string;
  threadRoot?: string;
}

export interface FetchMessagesResult {
  messages: MatrixMessageEvent[];
  nextCursor?: string;
}

export interface SentEvent {
  eventId: string;
  raw: unknown;
  roomId: string;
}

export interface ReactionOptions {
  eventId: string;
  key: string;
  roomId: string;
}

export interface TypingOptions {
  roomId: string;
  timeoutMs?: number;
  typing: boolean;
}

export interface MarkReadOptions {
  eventId: string;
  roomId: string;
}

export interface UploadMediaOptions extends MatrixMediaInfo {
  bytes: Uint8Array;
  filename?: string;
}

export interface UploadMediaResult {
  contentUri: string;
  raw: unknown;
}

export interface UploadEncryptedMediaResult extends UploadMediaResult {
  file: MatrixEncryptedFile;
}

export interface DownloadMediaOptions {
  contentUri: string;
}

export interface DownloadMediaResult {
  bytes: Uint8Array;
}

export interface DownloadEncryptedMediaOptions {
  file: MatrixEncryptedFile;
}

export interface SendMediaMessageOptions extends MatrixMediaInfo {
  bytes: Uint8Array;
  caption?: string;
  filename?: string;
  kind?: "image" | "video" | "audio" | "file";
  roomId: string;
  threadRoot?: string;
}

export interface RoomStateInput {
  content: Record<string, unknown>;
  stateKey?: string;
  type: string;
}

export interface CreateRoomOptions {
  creationContent?: Record<string, unknown>;
  initialState?: RoomStateInput[];
  invite?: string[];
  isDirect?: boolean;
  name?: string;
  preset?: "private_chat" | "public_chat" | "trusted_private_chat" | string;
  roomAliasName?: string;
  roomVersion?: string;
  topic?: string;
  visibility?: "public" | "private" | string;
}

export interface CreateRoomResult {
  raw: unknown;
  roomId: string;
}

export interface RoomInfo {
  encrypted: boolean;
  id: string;
  isDM?: boolean;
  joinRule?: string;
  memberCount?: number;
  name?: string;
  raw?: Record<string, unknown>;
  topic?: string;
  visibility?: "private" | "workspace" | "external" | "unknown";
}

export interface RoomStateEvent {
  content: Record<string, unknown>;
  eventId?: string;
  originServerTs?: number;
  raw: unknown;
  roomId: string;
  sender?: string;
  stateKey: string;
  type: string;
}

export interface FetchRoomStateOptions {
  roomId: string;
}

export interface FetchRoomStateEventOptions {
  eventType: string;
  roomId: string;
  stateKey?: string;
}

export interface FetchRoomStateResult {
  events: RoomStateEvent[];
  raw: unknown;
}

export interface SendRoomStateEventOptions {
  content: Record<string, unknown>;
  eventType: string;
  roomId: string;
  stateKey?: string;
}

export interface FetchRoomMembersOptions {
  at?: string;
  membership?: "join" | "invite" | "leave" | "ban" | "knock" | string;
  notMembership?: "join" | "invite" | "leave" | "ban" | "knock" | string;
  roomId: string;
}

export interface RoomMember {
  avatarUrl?: string;
  displayName?: string;
  membership: "join" | "invite" | "leave" | "ban" | "knock" | string;
  raw: unknown;
  reason?: string;
  userId: string;
}

export interface FetchRoomMembersResult {
  members: RoomMember[];
  raw: unknown;
}

export interface KickUserOptions {
  reason?: string;
  roomId: string;
  userId: string;
}

export interface BanUserOptions {
  reason?: string;
  redactEvents?: boolean;
  roomId: string;
  userId: string;
}

export interface UnbanUserOptions {
  reason?: string;
  roomId: string;
  userId: string;
}

export interface JoinRoomOptions {
  roomIdOrAlias: string;
}

export interface JoinRoomResult {
  raw: unknown;
  roomId: string;
}

export interface OpenDMOptions {
  userId: string;
}

export interface OpenDMResult {
  raw: unknown;
  roomId: string;
}

export interface UserInfo {
  avatarUrl?: string;
  displayName?: string;
  raw: unknown;
  userId: string;
}

export interface OwnDisplayNameResult {
  displayName?: string;
  raw: unknown;
}

export interface SetOwnDisplayNameOptions {
  displayName: string;
}

export interface OwnAvatarUrlResult {
  avatarUrl?: string;
}

export interface SetOwnAvatarUrlOptions {
  avatarUrl: string;
}

export interface ListThreadsOptions {
  cursor?: string;
  limit?: number;
  roomId: string;
}

export interface MatrixThreadSummary {
  lastReplyTimestamp?: number;
  replyCount?: number;
  root: MatrixMessageEvent;
}

export interface ListThreadsResult {
  nextCursor?: string;
  threads: MatrixThreadSummary[];
}

export interface SyncStartOptions {
  beeperStreaming?: boolean;
  retryDelayMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SyncOnceOptions {
  beeperStreaming?: boolean;
  timeoutMs?: number;
}

export interface ApplySyncResponseOptions {
  response: unknown;
  since?: string;
}
