import { copyBytes, type MatrixStore } from "@beeper/pickle";

export type MaybePromise<T> = T | Promise<T>;

export interface SimpleMatrixStoreAdapter {
  delete(key: string): MaybePromise<void>;
  get(key: string): MaybePromise<ArrayBuffer | Uint8Array | number[] | null | undefined>;
  keys?(): MaybePromise<Iterable<string> | ArrayLike<string>>;
  list?(prefix: string): MaybePromise<Iterable<string> | ArrayLike<string>>;
  set(key: string, value: Uint8Array): MaybePromise<void>;
}

export interface SimpleMatrixStoreOptions {
  indexKey?: string;
}

export class SimpleMatrixStore implements MatrixStore {
  readonly #adapter: SimpleMatrixStoreAdapter;
  readonly #indexKey: string;

  constructor(adapter: SimpleMatrixStoreAdapter, options: SimpleMatrixStoreOptions = {}) {
    this.#adapter = adapter;
    this.#indexKey = options.indexKey ?? "__better_matrix_js_keys__";
  }

  async delete(key: string): Promise<void> {
    await this.#adapter.delete(key);
    if (!this.#adapter.list && !this.#adapter.keys) {
      await this.#writeIndex((await this.#readIndex()).filter((item) => item !== key));
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    const value = await this.#adapter.get(key);
    return value ? copyBytes(value) : null;
  }

  async list(prefix: string): Promise<string[]> {
    if (this.#adapter.list) {
      return toArray(await this.#adapter.list(prefix)).filter((key) => key.startsWith(prefix));
    }
    if (this.#adapter.keys) {
      return toArray(await this.#adapter.keys()).filter((key) => key.startsWith(prefix));
    }
    return (await this.#readIndex()).filter((key) => key.startsWith(prefix));
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.#adapter.set(key, copyBytes(value));
    if (!this.#adapter.list && !this.#adapter.keys) {
      const index = await this.#readIndex();
      if (!index.includes(key)) {
        index.push(key);
        await this.#writeIndex(index);
      }
    }
  }

  async #readIndex(): Promise<string[]> {
    const value = await this.#adapter.get(this.#indexKey);
    if (!value) {
      return [];
    }
    return JSON.parse(new TextDecoder().decode(copyBytes(value))) as string[];
  }

  async #writeIndex(keys: string[]): Promise<void> {
    await this.#adapter.set(this.#indexKey, new TextEncoder().encode(JSON.stringify(keys)));
  }
}

export function createMatrixStore(
  adapter: SimpleMatrixStoreAdapter,
  options: SimpleMatrixStoreOptions = {}
): MatrixStore {
  return new SimpleMatrixStore(adapter, options);
}

function toArray(value: Iterable<string> | ArrayLike<string>): string[] {
  return Array.from(value as Iterable<string> | ArrayLike<string>);
}
