import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import { createMatrixClient as createRuntimeMatrixClient } from "./client";
import type { MatrixClient } from "./client-types";
import type { MatrixClientOptions } from "./types";
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
  #eventListeners = new Set<Parameters<MatrixClient["events"]["on"]>[0]>();

  constructor(options: NodeMatrixClientOptions) {
    this.#options = options;
  }

  get events() {
    return {
      on: (listener: Parameters<MatrixClient["events"]["on"]>[0]) => {
        this.#eventListeners.add(listener);
        const unsubscribe = this.#client?.events.on(listener);
        return () => {
          this.#eventListeners.delete(listener);
          unsubscribe?.();
        };
      },
      onMessage: (listener: Parameters<MatrixClient["events"]["onMessage"]>[0]) =>
        this.events.on((event) => {
          if (event.kind === "message") listener(event);
        }),
      onReaction: (listener: Parameters<MatrixClient["events"]["onReaction"]>[0]) =>
        this.events.on((event) => {
          if (event.kind === "reaction") listener(event);
        }),
    };
  }

  get beeper() {
    return this.#clientRequired().beeper;
  }

  get crypto() {
    return this.#clientRequired().crypto;
  }

  get media() {
    return this.#clientRequired().media;
  }

  get messages() {
    return this.#clientRequired().messages;
  }

  get reactions() {
    return this.#clientRequired().reactions;
  }

  get rooms() {
    return this.#clientRequired().rooms;
  }

  get streams() {
    return this.#clientRequired().streams;
  }

  get sync() {
    return this.#clientRequired().sync;
  }

  get typing() {
    return this.#clientRequired().typing;
  }

  get users() {
    return this.#clientRequired().users;
  }

  async close(): Promise<void> {
    await this.#client?.close();
    this.#client = null;
  }

  async connect(options?: { signal?: AbortSignal }) {
    if (!this.#client) {
      const { wasmExecPath, wasmPath, ...clientOptions } = this.#options;
      const distDir = dirname(fileURLToPath(import.meta.url));
      if (!clientOptions.wasmBytes && !clientOptions.wasmModule) {
        clientOptions.wasmBytes = await readFile(wasmPath ?? join(distDir, "matrix-core.wasm"));
      }
      if (!clientOptions.wasmBytes && !clientOptions.wasmModule) {
        throw new Error("Matrix WASM bytes are missing");
      }
      if (!globalThis.Go) {
        const runtimePath = wasmExecPath ?? join(distDir, "wasm_exec.js");
        runInThisContext(await readFile(runtimePath, "utf8"), { filename: runtimePath });
      }
      this.#client = createRuntimeMatrixClient(clientOptions);
      for (const listener of this.#eventListeners) {
        this.#client.events.on(listener);
      }
    }
    return this.#client.connect(options);
  }

  whoami() {
    return this.#clientRequired().whoami();
  }

  #clientRequired(): MatrixClient {
    if (!this.#client) {
      throw new Error("Matrix client is not connected. Call connect() first.");
    }
    return this.#client;
  }
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
    coreOptions.wasmBytes = await readFile(wasmPath ?? join(distDir, "matrix-core.wasm"));
  }

  return loadMatrixCore(coreOptions);
}
