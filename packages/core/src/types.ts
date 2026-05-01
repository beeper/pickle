export interface MatrixLoginOptions {
  deviceId?: string;
  homeserverUrl: string;
  initialDeviceDisplayName?: string;
  password: string;
  username: string;
}

export interface MatrixTokenLoginOptions {
  deviceId?: string;
  homeserverUrl: string;
  initialDeviceDisplayName?: string;
  loginToken: string;
  type?: "m.login.token" | "org.matrix.login.jwt";
}

export interface MatrixLoginSession {
  accessToken: string;
  deviceId: string;
  homeserverUrl: string;
  userId: string;
}

export interface MatrixCoreInitOptions {
  accessToken: string;
  homeserverUrl: string;
  pickleKey?: string;
  recoveryCode?: string;
  recoveryKey?: string;
}

export interface MatrixWhoami {
  deviceId: string;
  userId: string;
}

export interface MatrixRawEvent {
  content: Record<string, unknown>;
  eventId: string;
  isMe?: boolean;
  originServerTs?: number;
  raw: unknown;
  roomId: string;
  sender: string;
  type: string;
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

export interface MatrixMessageEvent extends MatrixRawEvent {
  attachments?: MatrixMediaAttachment[];
  body: string;
  formattedBody?: string;
  isEncrypted?: boolean;
  isEdited?: boolean;
  msgtype: string;
  threadRootEventId?: string;
}

export interface MatrixReactionEvent extends MatrixRawEvent {
  added?: boolean;
  key: string;
  relatesToEventId: string;
}

export interface MatrixInviteEvent {
  inviter?: string;
  roomId: string;
  raw: unknown;
}

export type MatrixCoreEvent =
  | { event: MatrixMessageEvent; type: "message" }
  | { event: MatrixReactionEvent; type: "reaction" }
  | { event: MatrixInviteEvent; type: "invite" }
  | {
      error?: string;
      keyBackupVersion?: string;
      keyId?: string;
      status:
        | "enabled"
        | "key_backup_unavailable"
        | "recovery_restored"
        | "recovery_unverified";
      type: "crypto_status";
    }
  | {
      error: string;
      event?: Pick<MatrixRawEvent, "eventId" | "roomId" | "sender">;
      type: "decryption_error";
    }
  | { error: string; type: "error" }
  | { status: "initialized" | "syncing" | "stopped"; type: "sync_status" };

export interface MatrixSendMessageOptions {
  body: string;
  formattedBody?: string;
  mentions?: MatrixMentions;
  msgtype?: "m.text" | "m.notice" | "m.emote";
  replyToEventId?: string;
  roomId: string;
  threadRootEventId?: string;
}

export interface MatrixEditMessageOptions {
  body: string;
  formattedBody?: string;
  mentions?: MatrixMentions;
  messageId: string;
  msgtype?: "m.text" | "m.notice" | "m.emote";
  roomId: string;
}

export interface MatrixDeleteMessageOptions {
  messageId: string;
  reason?: string;
  roomId: string;
}

export interface MatrixReactionOptions {
  emoji: string;
  messageId: string;
  roomId: string;
}

export interface MatrixTypingOptions {
  roomId: string;
  timeoutMs?: number;
  typing: boolean;
}

export interface MatrixFetchMessagesOptions {
  cursor?: string;
  direction?: "backward" | "forward";
  limit?: number;
  roomId: string;
  threadRootEventId?: string;
}

export interface MatrixFetchMessagesResult {
  messages: MatrixMessageEvent[];
  nextCursor?: string;
}

export interface MatrixFetchMessageOptions {
  messageId: string;
  roomId: string;
}

export interface MatrixFetchMessageResult {
  message: MatrixMessageEvent | null;
}

export interface MatrixMarkReadOptions {
  eventId: string;
  roomId: string;
}

export interface MatrixUploadMediaOptions {
  bytesBase64: string;
  contentType?: string;
  filename?: string;
}

export interface MatrixUploadMediaResult {
  contentUri: string;
  raw: unknown;
}

export interface MatrixDownloadMediaOptions {
  contentUri: string;
}

export interface MatrixDownloadMediaResult {
  bytesBase64: string;
}

export interface MatrixEncryptedFile {
  hashes: {
    sha256: string;
  };
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

export interface MatrixUploadEncryptedMediaResult {
  contentUri: string;
  file: MatrixEncryptedFile;
  raw: unknown;
}

export interface MatrixDownloadEncryptedMediaOptions {
  file: MatrixEncryptedFile;
}

export interface MatrixRoomInfo {
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

export interface MatrixFetchRoomOptions {
  roomId: string;
}

export interface MatrixOpenDMOptions {
  userId: string;
}

export interface MatrixOpenDMResult {
  raw: unknown;
  roomId: string;
}

export interface MatrixGetUserOptions {
  userId: string;
}

export interface MatrixUserInfo {
  avatarUrl?: string;
  displayName?: string;
  raw: unknown;
  userId: string;
}

export interface MatrixJoinRoomOptions {
  roomIdOrAlias: string;
}

export interface MatrixJoinRoomResult {
  raw: unknown;
  roomId: string;
}

export interface MatrixLeaveRoomOptions {
  reason?: string;
  roomId: string;
}

export interface MatrixInviteUserOptions {
  reason?: string;
  roomId: string;
  userId: string;
}

export interface MatrixJoinedRoomsResult {
  raw: unknown;
  roomIds: string[];
}

export interface MatrixRawMessage {
  eventId: string;
  raw: unknown;
  roomId: string;
}

export interface MatrixMediaAttachment {
  contentUri?: string;
  encryptedFile?: MatrixEncryptedFile;
  filename?: string;
  info?: MatrixMediaInfo;
  msgtype: "m.image" | "m.video" | "m.audio" | "m.file";
}

export interface MatrixSendMediaMessageOptions extends MatrixMediaInfo {
  body?: string;
  bytesBase64: string;
  contentType?: string;
  filename?: string;
  msgtype?: "m.image" | "m.video" | "m.audio" | "m.file";
  roomId: string;
  threadRootEventId?: string;
}

export interface MatrixRoomThreadSummary {
  lastReplyTs?: number;
  replyCount?: number;
  root: MatrixMessageEvent;
}

export interface MatrixListRoomThreadsOptions {
  cursor?: string;
  limit?: number;
  roomId: string;
}

export interface MatrixListRoomThreadsResult {
  nextCursor?: string;
  threads: MatrixRoomThreadSummary[];
}

export interface MatrixSyncOnceOptions {
  timeoutMs?: number;
}

export interface MatrixApplySyncResponseOptions {
  response: unknown;
  since?: string;
}

export interface MatrixCore {
  addReaction(options: MatrixReactionOptions): Promise<MatrixRawMessage>;
  applySyncResponse(options: MatrixApplySyncResponseOptions): Promise<void>;
  close(): Promise<void>;
  deleteMessage(options: MatrixDeleteMessageOptions): Promise<void>;
  downloadEncryptedMedia(
    options: MatrixDownloadEncryptedMediaOptions
  ): Promise<MatrixDownloadMediaResult>;
  downloadMedia(options: MatrixDownloadMediaOptions): Promise<MatrixDownloadMediaResult>;
  editMessage(options: MatrixEditMessageOptions): Promise<MatrixRawMessage>;
  fetchMessage(options: MatrixFetchMessageOptions): Promise<MatrixFetchMessageResult>;
  fetchMessages(options: MatrixFetchMessagesOptions): Promise<MatrixFetchMessagesResult>;
  fetchRoom(options: MatrixFetchRoomOptions): Promise<MatrixRoomInfo>;
  fetchJoinedRooms(): Promise<MatrixJoinedRoomsResult>;
  getUser(options: MatrixGetUserOptions): Promise<MatrixUserInfo>;
  init(options: MatrixCoreInitOptions): Promise<MatrixWhoami>;
  inviteUser(options: MatrixInviteUserOptions): Promise<void>;
  joinRoom(options: MatrixJoinRoomOptions): Promise<MatrixJoinRoomResult>;
  leaveRoom(options: MatrixLeaveRoomOptions): Promise<void>;
  listRoomThreads(options: MatrixListRoomThreadsOptions): Promise<MatrixListRoomThreadsResult>;
  markRead(options: MatrixMarkReadOptions): Promise<void>;
  onEvent(listener: (event: MatrixCoreEvent) => void): () => void;
  openDM(options: MatrixOpenDMOptions): Promise<MatrixOpenDMResult>;
  postMediaMessage(options: MatrixSendMediaMessageOptions): Promise<MatrixRawMessage>;
  postMessage(options: MatrixSendMessageOptions): Promise<MatrixRawMessage>;
  removeReaction(options: MatrixReactionOptions): Promise<void>;
  setTyping(options: MatrixTypingOptions): Promise<void>;
  syncOnce(options?: MatrixSyncOnceOptions): Promise<void>;
  uploadEncryptedMedia(options: MatrixUploadMediaOptions): Promise<MatrixUploadEncryptedMediaResult>;
  uploadMedia(options: MatrixUploadMediaOptions): Promise<MatrixUploadMediaResult>;
  whoami(): Promise<MatrixWhoami>;
}

export interface MatrixCoreHost {
  fetch?: typeof fetch;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
  randomBytes?: (length: number) => Uint8Array;
  store?: MatrixKeyValueStore;
}

export interface MatrixKeyValueStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  set(key: string, value: Uint8Array): Promise<void>;
}
