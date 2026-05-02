import type {
  MatrixBeeper,
  MatrixClient,
  MatrixCrypto,
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
import { toClientEvent, toCryptoStatusSnapshot, toMessageEvent } from "./events";
import { createMatrixMedia, postMediaMessageBytes } from "./media";
import { stripUndefined } from "./object";
import type { MatrixCore, MatrixCoreEvent, MatrixCoreHost } from "./runtime-types";
import { createMatrixStreams } from "./streams";
import type {
  MatrixClientEvent,
  MatrixClientOptions,
  MatrixThreadSummary,
  MatrixWhoami,
} from "./types";
import { loadMatrixCore, type LoadMatrixCoreOptions } from "./wasm";

export function createMatrixClient(options: MatrixClientOptions): MatrixClient {
  return new DefaultMatrixClient(options);
}

class DefaultMatrixClient implements MatrixClient {
  readonly events: MatrixEvents;
  readonly beeper: MatrixBeeper;
  readonly crypto: MatrixCrypto;
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
    this.crypto = {
      status: async () => toCryptoStatusSnapshot(await this.#coreRequired().getCryptoStatus()),
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
        postMediaMessageBytes(this.#coreRequired(), opts),
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
    this.media = createMatrixMedia(() => this.#coreRequired());
    this.rooms = {
      ban: (opts) => this.#coreRequired().banUser(opts),
      create: (opts) =>
        this.#coreRequired().createRoom(stripUndefined({
          creationContent: opts.creationContent,
          initialState: opts.initialState?.map((state) => ({
            content: state.content,
            stateKey: state.stateKey ?? "",
            type: state.type,
          })),
          invite: opts.invite,
          isDirect: opts.isDirect,
          name: opts.name,
          preset: opts.preset,
          roomAliasName: opts.roomAliasName,
          roomVersion: opts.roomVersion,
          topic: opts.topic,
          visibility: opts.visibility,
      })),
      get: (opts) => this.#coreRequired().fetchRoom(opts),
      getPowerLevels: async (opts) => {
        const event = await this.#coreRequired().fetchRoomStateEvent({
          eventType: "m.room.power_levels",
          roomId: opts.roomId,
          stateKey: "",
        });
        return stripUndefined({
          ban: readNumber(event.content.ban),
          events: readNumberRecord(event.content.events),
          eventsDefault: readNumber(event.content.events_default),
          invite: readNumber(event.content.invite),
          kick: readNumber(event.content.kick),
          notifications: readNumberRecord(event.content.notifications),
          raw: event.content,
          redact: readNumber(event.content.redact),
          stateDefault: readNumber(event.content.state_default),
          users: readNumberRecord(event.content.users),
          usersDefault: readNumber(event.content.users_default),
        });
      },
      getState: (opts) => this.#coreRequired().fetchRoomState(opts),
      getStateEvent: (opts) => this.#coreRequired().fetchRoomStateEvent(stripUndefined({
        eventType: opts.eventType,
        roomId: opts.roomId,
        stateKey: opts.stateKey,
      })),
      invite: (opts) => this.#coreRequired().inviteUser(opts),
      join: (opts) => this.#coreRequired().joinRoom(opts),
      kick: (opts) => this.#coreRequired().kickUser(opts),
      listPublic: (opts = {}) => this.#coreRequired().listPublicRooms(stripUndefined(opts)),
      leave: (opts) => this.#coreRequired().leaveRoom(opts),
      listMembers: (opts) => this.#coreRequired().fetchRoomMembers(stripUndefined(opts)),
      listJoined: () => this.#coreRequired().fetchJoinedRooms(),
      openDM: (opts) => this.#coreRequired().openDM(opts),
      resolveAlias: (opts) => this.#coreRequired().resolveRoomAlias(opts),
      sendStateEvent: (opts) => this.#coreRequired().sendRoomStateEvent(stripUndefined({
        content: opts.content,
        eventType: opts.eventType,
        roomId: opts.roomId,
        stateKey: opts.stateKey,
      })),
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
      unban: (opts) => this.#coreRequired().unbanUser(opts),
    };
    this.streams = createMatrixStreams({
      beeper: this.beeper,
      clientOptions: this.#options,
      messages: this.messages,
    });
    this.sync = {
      applyResponse: (opts) => this.#coreRequired().applySyncResponse(opts),
      once: (opts = {}) => this.#coreRequired().syncOnce(stripUndefined({
        beeperStreaming: opts.beeper ?? this.#options.beeper,
        timeoutMs: opts.timeoutMs,
      })),
      start: async (opts = {}) => {
        if (this.#syncAbort) return;
        if (opts.signal?.aborted) return;
        await this.#coreRequired().startSync(stripUndefined({
          beeperStreaming: opts.beeper ?? this.#options.beeper,
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
      getOwnAvatarUrl: () => this.#coreRequired().getOwnAvatarURL(),
      getOwnDisplayName: () => this.#coreRequired().getOwnDisplayName(),
      setOwnAvatarUrl: (opts) => this.#coreRequired().setOwnAvatarURL(opts),
      setOwnDisplayName: (opts) => this.#coreRequired().setOwnDisplayName(opts),
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

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readNumberRecord(value: unknown): Record<string, number> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const result: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}
