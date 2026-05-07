import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { MatrixStore } from "@beeper/pickle";

interface StateData {
  locks: Record<string, { expiresAt: number; threadId: string; token: string }>;
  state: Record<string, unknown>;
}

export class FileState {
  #connected = false;
  #path: string;
  #data: StateData = {
    locks: {},
    state: {},
  };

  constructor(path: string) {
    this.#path = path;
  }

  async acquireLock(threadId: string, ttlMs: number): Promise<{ expiresAt: number; threadId: string; token: string } | null> {
    this.#ensureConnected();
    this.#cleanExpiredLocks();
    const existing = this.#data.locks[threadId];
    if (existing && existing.expiresAt > Date.now()) return null;
    const lock = { expiresAt: Date.now() + ttlMs, threadId, token: randomUUID() };
    this.#data.locks[threadId] = lock;
    await this.#save();
    return lock;
  }

  async connect(): Promise<void> {
    if (this.#connected) return;
    try {
      this.#data = JSON.parse(await readFile(this.#path, "utf8")) as StateData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
    this.#data.locks ??= {};
    this.#data.state ??= {};
    this.#connected = true;
    this.#cleanExpiredLocks();
    await this.#save();
  }

  async delete(key: string): Promise<void> {
    this.#ensureConnected();
    delete this.#data.state[key];
    await this.#save();
  }

  async disconnect(): Promise<void> {
    if (!this.#connected) return;
    await this.#save();
    this.#connected = false;
  }

  async get<T>(key: string): Promise<T | null> {
    this.#ensureConnected();
    return (this.#data.state[key] as T | undefined) ?? null;
  }

  async releaseLock(lock: { threadId: string; token: string }): Promise<void> {
    this.#ensureConnected();
    const current = this.#data.locks[lock.threadId];
    if (current?.token === lock.token) {
      delete this.#data.locks[lock.threadId];
      await this.#save();
    }
  }

  async set(key: string, value: unknown): Promise<void> {
    this.#ensureConnected();
    this.#data.state[key] = value;
    await this.#save();
  }

  #cleanExpiredLocks(): void {
    const now = Date.now();
    for (const [threadId, lock] of Object.entries(this.#data.locks)) {
      if (lock.expiresAt <= now) delete this.#data.locks[threadId];
    }
  }

  #ensureConnected(): void {
    if (!this.#connected) throw new Error("FileState is not connected");
  }

  async #save(): Promise<void> {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(this.#data, null, 2)}\n`);
  }
}

export class MatrixState implements MatrixStore {
  #indexKey: string;
  #state: FileState;
  #valuePrefix: string;

  constructor(state: FileState, namespace = "matrix") {
    this.#state = state;
    this.#indexKey = `${namespace}:index`;
    this.#valuePrefix = `${namespace}:value:`;
  }

  async delete(key: string): Promise<void> {
    await this.#state.delete(this.#key(key));
    const keys = new Set(await this.#index());
    if (keys.delete(key)) await this.#writeIndex(keys);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const value = await this.#state.get<string>(this.#key(key));
    return value ? Uint8Array.from(Buffer.from(value, "base64")) : null;
  }

  async list(prefix: string): Promise<string[]> {
    return (await this.#index()).filter((key) => key.startsWith(prefix)).sort();
  }

  async set(key: string, value: Uint8Array): Promise<void> {
    await this.#state.set(this.#key(key), Buffer.from(value).toString("base64"));
    const keys = new Set(await this.#index());
    if (!keys.has(key)) {
      keys.add(key);
      await this.#writeIndex(keys);
    }
  }

  async #index(): Promise<string[]> {
    return (await this.#state.get<string[]>(this.#indexKey)) ?? [];
  }

  #key(key: string): string {
    return `${this.#valuePrefix}${key}`;
  }

  async #writeIndex(keys: Set<string>): Promise<void> {
    await this.#state.set(this.#indexKey, [...keys].sort());
  }
}
