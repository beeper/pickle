import type {
  ApplySyncResponseOptions,
  AccountDataOptions,
  AccountDataResult,
  BanUserOptions,
  CreateBeeperStreamOptions,
  CreateRoomOptions,
  CreateRoomResult,
  DownloadEncryptedMediaOptions,
  DownloadMediaOptions,
  DownloadMediaResult,
  DownloadMediaThumbnailOptions,
  EditMessageOptions,
  FetchMessageOptions,
  FetchMessageResult,
  FetchMessagesOptions,
  FetchMessagesResult,
  FetchRoomMembersOptions,
  FetchRoomMembersResult,
  FetchRoomPowerLevelsOptions,
  FetchRoomStateEventOptions,
  FetchRoomStateOptions,
  FetchRoomStateResult,
  JoinRoomOptions,
  JoinRoomResult,
  KickUserOptions,
  ListPublicRoomsOptions,
  ListPublicRoomsResult,
  ListThreadsOptions,
  ListThreadsResult,
  MarkReadOptions,
  MatrixClientEvent,
  MatrixCryptoStatus,
  MatrixSubscribeFilter,
  MatrixSubscribeOptions,
  MatrixSubscription,
  MatrixWhoami,
  OpenDMOptions,
  OpenDMResult,
  OwnAvatarUrlResult,
  OwnDisplayNameResult,
  PublishBeeperStreamOptions,
  ReactionOptions,
  RedactMessageOptions,
  RegisterBeeperStreamOptions,
  ResolveRoomAliasOptions,
  ResolveRoomAliasResult,
  RawRequestOptions,
  RawRequestResult,
  RoomInfo,
  RoomPowerLevels,
  RoomStateEvent,
  SendBeeperEphemeralOptions,
  SendMatrixStreamOptions,
  SendMediaMessageOptions,
  SendMessageOptions,
  SendReceiptOptions,
  SendRoomStateEventOptions,
  SendToDeviceOptions,
  SendToDeviceResult,
  SetOwnAvatarUrlOptions,
  SetOwnDisplayNameOptions,
  SetAccountDataOptions,
  SetRoomAccountDataOptions,
  SentEvent,
  TypingOptions,
  UnbanUserOptions,
  UploadEncryptedMediaResult,
  UploadMediaOptions,
  UploadMediaResult,
  UserInfo,
} from "./types";

export interface MatrixClient {
  beeper: MatrixBeeper;
  accountData: MatrixAccountData;
  boot(): Promise<MatrixWhoami>;
  close(): Promise<void>;
  crypto: MatrixCrypto;
  media: MatrixMedia;
  messages: MatrixMessages;
  reactions: MatrixReactions;
  raw: MatrixRaw;
  receipts: MatrixReceipts;
  rooms: MatrixRooms;
  streams: MatrixStreams;
  subscribe(
    filter: MatrixSubscribeFilter,
    handler: (event: MatrixClientEvent) => void | Promise<void>,
    options?: MatrixSubscribeOptions
  ): Promise<MatrixSubscription>;
  sync: MatrixSync;
  typing: MatrixTyping;
  toDevice: MatrixToDevice;
  users: MatrixUsers;
  logout(): Promise<void>;
  whoami(): Promise<MatrixWhoami>;
}

export interface MatrixRaw {
  request(options: RawRequestOptions): Promise<RawRequestResult>;
}

export interface MatrixAccountData {
  get(options: AccountDataOptions): Promise<AccountDataResult>;
  getRoom(options: AccountDataOptions & { roomId: string }): Promise<AccountDataResult>;
  set(options: SetAccountDataOptions): Promise<void>;
  setRoom(options: SetRoomAccountDataOptions): Promise<void>;
}

export interface MatrixToDevice {
  send(options: SendToDeviceOptions): Promise<SendToDeviceResult>;
}

export interface MatrixReceipts {
  send(options: SendReceiptOptions): Promise<void>;
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
  getPowerLevels(options: FetchRoomPowerLevelsOptions): Promise<RoomPowerLevels>;
  getState(options: FetchRoomStateOptions): Promise<FetchRoomStateResult>;
  getStateEvent(options: FetchRoomStateEventOptions): Promise<RoomStateEvent>;
  invite(options: { reason?: string; roomId: string; userId: string }): Promise<void>;
  join(options: JoinRoomOptions): Promise<JoinRoomResult>;
  kick(options: KickUserOptions): Promise<void>;
  listPublic(options?: ListPublicRoomsOptions): Promise<ListPublicRoomsResult>;
  leave(options: { reason?: string; roomId: string }): Promise<void>;
  listMembers(options: FetchRoomMembersOptions): Promise<FetchRoomMembersResult>;
  listJoined(): Promise<{ raw: unknown; roomIds: string[] }>;
  openDM(options: OpenDMOptions): Promise<OpenDMResult>;
  resolveAlias(options: ResolveRoomAliasOptions): Promise<ResolveRoomAliasResult>;
  sendStateEvent(options: SendRoomStateEventOptions): Promise<SentEvent>;
  threads: {
    list(options: ListThreadsOptions): Promise<ListThreadsResult>;
  };
  unban(options: UnbanUserOptions): Promise<void>;
}

export interface MatrixMedia {
  download(options: DownloadMediaOptions): Promise<DownloadMediaResult>;
  downloadThumbnail(options: DownloadMediaThumbnailOptions): Promise<DownloadMediaResult>;
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
}
