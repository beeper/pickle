import { startMatrixPolling, type MatrixPollingHandle } from "./polling";
import type {
  MatrixCore,
  MatrixCoreEvent,
  MatrixCoreHost,
  MatrixMessageEvent as RuntimeMessageEvent,
  MatrixReactionEvent as RuntimeReactionEvent,
} from "./runtime-types";
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
  MatrixAttachment,
  MatrixClientEvent,
  MatrixClientOptions,
  MatrixCryptoStatusEvent,
  MatrixMessageEvent,
  MatrixReactionEvent,
  MatrixSyncStatusEvent,
  MatrixWhoami,
  OpenDMOptions,
  OpenDMResult,
  PublishBeeperStreamOptions,
  ReactionOptions,
  RedactMessageOptions,
  RegisterBeeperStreamOptions,
  RoomInfo,
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
import { loadMatrixCore, type LoadMatrixCoreOptions } from "./wasm";

export interface MatrixClient {
  beeper: MatrixBeeper;
  close(): Promise<void>;
  connect(options?: { signal?: AbortSignal }): Promise<MatrixWhoami>;
  events: MatrixEvents;
  media: MatrixMedia;
  messages: MatrixMessages;
  reactions: MatrixReactions;
  rooms: MatrixRooms;
  sync: MatrixSync;
  typing: MatrixTyping;
  users: MatrixUsers;
  whoami(): Promise<MatrixWhoami>;
}

export interface MatrixBeeper {
  streams: {
    create(options: CreateBeeperStreamOptions): Promise<{ descriptor: Record<string, unknown> }>;
    publish(options: PublishBeeperStreamOptions): Promise<void>;
    register(options: RegisterBeeperStreamOptions): Promise<void>;
  };
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

export function createMatrixClient(options: MatrixClientOptions): MatrixClient {
  return new DefaultMatrixClient(options);
}

class DefaultMatrixClient implements MatrixClient {
  readonly events: MatrixEvents;
  readonly beeper: MatrixBeeper;
  readonly media: MatrixMedia;
  readonly messages: MatrixMessages;
  readonly reactions: MatrixReactions;
  readonly rooms: MatrixRooms;
  readonly sync: MatrixSync;
  readonly typing: MatrixTyping;
  readonly users: MatrixUsers;

  #core: MatrixCore | null = null;
  #listeners = new Set<(event: MatrixClientEvent) => void>();
  #options: MatrixClientOptions;
  #polling: MatrixPollingHandle | null = null;
  #unsubscribeCore: (() => void) | null = null;

  constructor(options: MatrixClientOptions) {
    this.#options = options;
    this.beeper = {
      streams: {
        create: (opts) => this.#coreRequired().createBeeperStream(opts),
        publish: (opts) => this.#coreRequired().publishBeeperStream(opts),
        register: (opts) => this.#coreRequired().registerBeeperStream(opts),
      },
    };
    this.events = {
      on: (listener) => this.#on(listener),
      onMessage: (listener) => this.#onKind("message", listener),
      onReaction: (listener) => this.#onKind("reaction", listener),
    };
    this.messages = {
      edit: (opts) =>
        this.#coreRequired().editMessage(stripUndefined({
          body: opts.text,
          content: opts.content,
          formattedBody: opts.html,
          mentions: opts.mentions,
          messageId: opts.eventId,
          msgtype: opts.messageType,
          roomId: opts.roomId,
        })),
      get: async (opts) => {
        const result = await this.#coreRequired().fetchMessage({
          messageId: opts.eventId,
          roomId: opts.roomId,
        });
        return { message: result.message ? toMessageEvent(result.message) : null };
      },
      list: async (opts) => {
        const result = await this.#coreRequired().fetchMessages(stripUndefined({
          cursor: opts.cursor,
          direction: opts.direction,
          limit: opts.limit,
          roomId: opts.roomId,
          threadRootEventId: opts.threadRoot,
        }));
        return stripUndefined({
          messages: result.messages.map(toMessageEvent),
          nextCursor: result.nextCursor,
        });
      },
      redact: (opts) =>
        this.#coreRequired().deleteMessage(stripUndefined({
          messageId: opts.eventId,
          reason: opts.reason,
          roomId: opts.roomId,
        })),
      send: (opts) =>
        this.#coreRequired().postMessage(stripUndefined({
          body: opts.text,
          content: opts.content,
          formattedBody: opts.html,
          mentions: opts.mentions,
          msgtype: opts.messageType,
          replyToEventId: opts.replyTo,
          roomId: opts.roomId,
          threadRootEventId: opts.threadRoot,
        })),
      sendMedia: (opts) =>
        this.#coreRequired().postMediaMessage(stripUndefined({
          body: opts.caption,
          bytesBase64: bytesToBase64(opts.bytes),
          contentType: opts.contentType,
          duration: opts.duration,
          filename: opts.filename,
          height: opts.height,
          msgtype: opts.kind ? `m.${opts.kind}` as "m.image" | "m.video" | "m.audio" | "m.file" : undefined,
          roomId: opts.roomId,
          size: opts.size,
          threadRootEventId: opts.threadRoot,
          width: opts.width,
        })),
    };
    this.reactions = {
      redact: (opts) =>
        this.#coreRequired().removeReaction({
          emoji: opts.key,
          messageId: opts.eventId,
          roomId: opts.roomId,
        }),
      send: (opts) =>
        this.#coreRequired().addReaction({
          emoji: opts.key,
          messageId: opts.eventId,
          roomId: opts.roomId,
        }),
    };
    this.media = {
      download: async (opts) => {
        const result = await this.#coreRequired().downloadMedia(opts);
        return { bytes: base64ToBytes(result.bytesBase64) };
      },
      downloadEncrypted: async (opts) => {
        const result = await this.#coreRequired().downloadEncryptedMedia(opts);
        return { bytes: base64ToBytes(result.bytesBase64) };
      },
      upload: (opts) =>
        this.#coreRequired().uploadMedia(stripUndefined({
          bytesBase64: bytesToBase64(opts.bytes),
          contentType: opts.contentType,
          filename: opts.filename,
        })),
      uploadEncrypted: (opts) =>
        this.#coreRequired().uploadEncryptedMedia(stripUndefined({
          bytesBase64: bytesToBase64(opts.bytes),
          contentType: opts.contentType,
          filename: opts.filename,
        })),
    };
    this.rooms = {
      get: (opts) => this.#coreRequired().fetchRoom(opts),
      invite: (opts) => this.#coreRequired().inviteUser(opts),
      join: (opts) => this.#coreRequired().joinRoom(opts),
      leave: (opts) => this.#coreRequired().leaveRoom(opts),
      listJoined: () => this.#coreRequired().fetchJoinedRooms(),
      openDM: (opts) => this.#coreRequired().openDM(opts),
      threads: {
        list: async (opts) => {
          const result = await this.#coreRequired().listRoomThreads(opts);
          return stripUndefined({
            nextCursor: result.nextCursor,
            threads: result.threads.map((thread) => ({
              lastReplyTimestamp: thread.lastReplyTs,
              replyCount: thread.replyCount,
              root: toMessageEvent(thread.root),
            })),
          });
        },
      },
    };
    this.sync = {
      applyResponse: (opts) => this.#coreRequired().applySyncResponse(opts),
      once: (opts) => this.#coreRequired().syncOnce(opts),
      start: async (opts = {}) => {
        if (this.#polling) return;
        this.#polling = startMatrixPolling(this.#coreRequired(), opts);
      },
      stop: async () => {
        await this.#polling?.stop();
        this.#polling = null;
      },
    };
    this.typing = {
      set: (opts) => this.#coreRequired().setTyping(opts),
    };
    this.users = {
      get: (opts) => this.#coreRequired().getUser(opts),
    };
  }

  async close(): Promise<void> {
    await this.sync.stop();
    this.#unsubscribeCore?.();
    this.#unsubscribeCore = null;
    await this.#core?.close();
    this.#core = null;
  }

  async connect(): Promise<MatrixWhoami> {
    if (!this.#core) {
      const loadOptions: LoadMatrixCoreOptions = stripUndefined({
        host: this.#host(),
        wasmBytes: this.#options.wasmBytes,
        wasmModule: this.#options.wasmModule,
        wasmUrl: this.#options.wasmUrl,
      });
      this.#core = await loadMatrixCore(loadOptions);
      this.#unsubscribeCore = this.#core.onEvent((event) => this.#emit(event));
    }
    return this.#core.init(stripUndefined({
      accessToken: this.#options.token,
      deviceId: this.#options.deviceId,
      homeserverUrl: this.#options.homeserver,
      initialSyncMode: this.#options.initialSync === "catchUp" ? "catch_up" : this.#options.initialSync,
      initialSyncSince: this.#options.since,
      pickleKey: this.#options.pickleKey,
      recoveryCode: this.#options.recoveryCode,
      recoveryKey: this.#options.recoveryKey,
      userId: this.#options.userId,
      verifyRecoveryOnStart: this.#options.verifyRecoveryOnStart,
    }));
  }

  whoami(): Promise<MatrixWhoami> {
    return this.#coreRequired().whoami();
  }

  #coreRequired(): MatrixCore {
    if (!this.#core) {
      throw new Error("Matrix client is not connected. Call connect() first.");
    }
    return this.#core;
  }

  #emit(event: MatrixCoreEvent): void {
    const mapped = toClientEvent(event);
    if (!mapped) return;
    for (const listener of this.#listeners) {
      listener(mapped);
    }
  }

  #host(): MatrixCoreHost {
    return stripUndefined({
      fetch: this.#options.fetch,
      log: this.#options.logger,
      randomBytes: this.#options.randomBytes,
      state: this.#options.store,
    });
  }

  #on(listener: (event: MatrixClientEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #onKind<K extends MatrixClientEvent["kind"]>(
    kind: K,
    listener: (event: Extract<MatrixClientEvent, { kind: K }>) => void
  ): () => void {
    return this.#on((event) => {
      if (event.kind === kind) {
        listener(event as Extract<MatrixClientEvent, { kind: K }>);
      }
    });
  }
}

function toClientEvent(event: MatrixCoreEvent): MatrixClientEvent | null {
  if (event.type === "message") return toMessageEvent(event.event);
  if (event.type === "reaction") return toReactionEvent(event.event);
  if (event.type === "invite") return { kind: "invite", ...event.event };
  if (event.type === "sync_status") return toSyncEvent(event);
  if (event.type === "crypto_status") return toCryptoEvent(event);
  if (event.type === "decryption_error") {
    return stripUndefined({
      error: event.error,
      event: event.event
        ? { eventId: event.event.eventId, roomId: event.event.roomId, senderId: event.event.sender }
        : undefined,
      kind: "decryptionError",
    });
  }
  if (event.type === "error") return { error: event.error, kind: "error" };
  return null;
}

function toMessageEvent(event: RuntimeMessageEvent): MatrixMessageEvent {
  return stripUndefined({
    attachments: (event.attachments ?? []).map(toAttachment),
    class: "message",
    content: event.content,
    edited: event.isEdited ?? false,
    encrypted: event.isEncrypted ?? false,
    eventId: event.eventId,
    html: event.formattedBody,
    kind: "message",
    messageType: event.msgtype,
    raw: event.raw,
    roomId: event.roomId,
    sender: { isMe: event.isMe ?? false, userId: event.sender },
    text: event.body,
    threadRoot: event.threadRootEventId,
    timestamp: event.originServerTs,
    type: event.type,
  });
}

function toReactionEvent(event: RuntimeReactionEvent): MatrixReactionEvent {
  return stripUndefined({
    added: event.added ?? true,
    class: "message",
    content: event.content,
    eventId: event.eventId,
    key: event.key,
    kind: "reaction",
    raw: event.raw,
    relatesTo: event.relatesToEventId,
    roomId: event.roomId,
    sender: { isMe: event.isMe ?? false, userId: event.sender },
    timestamp: event.originServerTs,
    type: event.type,
  });
}

function toAttachment(
  attachment: NonNullable<RuntimeMessageEvent["attachments"]>[number]
): MatrixAttachment {
  return stripUndefined({
    contentType: attachment.info?.contentType,
    contentUri: attachment.contentUri,
    duration: attachment.info?.duration,
    encryptedFile: attachment.encryptedFile,
    filename: attachment.filename,
    height: attachment.info?.height,
    kind: attachment.msgtype.slice(2) as MatrixAttachment["kind"],
    size: attachment.info?.size,
    width: attachment.info?.width,
  });
}

function toSyncEvent(event: Extract<MatrixCoreEvent, { type: "sync_status" }>): MatrixSyncStatusEvent {
  const states = {
    init_step: "initStep",
    initialized: "initialized",
    retrying: "retrying",
    stopped: "stopped",
    synced: "synced",
    syncing: "syncing",
  } as const;
  return stripUndefined({
    durationMs: event.durationMs,
    error: event.error,
    failures: event.failures,
    kind: "sync",
    nextRetryMs: event.nextRetryMs,
    state: states[event.status],
    step: event.step,
  });
}

function toCryptoEvent(
  event: Extract<MatrixCoreEvent, { type: "crypto_status" }>
): MatrixCryptoStatusEvent {
  const states = {
    enabled: "enabled",
    key_backup_unavailable: "keyBackupUnavailable",
    recovery_cache_unavailable: "recoveryCacheUnavailable",
    recovery_key_cached: "recoveryKeyCached",
    recovery_key_loaded: "recoveryKeyLoaded",
    recovery_restored: "recoveryRestored",
    recovery_unverified: "recoveryUnverified",
  } as const;
  return stripUndefined({
    error: event.error,
    keyBackupVersion: event.keyBackupVersion,
    keyId: event.keyId,
    kind: "crypto",
    state: states[event.status],
  });
}

function stripUndefined<T extends object>(value: T): any {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, unknown] => entry[1] !== undefined)
  ) as T;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}
