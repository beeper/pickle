import type {
  MatrixAccountData,
  MatrixAppservice,
  MatrixBeeper,
  MatrixClient,
  MatrixCrypto,
  MatrixMedia,
  MatrixMessages,
  MatrixRaw,
  MatrixReceipts,
  MatrixReactions,
  MatrixRooms,
  MatrixStreams,
  MatrixSync,
  MatrixTyping,
  MatrixToDevice,
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
  MatrixSubscribeFilter,
  MatrixSubscribeOptions,
  MatrixSubscription,
  MatrixThreadSummary,
  MatrixWhoami,
} from "./types";
import { loadMatrixCore, type LoadMatrixCoreOptions } from "./wasm";

export function createMatrixClient(options: MatrixClientOptions): MatrixClient {
  return new DefaultMatrixClient(options);
}

class DefaultMatrixClient implements MatrixClient {
  readonly accountData: MatrixAccountData;
  readonly appservice: MatrixAppservice;
  readonly beeper: MatrixBeeper;
  readonly crypto: MatrixCrypto;
  readonly media: MatrixMedia;
  readonly messages: MatrixMessages;
  readonly reactions: MatrixReactions;
  readonly raw: MatrixRaw;
  readonly receipts: MatrixReceipts;
  readonly rooms: MatrixRooms;
  readonly streams: MatrixStreams;
  readonly sync: MatrixSync;
  readonly typing: MatrixTyping;
  readonly toDevice: MatrixToDevice;
  readonly users: MatrixUsers;

  #core: MatrixCore | null = null;
  #bootPromise: Promise<MatrixWhoami> | null = null;
  #options: MatrixClientOptions;
  #syncDone: Promise<void> | null = null;
  #syncReject: ((error: unknown) => void) | null = null;
  #syncResolve: (() => void) | null = null;
  #subscriptions = new Set<InternalSubscription>();
  #catchUpTarget: InternalSubscription | null = null;
  #unsubscribeCore: (() => void) | null = null;

  constructor(options: MatrixClientOptions) {
    this.#options = options;
    this.accountData = {
      get: (opts) => this.#withCore((core) => core.getAccountData(opts)),
      getRoom: (opts) => this.#withCore((core) => core.getRoomAccountData(opts)),
      set: (opts) => this.#withCore((core) => core.setAccountData(opts)),
      setRoom: (opts) => this.#withCore((core) => core.setRoomAccountData(opts)),
    };
    this.appservice = {
      batchSend: (opts) => this.#withCore((core) => core.appserviceBatchSend(opts)),
      createManagementRoom: (opts) => this.#withCore((core) => core.appserviceCreateManagementRoom(stripUndefined(opts))),
      createPortalRoom: (opts) => this.#withCore((core) => core.appserviceCreatePortalRoom(stripUndefined(opts))),
      createRoom: (opts) => this.#withCore((core) => core.appserviceCreateRoom(stripUndefined(opts))),
      ensureJoined: (opts) => this.#withCore((core) => core.appserviceEnsureJoined(opts)),
      ensureRegistered: (opts) => this.#withCore((core) => core.appserviceEnsureRegistered(opts)),
      init: (opts) => this.#withCore((core) => core.initAppservice(opts)),
      applyTransaction: (opts) => this.#withCore((core) => core.appserviceApplyTransaction(opts)),
      sendMessage: (opts) => this.#withCore(async (core) => {
        const result = await core.appserviceSendMessage(stripUndefined(opts));
        return { eventId: result.eventId, raw: result.raw, roomId: result.roomId };
      }),
    };
    this.beeper = {
      ephemeral: {
        send: (opts) =>
          this.#withCore((core) => core.sendEphemeralEvent(stripUndefined({
            content: opts.content ?? {},
            eventType: opts.eventType ?? "m.room.message",
            roomId: opts.roomId,
            transactionId: opts.transactionId,
          }))),
      },
      streams: {
        create: (opts) => this.#withCore((core) => core.createBeeperStream(opts)),
        publish: (opts) => this.#withCore((core) => core.publishBeeperStream(opts)),
        register: (opts) => this.#withCore((core) => core.registerBeeperStream(opts)),
      },
    };
    this.crypto = {
      status: async () => toCryptoStatusSnapshot(await this.#withCore((core) => core.getCryptoStatus())),
    };
    this.messages = {
      edit: (opts) => this.#withCore((core) => core.editMessage(stripUndefined({
          body: opts.text,
          content: opts.content,
          formattedBody: opts.html,
          mentions: opts.mentions,
          messageId: opts.eventId,
          msgtype: opts.messageType,
          roomId: opts.roomId,
          topLevelContent: opts.topLevelContent,
        }))),
      get: async (opts) => {
        const result = await this.#withCore((core) => core.fetchMessage({
          messageId: opts.eventId,
          roomId: opts.roomId,
        }));
        return { message: result.message ? toMessageEvent(result.message) : null };
      },
      list: async (opts) => {
        const result = await this.#withCore((core) => core.fetchMessages(stripUndefined({
          cursor: opts.cursor,
          direction: opts.direction,
          limit: opts.limit,
          roomId: opts.roomId,
          threadRootEventId: opts.threadRoot,
        })));
        return stripUndefined({
          messages: result.messages.map(toMessageEvent),
          nextCursor: result.nextCursor,
        });
      },
      markRead: (opts) => this.#withCore((core) => core.markRead(opts)),
      redact: (opts) => this.#withCore((core) => core.deleteMessage(stripUndefined({
          messageId: opts.eventId,
          reason: opts.reason,
          roomId: opts.roomId,
        }))),
      send: (opts) => this.#withCore((core) => core.postMessage(stripUndefined({
          body: opts.text,
          content: opts.content,
          formattedBody: opts.html,
          mentions: opts.mentions,
          msgtype: opts.messageType,
          replyToEventId: opts.replyTo,
          roomId: opts.roomId,
          threadRootEventId: opts.threadRoot,
        }))),
      sendMedia: (opts) => this.#withCore((core) => postMediaMessageBytes(core, opts)),
    };
    this.reactions = {
      redact: (opts) => this.#withCore((core) => core.removeReaction({
          emoji: opts.key,
          messageId: opts.eventId,
          roomId: opts.roomId,
        })),
      send: (opts) => this.#withCore((core) => core.addReaction({
          emoji: opts.key,
          messageId: opts.eventId,
          roomId: opts.roomId,
        })),
    };
    this.raw = {
      request: (opts) => this.#withCore((core) => core.rawRequest(opts)),
    };
    this.receipts = {
      send: (opts) => this.#withCore((core) => core.sendReceipt(opts)),
    };
    this.media = createMatrixMedia(() => this.#coreReady());
    this.rooms = {
      ban: (opts) => this.#withCore((core) => core.banUser(opts)),
      create: (opts) => this.#withCore((core) => core.createRoom(stripUndefined({
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
      }))),
      get: (opts) => this.#withCore((core) => core.fetchRoom(opts)),
      getPowerLevels: async (opts) => {
        const event = await this.#withCore((core) => core.fetchRoomStateEvent({
          eventType: "m.room.power_levels",
          roomId: opts.roomId,
          stateKey: "",
        }));
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
      getState: (opts) => this.#withCore((core) => core.fetchRoomState(opts)),
      getStateEvent: (opts) => this.#withCore((core) => core.fetchRoomStateEvent(stripUndefined({
        eventType: opts.eventType,
        roomId: opts.roomId,
        stateKey: opts.stateKey,
      }))),
      invite: (opts) => this.#withCore((core) => core.inviteUser(opts)),
      join: (opts) => this.#withCore((core) => core.joinRoom(opts)),
      kick: (opts) => this.#withCore((core) => core.kickUser(opts)),
      listPublic: (opts = {}) => this.#withCore((core) => core.listPublicRooms(stripUndefined(opts))),
      leave: (opts) => this.#withCore((core) => core.leaveRoom(opts)),
      listMembers: (opts) => this.#withCore((core) => core.fetchRoomMembers(stripUndefined(opts))),
      listJoined: () => this.#withCore((core) => core.fetchJoinedRooms()),
      openDM: (opts) => this.#withCore((core) => core.openDM(opts)),
      resolveAlias: (opts) => this.#withCore((core) => core.resolveRoomAlias(opts)),
      sendStateEvent: (opts) => this.#withCore((core) => core.sendRoomStateEvent(stripUndefined({
        content: opts.content,
        eventType: opts.eventType,
        roomId: opts.roomId,
        stateKey: opts.stateKey,
      }))),
      threads: {
        list: async (opts) => {
          const result = await this.#withCore((core) => core.listRoomThreads(opts));
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
      unban: (opts) => this.#withCore((core) => core.unbanUser(opts)),
    };
    this.streams = createMatrixStreams({
      beeper: this.beeper,
      clientOptions: this.#options,
      messages: this.messages,
    });
    this.sync = {
      applyResponse: (opts) => this.#withCore((core) => core.applySyncResponse(opts)),
    };
    this.typing = {
      set: (opts) => this.#withCore((core) => core.setTyping(opts)),
    };
    this.toDevice = {
      send: (opts) => this.#withCore((core) => core.sendToDevice(opts)),
    };
    this.users = {
      get: (opts) => this.#withCore((core) => core.getUser(opts)),
      getOwnAvatarUrl: () => this.#withCore((core) => core.getOwnAvatarURL()),
      getOwnDisplayName: () => this.#withCore((core) => core.getOwnDisplayName()),
      setOwnAvatarUrl: (opts) => this.#withCore((core) => core.setOwnAvatarURL(opts)),
      setOwnDisplayName: (opts) => this.#withCore((core) => core.setOwnDisplayName(opts)),
    };
    if (options.boot) void this.boot();
  }

  async close(): Promise<void> {
    await this.#stopSync();
    this.#unsubscribeCore?.();
    this.#unsubscribeCore = null;
    await this.#core?.close();
    this.#core = null;
    this.#bootPromise = null;
  }

  boot(): Promise<MatrixWhoami> {
    this.#bootPromise ??= this.#boot();
    return this.#bootPromise;
  }

  async subscribe(
    filter: MatrixSubscribeFilter,
    handler: (event: MatrixClientEvent) => void | Promise<void>,
    options: MatrixSubscribeOptions = {}
  ): Promise<MatrixSubscription> {
    const core = await this.#coreReady();
    const subscription = createSubscription(filter, handler, async () => {
      this.#subscriptions.delete(subscription);
      if (this.#subscriptions.size === 0) {
        await this.#stopSync();
      }
    });
    this.#subscriptions.add(subscription);
    if (options.live !== false) {
      await this.#startSync(core, options);
    }
    return {
      catchUp: () => this.#catchUp(subscription),
      done: subscription.done,
      stop: () => subscription.stop(),
    };
  }

  whoami(): Promise<MatrixWhoami> {
    return this.#withCore((core) => core.whoami());
  }

  logout(): Promise<void> {
    return this.#withCore((core) => core.logout());
  }

  async #boot(): Promise<MatrixWhoami> {
    const account = this.#accountOptions();
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
      accessToken: account.accessToken,
      appservice: this.#options.appservice,
      deviceId: this.#options.deviceId ?? account.deviceId,
      homeserverUrl: account.homeserver,
      initialSyncMode: "latest" as const,
      pickleKey: this.#options.pickleKey,
      recoveryKey: this.#options.recoveryKey,
      userId: account.userId,
      verifyRecoveryOnStart: this.#options.verifyRecoveryOnStart,
    }));
  }

  #accountOptions() {
    const account = this.#options.account;
    const homeserver = account?.homeserver ?? this.#options.homeserver;
    const accessToken = account?.accessToken ?? this.#options.token;
    if (!homeserver || !accessToken) {
      throw new Error("Matrix client requires account or homeserver/token options.");
    }
    return {
      accessToken,
      deviceId: account?.deviceId,
      homeserver,
      userId: account?.userId,
    };
  }

  async #coreReady(): Promise<MatrixCore> {
    await this.boot();
    if (!this.#core) {
      throw new Error("Matrix core failed to boot.");
    }
    return this.#core;
  }

  async #withCore<T>(fn: (core: MatrixCore) => Promise<T>): Promise<T> {
    return fn(await this.#coreReady());
  }

  async #startSync(core: MatrixCore, options: MatrixSubscribeOptions): Promise<void> {
    if (this.#syncDone) return;
    this.#syncDone = new Promise<void>((resolve, reject) => {
      this.#syncResolve = resolve;
      this.#syncReject = reject;
    });
    this.#syncDone.catch(() => undefined);
    try {
      await core.startSync(stripUndefined({
        beeperStreaming: this.#options.beeper,
        retryDelayMs: options.retryDelayMs,
        timeoutMs: options.timeoutMs,
      }));
    } catch (error) {
      this.#syncReject?.(error);
      this.#clearSyncDone();
      throw error;
    }
  }

  async #stopSync(): Promise<void> {
    for (const subscription of this.#subscriptions) {
      subscription.close();
    }
    this.#subscriptions.clear();
    try {
      await this.#core?.stopSync();
      this.#syncResolve?.();
    } catch (error) {
      this.#syncReject?.(error);
      throw error;
    } finally {
      this.#clearSyncDone();
    }
  }

  async #catchUp(subscription: InternalSubscription): Promise<void> {
    const core = await this.#coreReady();
    if (!this.#subscriptions.has(subscription)) return;
    this.#catchUpTarget = subscription;
    try {
      await core.syncOnce(stripUndefined({
        beeperStreaming: this.#options.beeper,
        replayMissed: true,
      }));
    } finally {
      this.#catchUpTarget = null;
    }
  }

  #clearSyncDone(): void {
    this.#syncDone = null;
    this.#syncReject = null;
    this.#syncResolve = null;
  }

  #emit(event: MatrixCoreEvent): void {
    const mapped = toClientEvent(event);
    if (!mapped) return;
    if (mapped.kind === "stream") {
      this.#options.logger?.("debug", "pickle_stream_event_emitted", {
        contentKeys: Object.keys(mapped.content ?? {}),
        eventId: mapped.eventId,
        roomId: mapped.roomId,
        type: mapped.type,
      });
    }
    if (mapped.kind === "error") {
      for (const subscription of this.#subscriptions) {
        subscription.fail(new Error(mapped.error));
      }
      this.#syncReject?.(new Error(mapped.error));
      return;
    }
    if (this.#catchUpTarget) {
      this.#catchUpTarget.emit(mapped);
      return;
    }
    for (const subscription of this.#subscriptions) {
      subscription.emit(mapped);
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

}

interface InternalSubscription {
  close(): void;
  done: Promise<void>;
  emit(event: MatrixClientEvent): void;
  fail(error: unknown): void;
  stop(): Promise<void>;
}

function createSubscription(
  filter: MatrixSubscribeFilter,
  handler: (event: MatrixClientEvent) => void | Promise<void>,
  onStop: () => Promise<void>
): InternalSubscription {
  let stopped = false;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  done.catch(() => undefined);
  return {
    close: () => {
      if (stopped) return;
      stopped = true;
      resolveDone();
    },
    done,
    emit: (event) => {
      if (stopped || !matchesFilter(filter, event)) return;
      try {
        void Promise.resolve(handler(event)).catch(rejectDone);
      } catch (error) {
        rejectDone(error);
      }
    },
    fail: (error) => rejectDone(error),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      resolveDone();
      await onStop();
    },
  };
}

function matchesFilter(filter: MatrixSubscribeFilter, event: MatrixClientEvent): boolean {
  if (!filter) return true;
  return matchesValue(filter.kind, event.kind)
    && matchesValue(filter.roomId, "roomId" in event ? event.roomId : undefined)
    && matchesValue(filter.type, "type" in event ? event.type : undefined)
    && matchesValue(filter.sender, eventSender(event))
    && matchesValue(filter.threadRoot, eventThreadRoot(event))
    && matchesValue(filter.relationEventId, eventRelationEventId(event));
}

function matchesValue(filter: string | string[] | undefined, value: string | undefined): boolean {
  if (filter === undefined) return true;
  if (value === undefined) return false;
  return Array.isArray(filter) ? filter.includes(value) : filter === value;
}

function eventSender(event: MatrixClientEvent): string | undefined {
  if ("sender" in event) {
    return typeof event.sender === "string" ? event.sender : event.sender?.userId;
  }
  return undefined;
}

function eventThreadRoot(event: MatrixClientEvent): string | undefined {
  return "threadRoot" in event ? event.threadRoot : undefined;
}

function eventRelationEventId(event: MatrixClientEvent): string | undefined {
  if ("relation" in event) return event.relation?.eventId;
  if ("relatesTo" in event) return event.relatesTo;
  return undefined;
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
