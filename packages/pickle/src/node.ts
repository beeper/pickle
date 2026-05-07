import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { createMatrixClient as createRuntimeMatrixClient } from "./client";
export { onInvite, onMessage, onRawEvent, onReaction } from "./helpers";
import type { MatrixClient } from "./client-types";
import type { MatrixClientEvent, MatrixClientOptions, MatrixSubscribeFilter } from "./types";
import { loadMatrixCore, type LoadMatrixCoreOptions, type MatrixWasmCore } from "./wasm";

interface LoadMatrixCoreFromNodeOptions extends Omit<LoadMatrixCoreOptions, "wasmUrl"> {
  wasmExecPath?: string;
  wasmPath?: string;
}

export interface NodeMatrixClientOptions extends Omit<MatrixClientOptions, "wasmUrl"> {
  wasmExecPath?: string;
  wasmPath?: string;
}

export function createMatrixClient(options: NodeMatrixClientOptions): MatrixClient {
  return new NodeMatrixClient(options);
}

class NodeMatrixClient implements MatrixClient {
  readonly #options: NodeMatrixClientOptions;
  #client: MatrixClient | null = null;
  #clientPromise: Promise<MatrixClient> | null = null;

  constructor(options: NodeMatrixClientOptions) {
    this.#options = options;
  }

  get accountData() {
    return this.#namespace("accountData");
  }

  get appservice() {
    return this.#namespace("appservice");
  }

  get beeper() {
    return this.#namespace("beeper");
  }

  get crypto() {
    return this.#namespace("crypto");
  }

  get media() {
    return this.#namespace("media");
  }

  get messages() {
    return this.#namespace("messages");
  }

  get reactions() {
    return this.#namespace("reactions");
  }

  get raw() {
    return this.#namespace("raw");
  }

  get receipts() {
    return this.#namespace("receipts");
  }

  get rooms() {
    return this.#namespace("rooms");
  }

  get streams() {
    return this.#namespace("streams");
  }

  get sync() {
    return this.#namespace("sync");
  }

  get typing() {
    return this.#namespace("typing");
  }

  get toDevice() {
    return this.#namespace("toDevice");
  }

  get users() {
    return this.#namespace("users");
  }

  async close(): Promise<void> {
    await this.#client?.close();
    this.#client = null;
    this.#clientPromise = null;
  }

  async boot() {
    return (await this.#runtime()).boot();
  }

  async subscribe(
    filter: MatrixSubscribeFilter,
    handler: (event: MatrixClientEvent) => void | Promise<void>,
    options?: import("./types").MatrixSubscribeOptions
  ) {
    return (await this.#runtime()).subscribe(filter, handler, options);
  }

  async whoami() {
    return (await this.#runtime()).whoami();
  }

  async logout() {
    return (await this.#runtime()).logout();
  }

  async #runtime(): Promise<MatrixClient> {
    if (!this.#client) {
      this.#clientPromise ??= this.#createRuntime();
      this.#client = await this.#clientPromise;
    }
    return this.#client;
  }

  async #createRuntime(): Promise<MatrixClient> {
    const { wasmExecPath, wasmPath, ...clientOptions } = this.#options;
    const distDir = dirname(fileURLToPath(import.meta.url));
    if (!clientOptions.wasmBytes && !clientOptions.wasmModule) {
      clientOptions.wasmBytes = await readFile(wasmPath ?? join(distDir, "pickle.wasm"));
    }
    if (!clientOptions.wasmBytes && !clientOptions.wasmModule) {
      throw new Error("Matrix WASM bytes are missing");
    }
    if (!globalThis.Go) {
      const runtimePath = wasmExecPath ?? join(distDir, "wasm_exec.js");
      runInThisContext(await readFile(runtimePath, "utf8"), { filename: runtimePath });
    }
    return createRuntimeMatrixClient(clientOptions);
  }

  #namespace<K extends keyof MatrixClient>(name: K): MatrixClient[K] {
    return createAsyncNamespace(async () => (await this.#runtime())[name]) as MatrixClient[K];
  }
}

function createAsyncNamespace<T>(load: () => Promise<T>): T {
  const build = (path: string[]): unknown =>
    new Proxy(async () => undefined, {
      apply: async (_target, _thisArg, args) => {
        let parent: unknown = await load();
        for (const key of path.slice(0, -1)) {
          parent = (parent as Record<string, unknown>)[key];
        }
        const value = (parent as Record<string, unknown>)[path[path.length - 1] ?? ""];
        if (typeof value !== "function") return value;
        return value.apply(parent, args);
      },
      get: (_target, prop) => {
        if (typeof prop !== "string") return undefined;
        return build([...path, prop]);
      },
    });
  return build([]) as T;
}

async function loadMatrixCoreFromNodePackage(
  options: LoadMatrixCoreFromNodeOptions = {}
): Promise<MatrixWasmCore> {
  const { wasmExecPath, wasmPath, ...coreOptions } = options;
  const distDir = dirname(fileURLToPath(import.meta.url));

  if (!coreOptions.go && !globalThis.Go) {
    const runtimePath = wasmExecPath ?? join(distDir, "wasm_exec.js");
    runInThisContext(await readFile(runtimePath, "utf8"), { filename: runtimePath });
  }

  if (!coreOptions.wasmBytes && !coreOptions.wasmModule) {
    coreOptions.wasmBytes = await readFile(wasmPath ?? join(distDir, "pickle.wasm"));
  }

  return loadMatrixCore(coreOptions);
}
