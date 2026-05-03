import { copyBytes, type MatrixStore } from "easymatrix";

export class MemoryMatrixStore implements MatrixStore {
  readonly #values = new Map<string, Uint8Array>();

  async delete(key: string): Promise<void> {
    this.#values.delete(key);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const value = this.#values.get(key);
    return value ? copyBytes(value) : null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.#values.keys()].filter((key) => key.startsWith(prefix));
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    this.#values.set(key, copyBytes(value));
  }
}

export function createMemoryMatrixStore(): MemoryMatrixStore {
  return new MemoryMatrixStore();
}
