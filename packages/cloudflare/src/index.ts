import type { MatrixStore } from "better-matrix-js";

export interface CloudflareKVNamespaceLike {
  delete(key: string): Promise<void>;
  get(key: string, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  list(options?: {
    cursor?: string;
    prefix?: string;
  }): Promise<{
    cursor?: string;
    keys: Array<{ name: string }>;
    list_complete: boolean;
  }>;
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<void>;
}

export interface DurableObjectStorageLike {
  delete(key: string): Promise<boolean>;
  get<T = unknown>(key: string): Promise<T | undefined>;
  getAlarm?(): Promise<number | null>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
  put(key: string, value: unknown): Promise<void>;
  setAlarm?(scheduledTime: number | Date): Promise<void>;
  deleteAlarm?(): Promise<void>;
}

export interface DurableObjectStateLike {
  blockConcurrencyWhile?(callback: () => Promise<void>): void;
  storage: DurableObjectStorageLike;
}

export interface CloudflareStoreOptions {
  prefix?: string;
}

export interface MatrixSyncDurableObjectEnv {
  MATRIX_ACCESS_TOKEN?: string;
  MATRIX_HOMESERVER_URL?: string;
  MATRIX_SYNC_ACCESS_TOKEN?: string;
  MATRIX_SYNC_HOMESERVER_URL?: string;
  MATRIX_SYNC_IDLE_REWAKE_MS?: string;
  MATRIX_SYNC_MAX_RETRY_MS?: string;
  MATRIX_SYNC_NEXT_ALARM_MS?: string;
  MATRIX_SYNC_RETRY_MS?: string;
  MATRIX_SYNC_TIMEOUT_MS?: string;
  MATRIX_SYNC_WEBHOOK_AUTHORIZATION?: string;
  MATRIX_SYNC_WEBHOOK_SECRET?: string;
  MATRIX_SYNC_WEBHOOK_URL?: string;
  [key: string]: unknown;
}

export interface MatrixSyncDurableObjectOptions {
  accessToken?: string;
  fetch?: typeof fetch;
  homeserverUrl?: string;
  idleRewakeMs?: number;
  maxRetryMs?: number;
  nextAlarmMs?: number;
  retryMs?: number;
  storagePrefix?: string;
  syncTimeoutMs?: number;
  webhookAuthorization?: string;
  webhookSecret?: string;
  webhookUrl?: string;
}

export interface MatrixSyncDurableObjectStatus {
  enabled: boolean;
  lastError?: string;
  retryMs: number;
  since?: string;
}

export interface MatrixSyncWebhookPayload {
  response: unknown;
  since?: string;
}

export interface MatrixEncryptedSyncWebhookEnvelope {
  alg: "AES-GCM-256";
  ciphertext: string;
  iv: string;
  v: 1;
}

export async function encryptMatrixSyncWebhookPayload(
  payload: MatrixSyncWebhookPayload,
  secret: string
): Promise<MatrixEncryptedSyncWebhookEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await webhookCryptoKey(secret);
  const plaintext = new TextEncoder().encode(JSON.stringify(stripUndefined({
    response: payload.response,
    since: payload.since,
  })));
  const ciphertext = await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, key, plaintext);
  return {
    alg: "AES-GCM-256",
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext)),
    iv: base64UrlEncode(iv),
    v: 1,
  };
}

export async function decryptMatrixSyncWebhookEnvelope(
  envelope: MatrixEncryptedSyncWebhookEnvelope,
  secret: string
): Promise<MatrixSyncWebhookPayload> {
  if (envelope.alg !== "AES-GCM-256" || envelope.v !== 1) {
    throw new Error("Unsupported Matrix sync webhook envelope");
  }
  const key = await webhookCryptoKey(secret);
  const plaintext = await crypto.subtle.decrypt(
    { iv: toArrayBuffer(base64UrlDecode(envelope.iv)), name: "AES-GCM" },
    key,
    toArrayBuffer(base64UrlDecode(envelope.ciphertext))
  );
  const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as MatrixSyncWebhookPayload;
  if (!decoded || typeof decoded !== "object" || !("response" in decoded)) {
    throw new Error("Invalid Matrix sync webhook payload");
  }
  return decoded;
}

export function createCloudflareKVMatrixStore(
  namespace: CloudflareKVNamespaceLike,
  options: CloudflareStoreOptions = {}
): MatrixStore {
  const prefix = options.prefix ?? "";
  return {
    async delete(key) {
      await namespace.delete(prefix + key);
    },
    async get(key) {
      const value = await namespace.get(prefix + key, "arrayBuffer");
      return value ? copyBytes(new Uint8Array(value)) : null;
    },
    async list(keyPrefix) {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const options: { cursor?: string; prefix?: string } = { prefix: prefix + keyPrefix };
        if (cursor !== undefined) {
          options.cursor = cursor;
        }
        const result = await namespace.list(options);
        for (const key of result.keys) {
          keys.push(key.name.slice(prefix.length));
        }
        cursor = result.list_complete ? undefined : result.cursor;
      } while (cursor);
      return keys;
    },
    async set(key, value) {
      await namespace.put(prefix + key, copyToArrayBuffer(value));
    },
  };
}

export function createDurableObjectMatrixStore(
  storage: DurableObjectStorageLike,
  options: CloudflareStoreOptions = {}
): MatrixStore {
  const prefix = options.prefix ?? "";
  return {
    async delete(key) {
      await storage.delete(prefix + key);
    },
    async get(key) {
      const value = await storage.get<ArrayBuffer | Uint8Array | number[]>(prefix + key);
      if (value instanceof Uint8Array) {
        return copyBytes(value);
      }
      if (value instanceof ArrayBuffer) {
        return copyBytes(new Uint8Array(value));
      }
      return Array.isArray(value) ? copyBytes(new Uint8Array(value)) : null;
    },
    async list(keyPrefix) {
      const values = await storage.list({ prefix: prefix + keyPrefix });
      return [...values.keys()].map((key) => key.slice(prefix.length));
    },
    async set(key, value) {
      await storage.put(prefix + key, copyToArrayBuffer(value));
    },
  };
}

export class MatrixSyncDurableObject {
  readonly #env: MatrixSyncDurableObjectEnv;
  readonly #options: MatrixSyncDurableObjectOptions;
  readonly #state: DurableObjectStateLike;
  #syncInFlight: Promise<MatrixSyncDurableObjectStatus> | null = null;

  constructor(
    state: DurableObjectStateLike,
    env: MatrixSyncDurableObjectEnv,
    options: MatrixSyncDurableObjectOptions = {}
  ) {
    this.#state = state;
    this.#env = env;
    this.#options = options;
    this.#state.blockConcurrencyWhile?.(async () => {
      if ((await this.#getEnabled()) && !(await this.#state.storage.getAlarm?.())) {
        await this.#setAlarm(this.#optionNumber("nextAlarmMs", "MATRIX_SYNC_NEXT_ALARM_MS", 0));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/status")) {
      return Response.json(await this.status());
    }

    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    if (
      url.pathname.endsWith("/start") ||
      url.pathname.endsWith("/sync") ||
      url.pathname.endsWith("/wake")
    ) {
      await this.#setEnabled(true);
      const status = await this.#sync();
      return Response.json({ ok: true, status });
    }

    if (url.pathname.endsWith("/stop")) {
      await this.#setEnabled(false);
      await this.#state.storage.deleteAlarm?.();
      return Response.json({ ok: true, status: await this.status() });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  }

  async alarm(): Promise<void> {
    await this.#sync();
  }

  async status(): Promise<MatrixSyncDurableObjectStatus> {
    const since = await this.#getString("since");
    const lastError = await this.#getString("last-error");
    const status: MatrixSyncDurableObjectStatus = {
      enabled: await this.#getEnabled(),
      retryMs: (await this.#state.storage.get<number>(this.#key("retry-ms"))) ?? 0,
    };
    if (lastError) {
      status.lastError = lastError;
    }
    if (since) {
      status.since = since;
    }
    return status;
  }

  async #sync(): Promise<MatrixSyncDurableObjectStatus> {
    this.#syncInFlight ??= this.#syncOnce().finally(() => {
      this.#syncInFlight = null;
    });
    return this.#syncInFlight;
  }

  async #syncOnce(): Promise<MatrixSyncDurableObjectStatus> {
    if (!(await this.#getEnabled())) {
      return this.status();
    }

    try {
      const previousSince = await this.#getString("since");
      const response = await this.#fetchSync(previousSince);
      await this.#postWebhook(response, previousSince);
      const nextBatch = syncNextBatch(response);
      await Promise.all([
        nextBatch ? this.#state.storage.put(this.#key("since"), nextBatch) : undefined,
        this.#state.storage.delete(this.#key("last-error")),
        this.#state.storage.put(this.#key("retry-ms"), 0),
      ]);
      await this.#scheduleNextSuccess();
    } catch (error) {
      await this.#state.storage.put(this.#key("last-error"), errorMessage(error));
      await this.#scheduleRetry();
    }

    return this.status();
  }

  async #fetchSync(since: string | undefined): Promise<unknown> {
    const homeserverUrl = this.#optionString("homeserverUrl", "MATRIX_SYNC_HOMESERVER_URL") ??
      this.#env.MATRIX_HOMESERVER_URL;
    const accessToken = this.#optionString("accessToken", "MATRIX_SYNC_ACCESS_TOKEN") ??
      this.#env.MATRIX_ACCESS_TOKEN;
    if (!homeserverUrl) {
      throw new Error("Matrix sync Durable Object requires MATRIX_SYNC_HOMESERVER_URL");
    }
    if (!accessToken) {
      throw new Error("Matrix sync Durable Object requires MATRIX_SYNC_ACCESS_TOKEN");
    }

    const url = new URL("/_matrix/client/v3/sync", homeserverUrl);
    url.searchParams.set(
      "timeout",
      String(this.#optionNumber("syncTimeoutMs", "MATRIX_SYNC_TIMEOUT_MS", 30_000))
    );
    if (since) {
      url.searchParams.set("since", since);
    }

    const response = await this.#fetch()(url, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) {
      throw new Error(`Matrix sync failed: HTTP ${response.status} ${text}`);
    }
    return body;
  }

  async #postWebhook(response: unknown, since: string | undefined): Promise<void> {
    const webhookUrl = this.#optionString("webhookUrl", "MATRIX_SYNC_WEBHOOK_URL");
    if (!webhookUrl) {
      throw new Error("Matrix sync Durable Object requires MATRIX_SYNC_WEBHOOK_URL");
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    const authorization = this.#optionString(
      "webhookAuthorization",
      "MATRIX_SYNC_WEBHOOK_AUTHORIZATION"
    );
    const secret = this.#optionString("webhookSecret", "MATRIX_SYNC_WEBHOOK_SECRET");
    if (authorization) {
      headers.authorization = authorization;
    } else if (secret) {
      headers.authorization = `Bearer ${secret}`;
    }

    const webhookResponse = await this.#fetch()(webhookUrl, {
      body: JSON.stringify(stripUndefined({ response, since })),
      headers,
      method: "POST",
    });
    if (!webhookResponse.ok) {
      throw new Error(`Matrix sync webhook failed: HTTP ${webhookResponse.status}`);
    }
  }

  async #scheduleNextSuccess(): Promise<void> {
    if (!(await this.#getEnabled())) {
      return;
    }
    const nextAlarmMs = this.#optionNumber("nextAlarmMs", "MATRIX_SYNC_NEXT_ALARM_MS", 0);
    const idleRewakeMs = this.#optionNumber(
      "idleRewakeMs",
      "MATRIX_SYNC_IDLE_REWAKE_MS",
      nextAlarmMs
    );
    await this.#setAlarm(idleRewakeMs);
  }

  async #scheduleRetry(): Promise<void> {
    if (!(await this.#getEnabled())) {
      return;
    }
    const retryMs = (await this.#state.storage.get<number>(this.#key("retry-ms"))) ??
      this.#optionNumber("retryMs", "MATRIX_SYNC_RETRY_MS", 1_000);
    const maxRetryMs = this.#optionNumber("maxRetryMs", "MATRIX_SYNC_MAX_RETRY_MS", 60_000);
    const nextRetryMs = Math.min(Math.max(retryMs * 2, 1_000), maxRetryMs);
    await this.#state.storage.put(this.#key("retry-ms"), nextRetryMs);
    await this.#setAlarm(retryMs);
  }

  async #setAlarm(delayMs: number): Promise<void> {
    if (!this.#state.storage.setAlarm) {
      throw new Error("Durable Object storage alarms are required for Matrix sync");
    }
    await this.#state.storage.setAlarm(Date.now() + Math.max(0, delayMs));
  }

  #fetch(): typeof fetch {
    return this.#options.fetch ?? fetch;
  }

  async #getEnabled(): Promise<boolean> {
    return (await this.#state.storage.get<boolean>(this.#key("enabled"))) ?? false;
  }

  async #getString(key: string): Promise<string | undefined> {
    const value = await this.#state.storage.get<unknown>(this.#key(key));
    return typeof value === "string" ? value : undefined;
  }

  #key(key: string): string {
    return `${this.#options.storagePrefix ?? "matrix-sync:"}${key}`;
  }

  async #setEnabled(enabled: boolean): Promise<void> {
    await this.#state.storage.put(this.#key("enabled"), enabled);
  }

  #optionNumber(
    optionKey: keyof MatrixSyncDurableObjectOptions,
    envKey: keyof MatrixSyncDurableObjectEnv,
    fallback: number
  ): number {
    const optionValue = this.#options[optionKey];
    if (typeof optionValue === "number" && Number.isFinite(optionValue)) {
      return optionValue;
    }
    const envValue = this.#env[envKey];
    if (typeof envValue === "string" && envValue.length > 0) {
      const number = Number(envValue);
      if (Number.isFinite(number)) {
        return number;
      }
    }
    return fallback;
  }

  #optionString(
    optionKey: keyof MatrixSyncDurableObjectOptions,
    envKey: keyof MatrixSyncDurableObjectEnv
  ): string | undefined {
    const optionValue = this.#options[optionKey];
    if (typeof optionValue === "string" && optionValue.length > 0) {
      return optionValue;
    }
    const envValue = this.#env[envKey];
    return typeof envValue === "string" && envValue.length > 0 ? envValue : undefined;
  }
}

function copyToArrayBuffer(value: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  return buffer;
}

function copyBytes(value: Uint8Array): Uint8Array {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  ) as T;
}

function syncNextBatch(response: unknown): string | undefined {
  if (!response || typeof response !== "object") {
    return undefined;
  }
  const nextBatch = (response as { next_batch?: unknown }).next_batch;
  return typeof nextBatch === "string" && nextBatch.length > 0 ? nextBatch : undefined;
}

async function webhookCryptoKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error("Matrix sync webhook encryption secret is required");
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt", "encrypt"]);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "="
  );
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
