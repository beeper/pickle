import type {
  MatrixApplySyncResponseOptions,
  MatrixBeeperStreamOptions,
  MatrixCore,
  MatrixCreateBeeperStreamOptions,
  MatrixCreateBeeperStreamResult,
  MatrixCoreEvent,
  MatrixCoreHost,
  MatrixCoreInitOptions,
  MatrixDeleteMessageOptions,
  MatrixDownloadEncryptedMediaOptions,
  MatrixDownloadMediaOptions,
  MatrixDownloadMediaResult,
  MatrixEditMessageOptions,
  MatrixFetchMessageOptions,
  MatrixFetchMessageResult,
  MatrixFetchMessagesOptions,
  MatrixFetchMessagesResult,
  MatrixFetchRoomOptions,
  MatrixGetUserOptions,
  MatrixInviteUserOptions,
  MatrixJoinRoomOptions,
  MatrixJoinRoomResult,
  MatrixJoinedRoomsResult,
  MatrixLeaveRoomOptions,
  MatrixListRoomThreadsOptions,
  MatrixListRoomThreadsResult,
  MatrixMarkReadOptions,
  MatrixOpenDMOptions,
  MatrixOpenDMResult,
  MatrixRawMessage,
  MatrixReactionOptions,
  MatrixRegisterBeeperStreamOptions,
  MatrixRoomInfo,
  MatrixSendMediaMessageOptions,
  MatrixSendMessageOptions,
  MatrixSendEphemeralEventOptions,
  MatrixSyncOnceOptions,
  MatrixTypingOptions,
  MatrixUploadMediaOptions,
  MatrixUploadEncryptedMediaResult,
  MatrixUploadMediaResult,
  MatrixUserInfo,
  MatrixWhoami,
} from "./runtime-types";

export interface GoRuntime {
  importObject: WebAssembly.Imports;
  run(instance: WebAssembly.Instance): Promise<void>;
}

export interface GoRuntimeConstructor {
  new (): GoRuntime;
}

declare global {
  // Provided by Go's wasm_exec.js.
  var Go: GoRuntimeConstructor | undefined;
  var __matrixCoreCreate: ((host?: MatrixCoreHost) => string) | undefined;
  var __matrixCoreCall:
    | ((coreId: string, operation: string, payload: string) => Promise<string>)
    | undefined;
  var __matrixCoreEmit: ((coreId: string, payload: string) => void) | undefined;
}

const listenersByCore = new Map<string, Set<(event: MatrixCoreEvent) => void>>();
let runtimeBoot: Promise<void> | null = null;
let emitDispatcherInstalled = false;
let coreFactoryHooksInstalled = false;
let coreFactoryReadyPromise: Promise<void> | null = null;
let resolveCoreFactoryReady: (() => void) | null = null;

export interface LoadMatrixCoreOptions {
  go?: GoRuntime;
  host?: MatrixCoreHost;
  wasmBytes?: BufferSource;
  wasmModule?: WebAssembly.Module;
  wasmUrl?: string | URL;
}

export class MatrixWasmCore implements MatrixCore {
  readonly #listeners = new Set<(event: MatrixCoreEvent) => void>();
  readonly #coreId: string;
  readonly #host: MatrixCoreHost;

  constructor(coreId: string, host: MatrixCoreHost = {}) {
    this.#coreId = coreId;
    this.#host = host;
    listenersByCore.set(coreId, this.#listeners);
    installEmitDispatcher();
  }

  async #call<T>(operation: string, payload: unknown = {}): Promise<T> {
    const call = globalThis.__matrixCoreCall;
    if (!call) {
      throw new Error("Matrix WASM core is not ready");
    }
    const response = await call(this.#coreId, operation, JSON.stringify(payload));
    return JSON.parse(response) as T;
  }

  addReaction(options: MatrixReactionOptions): Promise<MatrixRawMessage> {
    return this.#call("add_reaction", options);
  }

  async applySyncResponse(options: MatrixApplySyncResponseOptions): Promise<void> {
    await this.#call("apply_sync_response", options);
  }

  async close(): Promise<void> {
    await this.#call("close");
    this.#listeners.clear();
    listenersByCore.delete(this.#coreId);
  }

  createBeeperStream(
    options: MatrixCreateBeeperStreamOptions
  ): Promise<MatrixCreateBeeperStreamResult> {
    return this.#call("create_beeper_stream", options);
  }

  async deleteMessage(options: MatrixDeleteMessageOptions): Promise<void> {
    await this.#call("delete_message", options);
  }

  downloadEncryptedMedia(
    options: MatrixDownloadEncryptedMediaOptions
  ): Promise<MatrixDownloadMediaResult> {
    return this.#call("download_encrypted_media", options);
  }

  downloadMedia(options: MatrixDownloadMediaOptions): Promise<MatrixDownloadMediaResult> {
    return this.#call("download_media", options);
  }

  editMessage(options: MatrixEditMessageOptions): Promise<MatrixRawMessage> {
    return this.#call("edit_message", options);
  }

  fetchMessage(options: MatrixFetchMessageOptions): Promise<MatrixFetchMessageResult> {
    return this.#call("fetch_message", options);
  }

  fetchMessages(options: MatrixFetchMessagesOptions): Promise<MatrixFetchMessagesResult> {
    return this.#call("fetch_messages", options);
  }

  fetchRoom(options: MatrixFetchRoomOptions): Promise<MatrixRoomInfo> {
    return this.#call("fetch_room", options);
  }

  fetchJoinedRooms(): Promise<MatrixJoinedRoomsResult> {
    return this.#call("fetch_joined_rooms");
  }

  getUser(options: MatrixGetUserOptions): Promise<MatrixUserInfo> {
    return this.#call("get_user", options);
  }

  init(options: MatrixCoreInitOptions): Promise<MatrixWhoami> {
    return this.#call("init", options);
  }

  async inviteUser(options: MatrixInviteUserOptions): Promise<void> {
    await this.#call("invite_user", options);
  }

  joinRoom(options: MatrixJoinRoomOptions): Promise<MatrixJoinRoomResult> {
    return this.#call("join_room", options);
  }

  async leaveRoom(options: MatrixLeaveRoomOptions): Promise<void> {
    await this.#call("leave_room", options);
  }

  listRoomThreads(options: MatrixListRoomThreadsOptions): Promise<MatrixListRoomThreadsResult> {
    return this.#call("list_room_threads", options);
  }

  async markRead(options: MatrixMarkReadOptions): Promise<void> {
    await this.#call("mark_read", options);
  }

  onEvent(listener: (event: MatrixCoreEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  openDM(options: MatrixOpenDMOptions): Promise<MatrixOpenDMResult> {
    return this.#call("open_dm", options);
  }

  postMessage(options: MatrixSendMessageOptions): Promise<MatrixRawMessage> {
    return this.#call("post_message", options);
  }

  postMediaMessage(options: MatrixSendMediaMessageOptions): Promise<MatrixRawMessage> {
    return this.#call("post_media_message", options);
  }

  async publishBeeperStream(options: MatrixBeeperStreamOptions): Promise<void> {
    await this.#call("publish_beeper_stream", options);
  }

  async registerBeeperStream(options: MatrixRegisterBeeperStreamOptions): Promise<void> {
    await this.#call("register_beeper_stream", options);
  }

  async removeReaction(options: MatrixReactionOptions): Promise<void> {
    await this.#call("remove_reaction", options);
  }

  sendEphemeralEvent(options: MatrixSendEphemeralEventOptions): Promise<MatrixRawMessage> {
    return this.#call("send_ephemeral_event", options);
  }

  async setTyping(options: MatrixTypingOptions): Promise<void> {
    await this.#call("set_typing", options);
  }

  async syncOnce(options: MatrixSyncOnceOptions = {}): Promise<void> {
    await this.#call("sync_once", options);
  }

  uploadMedia(options: MatrixUploadMediaOptions): Promise<MatrixUploadMediaResult> {
    return this.#call("upload_media", options);
  }

  uploadEncryptedMedia(
    options: MatrixUploadMediaOptions
  ): Promise<MatrixUploadEncryptedMediaResult> {
    return this.#call("upload_encrypted_media", options);
  }

  async unsubscribeBeeperStream(options: MatrixBeeperStreamOptions): Promise<void> {
    await this.#call("unsubscribe_beeper_stream", options);
  }

  whoami(): Promise<MatrixWhoami> {
    return this.#call("whoami");
  }
}

export async function loadMatrixCore(options: LoadMatrixCoreOptions): Promise<MatrixWasmCore> {
  await ensureRuntime(options);

  const create = globalThis.__matrixCoreCreate;
  if (!create) {
    throw new Error("Matrix WASM core did not register its factory function");
  }
  return new MatrixWasmCore(create(options.host ?? {}), options.host);
}

async function ensureRuntime(options: LoadMatrixCoreOptions): Promise<void> {
  if (globalThis.__matrixCoreCreate && globalThis.__matrixCoreCall) {
    return;
  }
  runtimeBoot ??= bootRuntime(options).catch((error) => {
    runtimeBoot = null;
    throw error;
  });
  await runtimeBoot;
}

async function bootRuntime(options: LoadMatrixCoreOptions): Promise<void> {
  if (globalThis.__matrixCoreCreate && globalThis.__matrixCoreCall) {
    return;
  }
  const GoCtor = globalThis.Go;
  const go = options.go ?? (GoCtor ? new GoCtor() : undefined);
  if (!go) {
    throw new Error("Go WASM runtime is missing. Load wasm_exec.js before loadMatrixCore().");
  }

  const module = await resolveWasmModule(options);
  const instance = await WebAssembly.instantiate(module, go.importObject);

  void go.run(instance).catch((error) => {
    globalThis.__matrixCoreEmit?.(
      "runtime",
      JSON.stringify({ error: String(error), type: "error" as const })
    );
  });

  await waitForCoreFactory();
}

async function resolveWasmModule(options: LoadMatrixCoreOptions): Promise<WebAssembly.Module> {
  if (options.wasmModule) {
    return options.wasmModule;
  }
  if (options.wasmBytes) {
    return WebAssembly.compile(options.wasmBytes);
  }
  if (options.wasmUrl) {
    const fetchImpl = options.host?.fetch ?? globalThis.fetch;
    const response = await fetchImpl(options.wasmUrl);
    if (!response.ok) {
      throw new Error(`Failed to load Matrix WASM core: ${response.status}`);
    }
    return WebAssembly.compile(await response.arrayBuffer());
  }
  throw new Error("Provide wasmModule, wasmBytes, or wasmUrl");
}

async function waitForCoreFactory(): Promise<void> {
  installCoreFactoryReadyHooks();
  if (isCoreFactoryReady()) {
    return;
  }
  coreFactoryReadyPromise ??= new Promise((resolve) => {
    resolveCoreFactoryReady = resolve;
  });
  await coreFactoryReadyPromise;
}

function isCoreFactoryReady(): boolean {
  return Boolean(globalThis.__matrixCoreCreate && globalThis.__matrixCoreCall);
}

function installCoreFactoryReadyHooks(): void {
  if (coreFactoryHooksInstalled || isCoreFactoryReady()) {
    return;
  }
  coreFactoryHooksInstalled = true;

  let create = globalThis.__matrixCoreCreate;
  let call = globalThis.__matrixCoreCall;

  Object.defineProperty(globalThis, "__matrixCoreCreate", {
    configurable: true,
    get: () => create,
    set(value) {
      create = value;
      notifyCoreFactoryReady();
    },
  });
  Object.defineProperty(globalThis, "__matrixCoreCall", {
    configurable: true,
    get: () => call,
    set(value) {
      call = value;
      notifyCoreFactoryReady();
    },
  });
}

function notifyCoreFactoryReady(): void {
  if (!isCoreFactoryReady()) {
    return;
  }
  resolveCoreFactoryReady?.();
  resolveCoreFactoryReady = null;
}

function installEmitDispatcher(): void {
  if (emitDispatcherInstalled) {
    return;
  }
  emitDispatcherInstalled = true;
  globalThis.__matrixCoreEmit = (coreId: string, payload: string) => {
    const listeners = listenersByCore.get(coreId);
    if (!listeners) {
      return;
    }
    const event = JSON.parse(payload) as MatrixCoreEvent;
    for (const listener of listeners) {
      listener(event);
    }
  };
}
