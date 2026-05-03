import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class FileState {
  #connected = false;
  #path;
  #data = {
    lists: {},
    locks: {},
    queues: {},
    state: {},
    subscriptions: [],
  };

  constructor(path) {
    this.#path = path;
  }

  async acquireLock(threadId, ttlMs) {
    this.#ensureConnected();
    this.#cleanExpiredLocks();
    const existing = this.#data.locks[threadId];
    if (existing && existing.expiresAt > Date.now()) return null;
    const lock = { expiresAt: Date.now() + ttlMs, threadId, token: randomUUID() };
    this.#data.locks[threadId] = lock;
    await this.#save();
    return lock;
  }

  async appendToList(key, value, options = {}) {
    this.#ensureConnected();
    const list = this.#data.lists[key] ?? [];
    list.push(value);
    if (options.maxLength && list.length > options.maxLength) {
      list.splice(0, list.length - options.maxLength);
    }
    this.#data.lists[key] = list;
    await this.#save();
  }

  async connect() {
    if (this.#connected) return;
    try {
      this.#data = JSON.parse(await readFile(this.#path, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    this.#data.lists ??= {};
    this.#data.locks ??= {};
    this.#data.queues ??= {};
    this.#data.state ??= {};
    this.#data.subscriptions ??= [];
    this.#connected = true;
    this.#cleanExpiredLocks();
    await this.#save();
  }

  async delete(key) {
    this.#ensureConnected();
    delete this.#data.state[key];
    delete this.#data.lists[key];
    await this.#save();
  }

  async dequeue(threadId) {
    this.#ensureConnected();
    const queue = this.#queue(threadId);
    const entry = queue.shift() ?? null;
    if (queue.length === 0) delete this.#data.queues[threadId];
    await this.#save();
    return entry;
  }

  async disconnect() {
    if (!this.#connected) return;
    await this.#save();
    this.#connected = false;
  }

  async enqueue(threadId, entry, maxSize) {
    this.#ensureConnected();
    const queue = this.#queue(threadId);
    queue.push(entry);
    if (queue.length > maxSize) queue.splice(0, queue.length - maxSize);
    await this.#save();
    return queue.length;
  }

  async extendLock(lock, ttlMs) {
    this.#ensureConnected();
    const current = this.#data.locks[lock.threadId];
    if (!current || current.token !== lock.token || current.expiresAt < Date.now()) return false;
    current.expiresAt = Date.now() + ttlMs;
    await this.#save();
    return true;
  }

  async forceReleaseLock(threadId) {
    this.#ensureConnected();
    delete this.#data.locks[threadId];
    await this.#save();
  }

  async get(key) {
    this.#ensureConnected();
    const cached = this.#data.state[key];
    if (!cached) return null;
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      delete this.#data.state[key];
      await this.#save();
      return null;
    }
    return cached.value ?? null;
  }

  async getList(key) {
    this.#ensureConnected();
    return [...(this.#data.lists[key] ?? [])];
  }

  async isSubscribed(threadId) {
    this.#ensureConnected();
    return this.#data.subscriptions.includes(threadId);
  }

  async queueDepth(threadId) {
    this.#ensureConnected();
    return this.#queue(threadId).length;
  }

  async releaseLock(lock) {
    this.#ensureConnected();
    const current = this.#data.locks[lock.threadId];
    if (current?.token === lock.token) {
      delete this.#data.locks[lock.threadId];
      await this.#save();
    }
  }

  async set(key, value, ttlMs) {
    this.#ensureConnected();
    this.#data.state[key] = {
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
      value,
    };
    await this.#save();
  }

  async setIfNotExists(key, value, ttlMs) {
    this.#ensureConnected();
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async subscribe(threadId) {
    this.#ensureConnected();
    if (!this.#data.subscriptions.includes(threadId)) {
      this.#data.subscriptions.push(threadId);
      await this.#save();
    }
  }

  async unsubscribe(threadId) {
    this.#ensureConnected();
    this.#data.subscriptions = this.#data.subscriptions.filter((id) => id !== threadId);
    await this.#save();
  }

  #cleanExpiredLocks() {
    const now = Date.now();
    for (const [threadId, lock] of Object.entries(this.#data.locks)) {
      if (lock.expiresAt <= now) delete this.#data.locks[threadId];
    }
  }

  #ensureConnected() {
    if (!this.#connected) throw new Error("FileState is not connected");
  }

  #queue(threadId) {
    this.#data.queues[threadId] ??= [];
    return this.#data.queues[threadId];
  }

  async #save() {
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(this.#path, `${JSON.stringify(this.#data, null, 2)}\n`);
  }
}

export class MatrixState {
  #indexKey;
  #state;
  #valuePrefix;

  constructor(state, namespace = "matrix") {
    this.#state = state;
    this.#indexKey = `${namespace}:index`;
    this.#valuePrefix = `${namespace}:value:`;
  }

  async delete(key) {
    await this.#state.delete(this.#key(key));
    const keys = new Set(await this.#index());
    if (keys.delete(key)) await this.#writeIndex(keys);
  }

  async get(key) {
    const value = await this.#state.get(this.#key(key));
    return value ? Uint8Array.from(Buffer.from(value, "base64")) : null;
  }

  async list(prefix) {
    return (await this.#index()).filter((key) => key.startsWith(prefix)).sort();
  }

  async set(key, value) {
    await this.#state.set(this.#key(key), Buffer.from(value).toString("base64"));
    const keys = new Set(await this.#index());
    if (!keys.has(key)) {
      keys.add(key);
      await this.#writeIndex(keys);
    }
  }

  async #index() {
    return (await this.#state.get(this.#indexKey)) ?? [];
  }

  #key(key) {
    return `${this.#valuePrefix}${key}`;
  }

  async #writeIndex(keys) {
    await this.#state.set(this.#indexKey, [...keys].sort());
  }
}
