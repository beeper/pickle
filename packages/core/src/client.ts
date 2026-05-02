import { base64ToBytes, bytesToBase64 } from "./bytes";
import type {
  MatrixBeeper,
  MatrixClient,
  MatrixEvents,
  MatrixMedia,
  MatrixMessages,
  MatrixReactions,
  MatrixRooms,
  MatrixStreams,
  MatrixSync,
  MatrixTyping,
  MatrixUsers,
} from "./client-types";
import { toClientEvent, toMessageEvent } from "./events";
import { stripUndefined } from "./object";
import type { MatrixCore, MatrixCoreEvent, MatrixCoreHost } from "./runtime-types";
import { createMatrixStreams } from "./streams";
import type {
  MatrixClientEvent,
  MatrixClientOptions,
  MatrixThreadSummary,
  MatrixWhoami,
  SendMediaMessageOptions,
  SentEvent,
  UploadEncryptedMediaResult,
  UploadMediaOptions,
  UploadMediaResult,
} from "./types";
import { loadMatrixCore, type LoadMatrixCoreOptions } from "./wasm";

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
  readonly streams: MatrixStreams;
  readonly sync: MatrixSync;
  readonly typing: MatrixTyping;
  readonly users: MatrixUsers;

  #core: MatrixCore | null = null;
  #listeners = new Set<(event: MatrixClientEvent) => void>();
  #options: MatrixClientOptions;
  #syncAbort: (() => void) | null = null;
  #unsubscribeCore: (() => void) | null = null;

  constructor(options: MatrixClientOptions) {
    this.#options = options;
    this.beeper = {
      ephemeral: {
        send: (opts) =>
          this.#coreRequired().sendEphemeralEvent(stripUndefined({
            content: opts.content ?? {},
            eventType: opts.eventType ?? "m.room.message",
            roomId: opts.roomId,
            transactionId: opts.transactionId,
          })),
      },
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
      markRead: (opts) => this.#coreRequired().markRead(opts),
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
        this.#postMediaMessageBytes(opts),
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
        const core = this.#coreRequired();
        if (core.callBytesResult && core.supportsByteCalls?.()) {
          return { bytes: await core.callBytesResult("download_media_bytes", opts) };
        }
        const result = await core.downloadMedia(opts);
        return { bytes: base64ToBytes(result.bytesBase64) };
      },
      downloadEncrypted: async (opts) => {
        const core = this.#coreRequired();
        if (core.callBytesResult && core.supportsByteCalls?.()) {
          return { bytes: await core.callBytesResult("download_encrypted_media_bytes", opts) };
        }
        const result = await core.downloadEncryptedMedia(opts);
        return { bytes: base64ToBytes(result.bytesBase64) };
      },
      upload: (opts) => this.#uploadMediaBytes(opts),
      uploadEncrypted: (opts) => this.#uploadEncryptedMediaBytes(opts),
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
            threads: result.threads.map((thread): MatrixThreadSummary => ({
              ...(thread.lastReplyTs !== undefined ? { lastReplyTimestamp: thread.lastReplyTs } : {}),
              ...(thread.replyCount !== undefined ? { replyCount: thread.replyCount } : {}),
              root: toMessageEvent(thread.root),
            })),
          });
        },
      },
    };
    this.streams = createMatrixStreams({
      beeper: this.beeper,
      clientOptions: this.#options,
      messages: this.messages,
    });
    this.sync = {
      applyResponse: (opts) => this.#coreRequired().applySyncResponse(opts),
      once: (opts) => this.#coreRequired().syncOnce(opts),
      start: async (opts = {}) => {
        if (this.#syncAbort) return;
        if (opts.signal?.aborted) return;
        await this.#coreRequired().startSync(stripUndefined({
          retryDelayMs: opts.retryDelayMs,
          timeoutMs: opts.timeoutMs,
        }));
        const abort = () => void this.sync.stop();
        opts.signal?.addEventListener("abort", abort, { once: true });
        this.#syncAbort = () => opts.signal?.removeEventListener("abort", abort);
      },
      stop: async () => {
        this.#syncAbort?.();
        this.#syncAbort = null;
        await this.#core?.stopSync();
      },
    };
    this.typing = {
      set: (opts) => this.#coreRequired().setTyping(opts),
    };
    this.users = {
      get: (opts) => this.#coreRequired().getUser(opts),
    };
  }

  async #postMediaMessageBytes(opts: SendMediaMessageOptions): Promise<SentEvent> {
    const payload = stripUndefined({
      body: opts.caption,
      contentType: opts.contentType,
      duration: opts.duration,
      filename: opts.filename,
      height: opts.height,
      msgtype: opts.kind ? `m.${opts.kind}` as "m.image" | "m.video" | "m.audio" | "m.file" : undefined,
      roomId: opts.roomId,
      size: opts.size,
      threadRootEventId: opts.threadRoot,
      width: opts.width,
    });
    const core = this.#coreRequired();
    if (core.callBytesJson && core.supportsByteCalls?.()) {
      return core.callBytesJson("post_media_message_bytes", payload, opts.bytes);
    }
    return core.postMediaMessage({ ...payload, bytesBase64: bytesToBase64(opts.bytes) });
  }

  async #uploadMediaBytes(opts: UploadMediaOptions): Promise<UploadMediaResult> {
    const payload = stripUndefined({
      contentType: opts.contentType,
      filename: opts.filename,
    });
    const core = this.#coreRequired();
    if (core.callBytesJson && core.supportsByteCalls?.()) {
      return core.callBytesJson("upload_media_bytes", payload, opts.bytes);
    }
    return core.uploadMedia({ ...payload, bytesBase64: bytesToBase64(opts.bytes) });
  }

  async #uploadEncryptedMediaBytes(opts: UploadMediaOptions): Promise<UploadEncryptedMediaResult> {
    const payload = stripUndefined({
      contentType: opts.contentType,
      filename: opts.filename,
    });
    const core = this.#coreRequired();
    if (core.callBytesJson && core.supportsByteCalls?.()) {
      return core.callBytesJson("upload_encrypted_media_bytes", payload, opts.bytes);
    }
    return core.uploadEncryptedMedia({ ...payload, bytesBase64: bytesToBase64(opts.bytes) });
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
    const initialSyncMode: "persisted" | "latest" | "catch_up" | undefined =
      this.#options.initialSync === "catchUp" ? "catch_up" : this.#options.initialSync;
    return this.#core.init(stripUndefined({
      accessToken: this.#options.token,
      deviceId: this.#options.deviceId,
      homeserverUrl: this.#options.homeserver,
      initialSyncMode,
      initialSyncSince: this.#options.since,
      pickleKey: this.#options.pickleKey,
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
