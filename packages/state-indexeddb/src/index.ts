import { copyBytes, type MatrixStore } from "pickle";

export interface IndexedDBMatrixStoreOptions {
  databaseName?: string;
  indexedDB?: IDBFactory;
  objectStoreName?: string;
}

export class IndexedDBMatrixStore implements MatrixStore {
  readonly #databaseName: string;
  readonly #factory: IDBFactory;
  readonly #objectStoreName: string;
  #database: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDBMatrixStoreOptions = {}) {
    const factory = options.indexedDB ?? globalThis.indexedDB;
    if (!factory) {
      throw new Error("IndexedDB is not available. Pass options.indexedDB or use another store.");
    }
    this.#databaseName = options.databaseName ?? "pickle";
    this.#factory = factory;
    this.#objectStoreName = options.objectStoreName ?? "matrix-store";
  }

  async delete(key: string): Promise<void> {
    await this.#request("readwrite", (store) => store.delete(key));
  }

  async get(key: string): Promise<Uint8Array | null> {
    const value = await this.#request<ArrayBuffer | Uint8Array | number[] | undefined>(
      "readonly",
      (store) => store.get(key)
    );
    return value ? copyBytes(value) : null;
  }

  async list(prefix: string): Promise<string[]> {
    const db = await this.#open();
    const tx = db.transaction(this.#objectStoreName, "readonly");
    const store = tx.objectStore(this.#objectStoreName);
    return new Promise((resolve, reject) => {
      const keys: string[] = [];
      const request = store.openKeyCursor();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB key cursor failed"));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(keys.filter((key) => key.startsWith(prefix)));
          return;
        }
        if (typeof cursor.key === "string") {
          keys.push(cursor.key);
        }
        cursor.continue();
      };
    });
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.#request("readwrite", (store) => store.put(copyBytes(value), key));
  }

  async #open(): Promise<IDBDatabase> {
    this.#database ??= new Promise((resolve, reject) => {
      const request = this.#factory.open(this.#databaseName, 1);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onupgradeneeded = () => {
        request.result.createObjectStore(this.#objectStoreName);
      };
      request.onsuccess = () => resolve(request.result);
    });
    return this.#database;
  }

  async #request<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.#open();
    const tx = db.transaction(this.#objectStoreName, mode);
    const store = tx.objectStore(this.#objectStoreName);
    return new Promise((resolve, reject) => {
      const request = run(store);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
      request.onsuccess = () => resolve(request.result);
    });
  }
}

export function createIndexedDBMatrixStore(
  options: IndexedDBMatrixStoreOptions = {}
): IndexedDBMatrixStore {
  return new IndexedDBMatrixStore(options);
}
