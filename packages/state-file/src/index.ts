import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { copyBytes, type MatrixStore } from "@beeper/pickle";

export class FileMatrixStore implements MatrixStore {
  readonly #dir: string;
  #index: Map<string, string> | null = null;

  constructor(dir: string) {
    this.#dir = dir;
  }

  async delete(key: string): Promise<void> {
    const index = await this.#loadIndex();
    const filename = index.get(key);
    if (!filename) {
      return;
    }
    index.delete(key);
    await rm(join(this.#dir, filename), { force: true });
    await this.#saveIndex(index);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const index = await this.#loadIndex();
    const filename = index.get(key);
    if (!filename) {
      return null;
    }
    try {
      return copyBytes(await readFile(join(this.#dir, filename)));
    } catch (error) {
      if (isNodeENOENT(error)) {
        return null;
      }
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const index = await this.#loadIndex();
    return [...index.keys()].filter((key) => key.startsWith(prefix)).sort();
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    const index = await this.#loadIndex();
    const filename = index.get(key) ?? keyToFilename(key);
    index.set(key, filename);
    await mkdir(this.#dir, { recursive: true });
    await writeFile(join(this.#dir, filename), copyBytes(value));
    await this.#saveIndex(index);
  }

  async #loadIndex(): Promise<Map<string, string>> {
    if (this.#index) {
      return this.#index;
    }
    try {
      const raw = await readFile(join(this.#dir, "index.json"), "utf8");
      this.#index = new Map(Object.entries(JSON.parse(raw) as Record<string, string>));
    } catch (error) {
      if (!isNodeENOENT(error)) {
        throw error;
      }
      this.#index = new Map();
    }
    return this.#index;
  }

  async #saveIndex(index: Map<string, string>): Promise<void> {
    await mkdir(this.#dir, { recursive: true });
    await writeFile(
      join(this.#dir, "index.json"),
      JSON.stringify(Object.fromEntries(index), null, 2)
    );
  }
}

export function createFileMatrixStore(dir: string): FileMatrixStore {
  return new FileMatrixStore(dir);
}

function keyToFilename(key: string): string {
  return `${createHash("sha256").update(key).digest("base64url")}.bin`;
}

function isNodeENOENT(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
