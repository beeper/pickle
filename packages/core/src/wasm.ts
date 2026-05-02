import type {
  MatrixCore,
  MatrixCoreEvent,
  MatrixCoreHost,
} from "./runtime-types";
import { MatrixCoreOperationCaller } from "./generated-runtime-operations";

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
  var __matrixCoreCallBytes:
    | ((
        coreId: string,
        operation: string,
        payload: string,
        bytes?: Uint8Array
      ) => Promise<string | Uint8Array>)
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

export class MatrixWasmCore extends MatrixCoreOperationCaller implements MatrixCore {
  readonly #listeners = new Set<(event: MatrixCoreEvent) => void>();
  readonly #coreId: string;
  readonly #host: MatrixCoreHost;

  constructor(coreId: string, host: MatrixCoreHost = {}) {
    super();
    this.#coreId = coreId;
    this.#host = host;
    listenersByCore.set(coreId, this.#listeners);
    installEmitDispatcher();
  }

  protected async call<T>(operation: string, payload: unknown = {}): Promise<T> {
    const call = globalThis.__matrixCoreCall;
    if (!call) {
      throw new Error("Matrix WASM core is not ready");
    }
    const response = await call(this.#coreId, operation, JSON.stringify(payload));
    return JSON.parse(response) as T;
  }

  async callBytesJson<T>(operation: string, payload: unknown, bytes: Uint8Array): Promise<T> {
    const call = globalThis.__matrixCoreCallBytes;
    if (!call) {
      throw new Error("Matrix WASM byte calls are not ready");
    }
    const response = await call(this.#coreId, operation, JSON.stringify(payload), bytes);
    if (typeof response !== "string") {
      throw new Error(`Matrix WASM byte operation ${operation} returned bytes`);
    }
    return JSON.parse(response) as T;
  }

  async callBytesResult(operation: string, payload: unknown = {}): Promise<Uint8Array> {
    const call = globalThis.__matrixCoreCallBytes;
    if (!call) {
      throw new Error("Matrix WASM byte calls are not ready");
    }
    const response = await call(this.#coreId, operation, JSON.stringify(payload));
    if (!(response instanceof Uint8Array)) {
      throw new Error(`Matrix WASM byte operation ${operation} returned JSON`);
    }
    return response;
  }

  supportsByteCalls(): boolean {
    return typeof globalThis.__matrixCoreCallBytes === "function";
  }

  async close(): Promise<void> {
    await super.close();
    this.#listeners.clear();
    listenersByCore.delete(this.#coreId);
  }

  onEvent(listener: (event: MatrixCoreEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
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
    if (typeof WebAssembly.compileStreaming === "function") {
      try {
        return await WebAssembly.compileStreaming(Promise.resolve(response.clone()));
      } catch {
        // Some static servers do not serve WASM with application/wasm.
      }
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
