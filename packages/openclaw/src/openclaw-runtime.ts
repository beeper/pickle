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
  accessToken?: string;
  eventsPath?: string;
  fetch?: typeof fetch;
  requestPath?: string;
  url: string;
}

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
  message: string;
  sessionKey: string;
  thinking?: string;
  timeoutMs?: number;
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
    const requestOptions: GatewayRequestOptions = { expectFinal: true };
    if (options.timeoutMs !== undefined) requestOptions.timeoutMs = options.timeoutMs;
    const raw = await this.transport.request("sessions.send", {
      key: options.sessionKey,
      message: options.message,
      ...(options.attachments ? { attachments: options.attachments } : {}),
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.thinking ? { thinking: options.thinking } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }, requestOptions);
    const record = recordValue(raw) ?? {};
    const runId = stringValue(record.runId);
    if (!runId) throw new Error("OpenClaw sessions.send did not return a runId");
    return { raw, runId, sessionKey: stringValue(record.sessionKey) ?? options.sessionKey };
  }

  eventsForRun(runId: string): AsyncIterable<OpenClawGatewayEvent> {
    return this.transport.events((event) => {
      const payload = recordValue(event.payload);
      return stringValue(payload?.runId) === runId || stringValue(payload?.id) === runId;
    });
  }

  async resolveApproval(payload: OpenClawApprovalResolvePayload): Promise<unknown> {
    return await this.transport.request("exec.approval.resolve", payload);
  }

  async close(): Promise<void> {
    await this.transport.close?.();
  }
}

export class OpenClawHttpTransport implements OpenClawTransport {
  readonly #accessToken: string | undefined;
  readonly #baseUrl: URL;
  readonly #eventsPath: string;
  readonly #fetch: typeof fetch;
  readonly #requestPath: string;
  #abortController = new AbortController();

  constructor(options: OpenClawHttpTransportOptions) {
    this.#accessToken = options.accessToken;
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
      authorization: this.#accessToken ? `Bearer ${this.#accessToken}` : undefined,
    });
  }
}

export function createOpenClawHttpTransport(options: OpenClawHttpTransportOptions): OpenClawHttpTransport {
  return new OpenClawHttpTransport(options);
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
