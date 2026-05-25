import { generateKeyPairSync, createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { OpenClawAgentContact, OpenClawBridgeConfig } from "./types";
import { agentContactFromOpenClawAgent } from "./rooms";
import type { OpenClawApprovalResolvePayload } from "./approval";

export type GatewayRequestOptions = {
  expectFinal?: boolean;
  timeoutMs?: number | null;
};

export type OpenClawGatewayEvent = {
  event?: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: unknown;
};

export interface OpenClawTransport {
  close?(): Promise<void> | void;
  events(filter?: (event: OpenClawGatewayEvent) => boolean): AsyncIterable<OpenClawGatewayEvent>;
  request<T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions): Promise<T>;
}

export interface OpenClawHttpTransportOptions {
  eventsPath?: string;
  fetch?: typeof fetch;
  requestPath?: string;
  url: string;
}

export interface OpenClawWebSocketTransportOptions {
  clientId?: string;
  deviceIdentityPath?: string;
  deviceToken?: string;
  clientVersion?: string;
  replayLimit?: number;
  requestTimeoutMs?: number;
  url: string;
  WebSocket?: typeof WebSocket;
}

const DEFAULT_GATEWAY_CLIENT_ID = "gateway-client";
const DEFAULT_GATEWAY_CLIENT_MODE = "backend";
const DEFAULT_GATEWAY_ROLE = "operator";
const DEFAULT_GATEWAY_SCOPES = ["operator.read", "operator.write", "operator.approvals"];
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

type GatewayDeviceIdentity = {
  deviceId: string;
  privateKeyPem: string;
  publicKeyPem: string;
};

type StoredGatewayDeviceIdentity = GatewayDeviceIdentity & {
  createdAtMs: number;
  deviceToken?: string;
  tokenScopes?: string[];
  version: 1;
};

export interface OpenClawSessionCreateOptions {
  agentId: string;
  key?: string;
  label?: string;
  message?: string;
  model?: string;
  parentSessionKey?: string;
  task?: string;
}

export interface OpenClawSessionSendOptions {
  attachments?: unknown[];
  idempotencyKey?: string;
  matrix?: OpenClawMatrixMessageMetadata;
  message: string;
  replyTo?: OpenClawReplyReference;
  sessionKey: string;
  thinking?: string;
  timeoutMs?: number;
}

export interface OpenClawMatrixAttachmentMetadata {
  contentType?: unknown;
  contentUri?: unknown;
  duration?: unknown;
  encryptedFile?: unknown;
  filename?: unknown;
  height?: unknown;
  kind?: unknown;
  size?: unknown;
  width?: unknown;
}

export interface OpenClawMatrixMessageMetadata {
  attachments?: OpenClawMatrixAttachmentMetadata[];
  formattedBody?: string;
  mentions?: {
    room?: boolean;
    userIds?: string[];
  };
  relation?: {
    key?: string;
    kind?: "reply" | "thread" | "edit" | "reaction" | "reaction_remove" | "redaction";
    quote?: {
      body?: string;
      sender?: string;
    };
    replyToEventId?: string;
    targetEventId?: string;
    targetReactionId?: string;
    targetRunId?: string;
    targetSessionKey?: string;
    threadRootEventId?: string;
  };
  sender?: string;
  threadRootEventId?: string;
}

export interface OpenClawReplyReference {
  eventId: string;
  roomId?: string;
}

export interface OpenClawGatewayFeatureSnapshot {
  agents?: unknown;
  artifacts?: unknown;
  channels?: unknown;
  commands?: unknown;
  config?: unknown;
  cron?: unknown;
  health?: unknown;
  models?: unknown;
  sessions?: unknown;
  skills?: unknown;
  status?: unknown;
  tasks?: unknown;
  tools?: unknown;
  usage?: unknown;
}

export interface OpenClawSessionRef {
  agentId?: string;
  key: string;
  label?: string;
  raw?: unknown;
  sessionId?: string;
}

export interface OpenClawRunRef {
  raw?: unknown;
  runId: string;
  sessionKey: string;
}

export interface OpenClawListedSession {
  agentId?: string;
  chatType?: string;
  derivedTitle?: string;
  displayName?: string;
  key: string;
  label?: string;
  lastAccountId?: string;
  lastChannel?: string;
  lastMessagePreview?: string;
  lastProvider?: string;
  lastTo?: string;
  origin?: Record<string, unknown>;
  provider?: string;
  sessionId?: string;
  updatedAt?: number | null;
}

export interface OpenClawChatHistoryMessage {
  content?: unknown;
  id?: string;
  messageSeq?: number;
  role?: string;
  [key: string]: unknown;
}

export class OpenClawGatewayRuntime {
  readonly config: OpenClawBridgeConfig;
  readonly transport: OpenClawTransport;

  constructor(options: { config: OpenClawBridgeConfig; transport: OpenClawTransport }) {
    this.config = options.config;
    this.transport = options.transport;
  }

  async listAgentContacts(): Promise<OpenClawAgentContact[]> {
    const result = await this.transport.request("agents.list", {});
    const agents = arrayValue(recordValue(result)?.agents) ?? arrayValue(result);
    return (agents ?? []).map((agent) => agentContactFromOpenClawAgent(this.config, recordValue(agent) ?? {}));
  }

  call<T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions): Promise<T> {
    return this.transport.request<T>(method, params, options);
  }

  async featureSnapshot(): Promise<OpenClawGatewayFeatureSnapshot> {
    const entries = await Promise.allSettled([
      this.call("health", {}),
      this.call("status", {}),
      this.call("models.list", { view: "configured" }),
      this.call("channels.status", {}),
      this.call("sessions.list", { includeArchived: true }),
      this.call("commands.list", {}),
      this.call("tools.catalog", {}),
      this.call("skills.status", {}),
      this.call("tasks.list", { limit: 100 }),
      this.call("usage.status", {}),
      this.call("artifacts.list", {}),
      this.call("cron.list", {}),
      this.call("agents.list", {}),
      this.call("config.get", {}),
    ]);
    return stripUndefined({
      health: settledValue(entries[0]),
      status: settledValue(entries[1]),
      models: settledValue(entries[2]),
      channels: settledValue(entries[3]),
      sessions: settledValue(entries[4]),
      commands: settledValue(entries[5]),
      tools: settledValue(entries[6]),
      skills: settledValue(entries[7]),
      tasks: settledValue(entries[8]),
      usage: settledValue(entries[9]),
      artifacts: settledValue(entries[10]),
      cron: settledValue(entries[11]),
      agents: settledValue(entries[12]),
      config: settledValue(entries[13]),
    });
  }

  listModels(params: Record<string, unknown> = { view: "configured" }): Promise<unknown> {
    return this.call("models.list", params);
  }

  listTools(params: Record<string, unknown> = {}): Promise<unknown> {
    return this.call("tools.catalog", params);
  }

  effectiveTools(sessionKey: string): Promise<unknown> {
    return this.call("tools.effective", { sessionKey });
  }

  invokeTool(params: Record<string, unknown>, options?: GatewayRequestOptions): Promise<unknown> {
    return this.call("tools.invoke", params, options);
  }

  listTasks(params: Record<string, unknown> = { limit: 100 }): Promise<unknown> {
    return this.call("tasks.list", params);
  }

  getTask(taskId: string): Promise<unknown> {
    return this.call("tasks.get", { taskId });
  }

  cancelTask(taskId: string, reason?: string): Promise<unknown> {
    return this.call("tasks.cancel", stripUndefined({ reason, taskId }));
  }

  listArtifacts(params: Record<string, unknown>): Promise<unknown> {
    return this.call("artifacts.list", params);
  }

  getArtifact(params: Record<string, unknown>): Promise<unknown> {
    return this.call("artifacts.get", params);
  }

  downloadArtifact(params: Record<string, unknown>): Promise<unknown> {
    return this.call("artifacts.download", params);
  }

  async createSession(options: OpenClawSessionCreateOptions): Promise<OpenClawSessionRef> {
    const raw = await this.transport.request("sessions.create", stripUndefined({
      agentId: options.agentId,
      key: options.key,
      label: options.label,
      message: options.message,
      model: options.model,
      parentSessionKey: options.parentSessionKey,
      task: options.task,
    }));
    const record = recordValue(raw) ?? {};
    const key = stringValue(record.key) ?? stringValue(record.sessionKey) ?? options.key;
    if (!key) throw new Error("OpenClaw sessions.create did not return a session key");
    return stripUndefined({
      agentId: stringValue(record.agentId) ?? options.agentId,
      key,
      label: stringValue(record.label) ?? options.label,
      raw,
      sessionId: stringValue(record.sessionId),
    });
  }

  async listSessions(params: Record<string, unknown> = {}): Promise<OpenClawListedSession[]> {
    const raw = await this.transport.request("sessions.list", params);
    const sessions = arrayValue(recordValue(raw)?.sessions) ?? [];
    return sessions.flatMap((session) => {
      const record = recordValue(session);
      const key = stringValue(record?.key);
      if (!record || !key) return [];
      return [stripUndefined({
        agentId: stringValue(record.agentId),
        chatType: stringValue(record.chatType),
        derivedTitle: stringValue(record.derivedTitle),
        displayName: stringValue(record.displayName),
        key,
        label: stringValue(record.label),
        lastAccountId: stringValue(record.lastAccountId),
        lastChannel: stringValue(record.lastChannel),
        lastMessagePreview: stringValue(record.lastMessagePreview),
        lastProvider: stringValue(record.lastProvider),
        lastTo: stringValue(record.lastTo),
        origin: recordValue(record.origin),
        provider: stringValue(record.provider),
        sessionId: stringValue(record.sessionId),
        updatedAt: typeof record.updatedAt === "number" || record.updatedAt === null ? record.updatedAt : undefined,
      })];
    });
  }

  async loadHistory(sessionKey: string, limit?: number): Promise<OpenClawChatHistoryMessage[]> {
    const raw = await this.transport.request("chat.history", {
      sessionKey,
      ...(limit !== undefined ? { limit } : {}),
    });
    const messages = arrayValue(recordValue(raw)?.messages) ?? [];
    return messages.flatMap((message) => {
      const record = recordValue(message);
      if (!record) return [];
      const normalized: OpenClawChatHistoryMessage = { ...record };
      const role = stringValue(record.role);
      const id = stringValue(record.id);
      if (role) normalized.role = role;
      if (id) normalized.id = id;
      return [normalized];
    });
  }

  async sendMessage(options: OpenClawSessionSendOptions): Promise<OpenClawRunRef> {
    const requestOptions: GatewayRequestOptions = { expectFinal: false };
    if (options.timeoutMs !== undefined) requestOptions.timeoutMs = options.timeoutMs;
    const raw = await this.transport.request("sessions.send", {
      key: options.sessionKey,
      message: options.message,
      ...(options.attachments ? { attachments: options.attachments } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.matrix ? { matrix: options.matrix } : {}),
      ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }, requestOptions);
    const record = recordValue(raw) ?? {};
    const runId = stringValue(record.runId);
    if (!runId) throw new Error("OpenClaw sessions.send did not return a runId");
    return { raw, runId, sessionKey: stringValue(record.sessionKey) ?? options.sessionKey };
  }

  async steerSession(options: OpenClawSessionSendOptions): Promise<OpenClawRunRef> {
    const requestOptions: GatewayRequestOptions = { expectFinal: false };
    if (options.timeoutMs !== undefined) requestOptions.timeoutMs = options.timeoutMs;
    const raw = await this.transport.request("sessions.steer", {
      key: options.sessionKey,
      message: options.message,
      ...(options.attachments ? { attachments: options.attachments } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }, requestOptions);
    const record = recordValue(raw) ?? {};
    const runId = stringValue(record.runId);
    if (!runId) throw new Error("OpenClaw sessions.steer did not return a runId");
    return { raw, runId, sessionKey: stringValue(record.sessionKey) ?? options.sessionKey };
  }

  abortSession(params: { runId?: string; sessionKey?: string }): Promise<unknown> {
    return this.call("sessions.abort", stripUndefined({
      key: params.sessionKey,
      runId: params.runId,
    }));
  }

  eventsForRun(runId: string): AsyncIterable<OpenClawGatewayEvent> {
    return this.transport.events((event) => {
      const payload = recordValue(event.payload);
      return stringValue(payload?.runId) === runId || stringValue(payload?.id) === runId;
    });
  }

  async resolveApproval(payload: OpenClawApprovalResolvePayload): Promise<unknown> {
    const { approvalKind, ...requestPayload } = payload;
    const method = approvalKind === "plugin" ? "plugin.approval.resolve" : "exec.approval.resolve";
    return await this.transport.request(method, requestPayload);
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

export class OpenClawHttpTransport implements OpenClawTransport {
  readonly #baseUrl: URL;
  readonly #eventsPath: string;
  readonly #fetch: typeof fetch;
  readonly #requestPath: string;
  #abortController = new AbortController();

  constructor(options: OpenClawHttpTransportOptions) {
    this.#baseUrl = normalizeGatewayUrl(options.url);
    this.#eventsPath = options.eventsPath ?? "/events";
    this.#fetch = options.fetch ?? fetch;
    this.#requestPath = options.requestPath ?? "/rpc";
  }

  async request<T = unknown>(method: string, params?: unknown, options: GatewayRequestOptions = {}): Promise<T> {
    const abort = new AbortController();
    const timeout = options.timeoutMs == null ? undefined : setTimeout(() => abort.abort(), options.timeoutMs);
    try {
      const response = await this.#fetch(endpointUrl(this.#baseUrl, this.#requestPath), {
        body: JSON.stringify(stripUndefined({
          expectFinal: options.expectFinal,
          method,
          params: params ?? {},
        })),
        headers: {
          ...this.#headers("application/json"),
          "content-type": "application/json",
        },
        method: "POST",
        signal: abort.signal,
      });
      const raw = await readGatewayResponse(response);
      const record = recordValue(raw);
      if (record?.error !== undefined) throw new Error(`OpenClaw gateway ${method} failed: ${errorMessage(record.error)}`);
      return (record && "result" in record ? record.result : raw) as T;
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  async *events(filter?: (event: OpenClawGatewayEvent) => boolean): AsyncIterable<OpenClawGatewayEvent> {
    const response = await this.#fetch(endpointUrl(this.#baseUrl, this.#eventsPath), {
      headers: this.#headers("text/event-stream"),
      method: "GET",
      signal: this.#abortController.signal,
    });
    if (!response.ok) throw new Error(`OpenClaw gateway events failed (${response.status}): ${await response.text()}`);
    const stream = response.body;
    if (!stream) return;
    for await (const event of parseEventStream(stream)) {
      if (!filter || filter(event)) yield event;
    }
  }

  close(): void {
    this.#abortController.abort();
    this.#abortController = new AbortController();
  }

  #headers(accept: string): Record<string, string> {
    return stripUndefined({
      accept,
    });
  }
}

export function createOpenClawHttpTransport(options: OpenClawHttpTransportOptions): OpenClawHttpTransport {
  return new OpenClawHttpTransport(options);
}

export class OpenClawWebSocketTransport implements OpenClawTransport {
  readonly #options: OpenClawWebSocketTransportOptions;
  readonly #pending = new Map<string, {
    reject(error: Error): void;
    resolve(value: unknown): void;
    timeout: ReturnType<typeof setTimeout>;
  }>();
  readonly #subscribers = new Set<{
    events: OpenClawGatewayEvent[];
    filter: ((event: OpenClawGatewayEvent) => boolean) | undefined;
    notify: (() => void) | undefined;
    closed: boolean;
  }>();
  readonly #replay: OpenClawGatewayEvent[] = [];
  #connectPromise: Promise<void> | undefined;
  #socket: WebSocket | undefined;

  constructor(options: OpenClawWebSocketTransportOptions) {
    this.#options = options;
  }

  async request<T = unknown>(method: string, params?: unknown, options: GatewayRequestOptions = {}): Promise<T> {
    await this.#connect();
    return await this.#sendRequest(method, params, options) as T;
  }

  #sendRequest(method: string, params?: unknown, options: GatewayRequestOptions = {}): Promise<unknown> {
    const socket = this.#socket;
    if (!socket) throw new Error("OpenClaw gateway socket is not connected");
    const id = `req_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const timeoutMs = options.timeoutMs ?? this.#options.requestTimeoutMs ?? 30_000;
    const response = new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`OpenClaw gateway request timed out: ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { reject, resolve, timeout });
    });
    socket.send(JSON.stringify({
      id,
      method,
      params: params ?? {},
      type: "req",
    }));
    return response;
  }

  async *events(filter?: (event: OpenClawGatewayEvent) => boolean): AsyncIterable<OpenClawGatewayEvent> {
    await this.#connect();
    const subscriber = {
      closed: false,
      events: this.#replay.filter((event) => !filter || filter(event)),
      filter,
      notify: undefined as (() => void) | undefined,
    };
    this.#subscribers.add(subscriber);
    try {
      for (;;) {
        const event = subscriber.events.shift();
        if (event) {
          yield event;
          continue;
        }
        if (subscriber.closed) return;
        await new Promise<void>((resolve) => {
          subscriber.notify = resolve;
        });
      }
    } finally {
      subscriber.closed = true;
      this.#subscribers.delete(subscriber);
    }
  }

  close(): void {
    const socket = this.#socket;
    this.#socket = undefined;
    this.#connectPromise = undefined;
    socket?.close();
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("OpenClaw gateway socket closed"));
    }
    this.#pending.clear();
    for (const subscriber of this.#subscribers) {
      subscriber.closed = true;
      subscriber.notify?.();
    }
  }

  async #connect(): Promise<void> {
    if (this.#socket?.readyState === 1) return;
    this.#connectPromise ??= this.#open();
    await this.#connectPromise;
  }

  async #open(): Promise<void> {
    const WebSocketCtor = this.#options.WebSocket ?? globalThis.WebSocket;
    if (!WebSocketCtor) throw new Error("OpenClaw WebSocket transport requires WebSocket");
    const socket = new WebSocketCtor(this.#options.url);
    this.#socket = socket;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onError);
      };
      const onOpen = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error("OpenClaw gateway socket failed to open"));
      };
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onError);
    });
    socket.addEventListener("message", (event) => {
      this.#handleFrame(String(event.data));
    });
    socket.addEventListener("close", () => {
      this.close();
    });
    const challenge = await this.#waitForConnectChallenge(socket);
    const identityState = this.#loadDeviceIdentityState();
    const clientId = this.#options.clientId ?? DEFAULT_GATEWAY_CLIENT_ID;
    const clientMode = DEFAULT_GATEWAY_CLIENT_MODE;
    const role = DEFAULT_GATEWAY_ROLE;
    const scopes = [...DEFAULT_GATEWAY_SCOPES];
    const platform = process.platform;
    const deviceToken = this.#options.deviceToken ?? identityState.stored.deviceToken;
    await this.#sendRequest("connect", {
      auth: stripUndefined({
        deviceToken,
      }),
      client: {
        displayName: "pickle-openclaw",
        id: clientId,
        mode: clientMode,
        platform,
        version: this.#options.clientVersion ?? "0.1.0",
      },
      device: buildGatewayDeviceConnectParams(stripUndefined({
        clientId,
        clientMode,
        identity: identityState.identity,
        nonce: challenge.nonce,
        platform,
        role,
        scopes,
        token: deviceToken,
      })),
      maxProtocol: 4,
      minProtocol: 4,
      role,
      scopes,
    }).then((hello) => {
      const auth = recordValue(recordValue(hello)?.auth);
      const nextDeviceToken = stringValue(auth?.deviceToken);
      if (nextDeviceToken && this.#options.deviceIdentityPath) {
        writeDeviceIdentityState(this.#options.deviceIdentityPath, stripUndefined({
          ...identityState.stored,
          deviceToken: nextDeviceToken,
          tokenScopes: arrayValue(auth?.scopes)?.filter((scope): scope is string => typeof scope === "string"),
        }));
      }
    });
  }

  #waitForConnectChallenge(socket: WebSocket): Promise<{ nonce: string }> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("OpenClaw gateway connect challenge timed out"));
      }, this.#options.requestTimeoutMs ?? 30_000);
      const cleanup = () => {
        clearTimeout(timeout);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
      };
      const onClose = () => {
        cleanup();
        reject(new Error("OpenClaw gateway socket closed before connect challenge"));
      };
      const onMessage = (event: MessageEvent) => {
        const frame = recordValue(safeJsonParse(String(event.data)));
        if (frame?.type !== "event" || frame.event !== "connect.challenge") return;
        const nonce = stringValue(recordValue(frame.payload)?.nonce);
        if (!nonce) {
          cleanup();
          reject(new Error("OpenClaw gateway connect challenge missing nonce"));
          return;
        }
        cleanup();
        resolve({ nonce });
      };
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
    });
  }

  #loadDeviceIdentityState(): { identity: GatewayDeviceIdentity; stored: StoredGatewayDeviceIdentity } {
    if (this.#options.deviceIdentityPath) return loadOrCreateDeviceIdentityState(this.#options.deviceIdentityPath);
    const identity = generateDeviceIdentity();
    return {
      identity,
      stored: { ...identity, createdAtMs: Date.now(), version: 1 },
    };
  }

  #handleFrame(raw: string): void {
    const frame = JSON.parse(raw) as Record<string, unknown>;
    if (frame.type === "res") {
      const id = stringValue(frame.id);
      const pending = id ? this.#pending.get(id) : undefined;
      if (!id || !pending) return;
      this.#pending.delete(id);
      clearTimeout(pending.timeout);
      if (frame.ok === false) pending.reject(new Error(`OpenClaw gateway request failed: ${errorMessage(frame.error)}`));
      else pending.resolve(frame.payload);
      return;
    }
    if (frame.type === "event") {
      const event = stripUndefined({
        event: stringValue(frame.event),
        payload: frame.payload ?? frame,
        seq: typeof frame.seq === "number" ? frame.seq : undefined,
        stateVersion: frame.stateVersion,
      });
      this.#recordReplay(event);
      for (const subscriber of this.#subscribers) {
        if (!subscriber.filter || subscriber.filter(event)) {
          subscriber.events.push(event);
          subscriber.notify?.();
          subscriber.notify = undefined;
        }
      }
    }
  }

  #recordReplay(event: OpenClawGatewayEvent): void {
    this.#replay.push(event);
    const limit = this.#options.replayLimit ?? 500;
    if (limit <= 0) {
      this.#replay.length = 0;
      return;
    }
    if (this.#replay.length > limit) this.#replay.splice(0, this.#replay.length - limit);
  }
}

export function createOpenClawWebSocketTransport(options: OpenClawWebSocketTransportOptions): OpenClawWebSocketTransport {
  return new OpenClawWebSocketTransport(options);
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function settledValue(result: PromiseSettledResult<unknown>): unknown {
  return result.status === "fulfilled" ? result.value : undefined;
}

async function readGatewayResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new Error(`OpenClaw gateway request failed (${response.status}): ${text || response.statusText}`);
  return text ? JSON.parse(text) : undefined;
}

function normalizeGatewayUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol === "ws:") url.protocol = "http:";
  if (url.protocol === "wss:") url.protocol = "https:";
  return url;
}

function endpointUrl(baseUrl: URL, path: string): URL {
  if (/^https?:\/\//.test(path)) return new URL(path);
  const base = new URL(baseUrl);
  base.pathname = joinPath(base.pathname, path);
  base.search = "";
  base.hash = "";
  return base;
}

function joinPath(basePath: string, path: string): string {
  const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const next = path.startsWith("/") ? path : `/${path}`;
  return `${base}${next}` || "/";
}

async function* parseEventStream(stream: ReadableStream<Uint8Array>): AsyncIterable<OpenClawGatewayEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split = eventBoundary(buffer);
      while (split >= 0) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + frameBoundaryLength(buffer, split));
        const event = parseEventFrame(frame);
        if (event) yield event;
        split = eventBoundary(buffer);
      }
    }
    buffer += decoder.decode();
    const event = parseEventFrame(buffer);
    if (event) yield event;
  } finally {
    reader.releaseLock();
  }
}

function eventBoundary(value: string): number {
  const lf = value.indexOf("\n\n");
  const crlf = value.indexOf("\r\n\r\n");
  if (lf < 0) return crlf;
  if (crlf < 0) return lf;
  return Math.min(lf, crlf);
}

function frameBoundaryLength(value: string, index: number): number {
  return value.slice(index, index + 4) === "\r\n\r\n" ? 4 : 2;
}

function parseEventFrame(frame: string): OpenClawGatewayEvent | undefined {
  const lines = frame.split(/\r?\n/);
  let event: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice("event:".length).trim();
    if (line.startsWith("data:")) data.push(line.slice("data:".length).trimStart());
  }
  if (data.length === 0) return undefined;
  const payload = JSON.parse(data.join("\n")) as unknown;
  const record = recordValue(payload);
  if (record && ("event" in record || "payload" in record || "seq" in record)) {
    return stripUndefined({
      event: stringValue(record.event) ?? event,
      payload: record.payload ?? payload,
      seq: typeof record.seq === "number" ? record.seq : undefined,
      stateVersion: record.stateVersion,
    });
  }
  return stripUndefined({ event, payload });
}

function errorMessage(error: unknown): string {
  const record = recordValue(error);
  return stringValue(record?.message) ?? stringValue(error) ?? JSON.stringify(error);
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

function loadOrCreateDeviceIdentityState(filePath: string): {
  identity: GatewayDeviceIdentity;
  stored: StoredGatewayDeviceIdentity;
} {
  const parsed = readStoredDeviceIdentity(filePath);
  if (parsed) return { identity: parsed, stored: parsed };
  const identity = generateDeviceIdentity();
  const stored = { ...identity, createdAtMs: Date.now(), version: 1 as const };
  writeDeviceIdentityState(filePath, stored);
  return { identity, stored };
}

function readStoredDeviceIdentity(filePath: string): StoredGatewayDeviceIdentity | undefined {
  try {
    const parsed = recordValue(JSON.parse(readFileSync(filePath, "utf8")) as unknown);
    if (!parsed || parsed.version !== 1) return undefined;
    const deviceId = stringValue(parsed.deviceId);
    const publicKeyPem = stringValue(parsed.publicKeyPem);
    const privateKeyPem = stringValue(parsed.privateKeyPem);
    if (!deviceId || !publicKeyPem || !privateKeyPem) return undefined;
    return stripUndefined({
      createdAtMs: typeof parsed.createdAtMs === "number" ? parsed.createdAtMs : Date.now(),
      deviceId,
      deviceToken: stringValue(parsed.deviceToken),
      privateKeyPem,
      publicKeyPem,
      tokenScopes: arrayValue(parsed.tokenScopes)?.filter((scope): scope is string => typeof scope === "string"),
      version: 1 as const,
    });
  } catch {
    return undefined;
  }
}

function writeDeviceIdentityState(filePath: string, value: StoredGatewayDeviceIdentity): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function generateDeviceIdentity(): GatewayDeviceIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    deviceId: createHash("sha256").update(publicKeyRawFromPem(publicKeyPem)).digest("hex"),
    privateKeyPem,
    publicKeyPem,
  };
}

function buildGatewayDeviceConnectParams(options: {
  clientId: string;
  clientMode: string;
  identity: GatewayDeviceIdentity;
  nonce: string;
  platform: string;
  role: string;
  scopes: string[];
  token?: string;
}): Record<string, unknown> {
  const signedAt = Date.now();
  const payload = [
    "v3",
    options.identity.deviceId,
    options.clientId,
    options.clientMode,
    options.role,
    options.scopes.join(","),
    String(signedAt),
    options.token ?? "",
    options.nonce,
    options.platform.trim(),
    "",
  ].join("|");
  return {
    id: options.identity.deviceId,
    nonce: options.nonce,
    publicKey: base64Url(publicKeyRawFromPem(options.identity.publicKeyPem)),
    signature: base64Url(sign(null, Buffer.from(payload, "utf8"), createPrivateKey(options.identity.privateKeyPem))),
    signedAt,
  };
}

function publicKeyRawFromPem(publicKeyPem: string): Buffer {
  const spki = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function base64Url(value: Buffer): string {
  return value.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

type StripUndefined<T extends object> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function stripUndefined<T extends Record<string, unknown>>(value: T): StripUndefined<T> {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value as StripUndefined<T>;
}
