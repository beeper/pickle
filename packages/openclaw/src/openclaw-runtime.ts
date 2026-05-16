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
