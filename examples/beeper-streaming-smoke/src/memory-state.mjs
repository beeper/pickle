import { randomUUID } from "node:crypto";

export class MemoryState {
  #locks = new Map();
  #queues = new Map();
  #store = new Map();
  #subscriptions = new Set();

  async acquireLock(threadId, ttlMs) {
    const existing = this.#locks.get(threadId);
    if (existing && existing.expiresAt > Date.now()) return null;
    const lock = { expiresAt: Date.now() + ttlMs, threadId, token: randomUUID() };
    this.#locks.set(threadId, lock);
    return lock;
  }

  async appendToList(key, value, options = {}) {
    const list = this.#queues.get(key) ?? [];
    list.push(value);
    if (options.maxLength && list.length > options.maxLength) {
      list.splice(0, list.length - options.maxLength);
    }
    this.#queues.set(key, list);
  }

  async connect() {}

  async delete(key) {
    this.#store.delete(key);
    this.#queues.delete(key);
  }

  async dequeue(threadId) {
    return this.#queue(threadId).shift() ?? null;
  }

  async disconnect() {}

  async enqueue(threadId, entry, maxSize) {
    const queue = this.#queue(threadId);
    queue.push(entry);
    if (queue.length > maxSize) queue.splice(0, queue.length - maxSize);
    return queue.length;
  }

  async extendLock(lock, ttlMs) {
    const current = this.#locks.get(lock.threadId);
    if (!current || current.token !== lock.token) return false;
    current.expiresAt = Date.now() + ttlMs;
    return true;
  }

  async forceReleaseLock(threadId) {
    this.#locks.delete(threadId);
  }

  async get(key) {
    return this.#store.get(key) ?? null;
  }

  async getList(key) {
    return [...(this.#queues.get(key) ?? [])];
  }

  async isSubscribed(threadId) {
    return this.#subscriptions.has(threadId);
  }

  async queueDepth(threadId) {
    return this.#queue(threadId).length;
  }

  async releaseLock(lock) {
    const current = this.#locks.get(lock.threadId);
    if (current?.token === lock.token) this.#locks.delete(lock.threadId);
  }

  async set(key, value) {
    this.#store.set(key, value);
  }

  async setIfNotExists(key, value) {
    if (this.#store.has(key)) return false;
    this.#store.set(key, value);
    return true;
  }

  async subscribe(threadId) {
    this.#subscriptions.add(threadId);
  }

  async unsubscribe(threadId) {
    this.#subscriptions.delete(threadId);
  }

  #queue(threadId) {
    const key = `queue:${threadId}`;
    let queue = this.#queues.get(key);
    if (!queue) {
      queue = [];
      this.#queues.set(key, queue);
    }
    return queue;
  }
}
