import type {
  ApplySyncResponseOptions,
  BanUserOptions,
  CreateBeeperStreamOptions,
  CreateRoomOptions,
  CreateRoomResult,
  DownloadEncryptedMediaOptions,
  DownloadMediaOptions,
  DownloadMediaResult,
  EditMessageOptions,
  FetchMessageOptions,
  FetchMessageResult,
  FetchMessagesOptions,
  FetchMessagesResult,
  FetchRoomMembersOptions,
  FetchRoomMembersResult,
  FetchRoomStateEventOptions,
  FetchRoomStateOptions,
  FetchRoomStateResult,
  JoinRoomOptions,
  JoinRoomResult,
  KickUserOptions,
  ListThreadsOptions,
  ListThreadsResult,
  MarkReadOptions,
  MatrixClientEvent,
  MatrixCryptoStatus,
  MatrixMessageEvent,
  MatrixReactionEvent,
  MatrixWhoami,
  OpenDMOptions,
  OpenDMResult,
  OwnAvatarUrlResult,
  OwnDisplayNameResult,
  PublishBeeperStreamOptions,
  ReactionOptions,
  RedactMessageOptions,
  RegisterBeeperStreamOptions,
  RoomInfo,
  RoomStateEvent,
  SendBeeperEphemeralOptions,
  SendMatrixStreamOptions,
  SendMediaMessageOptions,
  SendMessageOptions,
  SendRoomStateEventOptions,
  SetOwnAvatarUrlOptions,
  SetOwnDisplayNameOptions,
  SentEvent,
  SyncOnceOptions,
  SyncStartOptions,
  TypingOptions,
  UnbanUserOptions,
  UploadEncryptedMediaResult,
  UploadMediaOptions,
  UploadMediaResult,
  UserInfo,
} from "./types";

export interface MatrixClient {
  beeper: MatrixBeeper;
  close(): Promise<void>;
  connect(options?: { signal?: AbortSignal }): Promise<MatrixWhoami>;
  crypto: MatrixCrypto;
  events: MatrixEvents;
  media: MatrixMedia;
  messages: MatrixMessages;
  reactions: MatrixReactions;
  rooms: MatrixRooms;
  streams: MatrixStreams;
  sync: MatrixSync;
  typing: MatrixTyping;
  users: MatrixUsers;
  whoami(): Promise<MatrixWhoami>;
}

export interface MatrixBeeper {
  ephemeral: {
    send(options: SendBeeperEphemeralOptions): Promise<SentEvent>;
  };
  streams: {
    create(options: CreateBeeperStreamOptions): Promise<{ descriptor: Record<string, unknown> }>;
    publish(options: PublishBeeperStreamOptions): Promise<void>;
    register(options: RegisterBeeperStreamOptions): Promise<void>;
  };
}

export interface MatrixStreams {
  send(options: SendMatrixStreamOptions): Promise<SentEvent>;
}

export interface MatrixCrypto {
  status(): Promise<MatrixCryptoStatus>;
}

export interface MatrixEvents {
  on(listener: (event: MatrixClientEvent) => void): () => void;
  onMessage(listener: (event: MatrixMessageEvent) => void): () => void;
  onReaction(listener: (event: MatrixReactionEvent) => void): () => void;
}

export interface MatrixMessages {
  edit(options: EditMessageOptions): Promise<SentEvent>;
  get(options: FetchMessageOptions): Promise<FetchMessageResult>;
  list(options: FetchMessagesOptions): Promise<FetchMessagesResult>;
  markRead(options: MarkReadOptions): Promise<void>;
  redact(options: RedactMessageOptions): Promise<void>;
  send(options: SendMessageOptions): Promise<SentEvent>;
  sendMedia(options: SendMediaMessageOptions): Promise<SentEvent>;
}

export interface MatrixReactions {
  redact(options: ReactionOptions): Promise<void>;
  send(options: ReactionOptions): Promise<SentEvent>;
}

export interface MatrixRooms {
  ban(options: BanUserOptions): Promise<void>;
  create(options: CreateRoomOptions): Promise<CreateRoomResult>;
  get(options: { roomId: string }): Promise<RoomInfo>;
  getState(options: FetchRoomStateOptions): Promise<FetchRoomStateResult>;
  getStateEvent(options: FetchRoomStateEventOptions): Promise<RoomStateEvent>;
  invite(options: { reason?: string; roomId: string; userId: string }): Promise<void>;
  join(options: JoinRoomOptions): Promise<JoinRoomResult>;
  kick(options: KickUserOptions): Promise<void>;
  leave(options: { reason?: string; roomId: string }): Promise<void>;
  listMembers(options: FetchRoomMembersOptions): Promise<FetchRoomMembersResult>;
  listJoined(): Promise<{ raw: unknown; roomIds: string[] }>;
  openDM(options: OpenDMOptions): Promise<OpenDMResult>;
  sendStateEvent(options: SendRoomStateEventOptions): Promise<SentEvent>;
  threads: {
    list(options: ListThreadsOptions): Promise<ListThreadsResult>;
  };
  unban(options: UnbanUserOptions): Promise<void>;
}

export interface MatrixMedia {
  download(options: DownloadMediaOptions): Promise<DownloadMediaResult>;
  downloadEncrypted(options: DownloadEncryptedMediaOptions): Promise<DownloadMediaResult>;
  upload(options: UploadMediaOptions): Promise<UploadMediaResult>;
  uploadEncrypted(options: UploadMediaOptions): Promise<UploadEncryptedMediaResult>;
}

export interface MatrixTyping {
  set(options: TypingOptions): Promise<void>;
}

export interface MatrixUsers {
  get(options: { userId: string }): Promise<UserInfo>;
  getOwnAvatarUrl(): Promise<OwnAvatarUrlResult>;
  getOwnDisplayName(): Promise<OwnDisplayNameResult>;
  setOwnAvatarUrl(options: SetOwnAvatarUrlOptions): Promise<void>;
  setOwnDisplayName(options: SetOwnDisplayNameOptions): Promise<void>;
}

export interface MatrixSync {
  applyResponse(options: ApplySyncResponseOptions): Promise<void>;
  once(options?: SyncOnceOptions): Promise<void>;
  start(options?: SyncStartOptions): Promise<void>;
  stop(): Promise<void>;
}
