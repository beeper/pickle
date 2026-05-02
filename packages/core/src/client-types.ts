import type {
  ApplySyncResponseOptions,
  CreateBeeperStreamOptions,
  DownloadEncryptedMediaOptions,
  DownloadMediaOptions,
  DownloadMediaResult,
  EditMessageOptions,
  FetchMessageOptions,
  FetchMessageResult,
  FetchMessagesOptions,
  FetchMessagesResult,
  JoinRoomOptions,
  JoinRoomResult,
  ListThreadsOptions,
  ListThreadsResult,
  MarkReadOptions,
  MatrixClientEvent,
  MatrixMessageEvent,
  MatrixReactionEvent,
  MatrixWhoami,
  OpenDMOptions,
  OpenDMResult,
  PublishBeeperStreamOptions,
  ReactionOptions,
  RedactMessageOptions,
  RegisterBeeperStreamOptions,
  RoomInfo,
  SendBeeperEphemeralOptions,
  SendMatrixStreamOptions,
  SendMediaMessageOptions,
  SendMessageOptions,
  SentEvent,
  SyncOnceOptions,
  SyncStartOptions,
  TypingOptions,
  UploadEncryptedMediaResult,
  UploadMediaOptions,
  UploadMediaResult,
  UserInfo,
} from "./types";

export interface MatrixClient {
  beeper: MatrixBeeper;
  close(): Promise<void>;
  connect(options?: { signal?: AbortSignal }): Promise<MatrixWhoami>;
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
  get(options: { roomId: string }): Promise<RoomInfo>;
  invite(options: { reason?: string; roomId: string; userId: string }): Promise<void>;
  join(options: JoinRoomOptions): Promise<JoinRoomResult>;
  leave(options: { reason?: string; roomId: string }): Promise<void>;
  listJoined(): Promise<{ raw: unknown; roomIds: string[] }>;
  openDM(options: OpenDMOptions): Promise<OpenDMResult>;
  threads: {
    list(options: ListThreadsOptions): Promise<ListThreadsResult>;
  };
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
}

export interface MatrixSync {
  applyResponse(options: ApplySyncResponseOptions): Promise<void>;
  once(options?: SyncOnceOptions): Promise<void>;
  start(options?: SyncStartOptions): Promise<void>;
  stop(): Promise<void>;
}
