import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { OpenClawAgentContact, OpenClawBridgeConfig } from "./types";
import { agentContactFromOpenClawAgent } from "./rooms";
import type { OpenClawApprovalResolvePayload } from "./approval";
import { getBeeperChannelRuntimeForHost } from "./beeper-channel-runtime";
import {
  AGUIEventType,
  createApprovalRunState,
  mapOpenClawApprovalRequest,
  mapOpenClawApprovalResponse,
  mapOpenClawCustom,
} from "./beeper-turn-events";
import type { AGUIEvent } from "./beeper-turn-events";

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

export interface OpenClawRuntimeRequestSurface {
  close?(): Promise<void> | void;
  events(filter?: (event: OpenClawGatewayEvent) => boolean): AsyncIterable<OpenClawGatewayEvent>;
  request<T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions): Promise<T>;
}

export interface OpenClawHostRuntime {
  agent?: {
    resolveAgentDir?: (config: unknown, agentId?: string) => string;
    resolveAgentTimeoutMs?: (options: Record<string, unknown>) => number;
    session?: {
      getSessionEntry?: (options: Record<string, unknown>) => Record<string, unknown> | undefined;
      listSessionEntries?: (options?: Record<string, unknown>) => Array<{ entry: Record<string, unknown>; sessionKey: string }>;
      resolveSessionFilePath?: (sessionId: string, entry?: Record<string, unknown>, options?: Record<string, unknown>) => string;
      upsertSessionEntry?: (options: Record<string, unknown>) => Promise<void> | void;
    };
  };
  channel?: {
    inbound?: {
      buildContext?: (params: Record<string, unknown>) => Record<string, unknown>;
      dispatchReply?: (params: Record<string, unknown>) => Promise<unknown>;
    };
    reply?: {
      dispatchReplyWithBufferedBlockDispatcher?: (params: Record<string, unknown>) => Promise<unknown>;
    };
    session?: {
      recordInboundSession?: (params: Record<string, unknown>) => Promise<void> | void;
      resolveStorePath?: (store?: string, options?: Record<string, unknown>) => string;
    };
  };
  call?: <T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions) => Promise<T>;
  config?: {
    current?: () => unknown;
  };
  events?: OpenClawHostEvents;
  request?: <T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions) => Promise<T>;
  subscribe?: (filter?: (event: OpenClawGatewayEvent) => boolean) => AsyncIterable<OpenClawGatewayEvent>;
}

export type OpenClawHostEvents =
  | ((filter?: (event: OpenClawGatewayEvent) => boolean) => AsyncIterable<OpenClawGatewayEvent>)
  | {
      onAgentEvent?: (listener: (event: OpenClawAgentRuntimeEvent) => void) => () => void;
      onSessionTranscriptUpdate?: (listener: (update: OpenClawSessionTranscriptUpdate) => void) => () => void;
    };

export type OpenClawAgentRuntimeEvent = {
  data?: Record<string, unknown>;
  runId?: string;
  seq?: number;
  ts?: number;
  sessionKey?: string;
  stream?: string;
};

export type OpenClawSessionTranscriptUpdate = {
  sessionFile?: string;
  sessionKey?: string;
  message?: unknown;
  messageId?: string;
  messageSeq?: number;
};

export interface OpenClawSessionCreateOptions {
  agentId: string;
  key?: string;
  label?: string;
  message?: string;
  model?: string;
  parentSessionKey?: string;
  reasoningLevel?: string;
  task?: string;
  verboseLevel?: string;
}

export interface OpenClawSessionPatchOptions {
  agentId: string;
  key: string;
  label?: string;
  reasoningLevel?: string;
  verboseLevel?: string;
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
  command?: {
    args?: string;
    name: string;
  };
  formattedBody?: string;
  mentions?: {
    room?: boolean;
    userIds?: string[];
  };
  relation?: {
    key?: string;
    kind?: "reply" | "thread" | "edit" | "reaction" | "reaction_remove" | "redaction" | "read_receipt" | "marked_unread";
    quote?: {
      body?: string;
      sender?: string;
    };
    replyToEventId?: string;
    receiptType?: string;
    targetEventId?: string;
    targetReactionId?: string;
    targetRunId?: string;
    targetSessionKey?: string;
    threadRootEventId?: string;
    unread?: boolean;
  };
  roomId?: string;
  sender?: string;
  threadRootEventId?: string;
}

export interface OpenClawReplyReference {
  eventId: string;
  roomId?: string;
}

export interface OpenClawSessionRef {
  agentId?: string;
  key: string;
  label?: string;
  raw?: unknown;
  sessionFile?: string;
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

export interface OpenClawSessionHistoryRuntime {
  readonly config: OpenClawBridgeConfig;
  listAgentContacts(): Promise<OpenClawAgentContact[]>;
  listSessions(params?: Record<string, unknown>): Promise<OpenClawListedSession[]>;
  loadHistory(sessionKey: string, limit?: number): Promise<OpenClawChatHistoryMessage[]>;
}

export interface OpenClawSessionTurnRuntime extends OpenClawSessionHistoryRuntime {
  createSession(options: OpenClawSessionCreateOptions): Promise<OpenClawSessionRef>;
  patchSession(options: OpenClawSessionPatchOptions): Promise<void>;
  resolveApproval(payload: OpenClawApprovalResolvePayload): Promise<unknown>;
  sendMessage(options: OpenClawSessionSendOptions): Promise<OpenClawRunRef>;
}

export interface OpenClawBridgeRuntime extends OpenClawSessionTurnRuntime {
  close(): Promise<void>;
}

export class OpenClawPluginRuntimeAdapter {
  readonly config: OpenClawBridgeConfig;
  readonly transport: OpenClawRuntimeRequestSurface;

  constructor(options: { config: OpenClawBridgeConfig; transport: OpenClawRuntimeRequestSurface }) {
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
    if (options.reasoningLevel || options.verboseLevel) {
      const patch: OpenClawSessionPatchOptions = {
        agentId: options.agentId,
        key,
      };
      if (options.reasoningLevel) patch.reasoningLevel = options.reasoningLevel;
      if (options.verboseLevel) patch.verboseLevel = options.verboseLevel;
      await this.patchSession(patch);
    }
    return stripUndefined({
      agentId: stringValue(record.agentId) ?? options.agentId,
      key,
      label: stringValue(record.label) ?? options.label,
      raw,
      sessionId: stringValue(record.sessionId),
    });
  }

  async patchSession(options: OpenClawSessionPatchOptions): Promise<void> {
    await this.transport.request("sessions.patch", stripUndefined({
      agentId: options.agentId,
      key: options.key,
      label: options.label,
      reasoningLevel: options.reasoningLevel,
      verboseLevel: options.verboseLevel,
    }));
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
        sessionFile: stringValue(record.sessionFile),
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
    if (this.transport instanceof OpenClawHostRuntimeAdapter) {
      return this.transport.sendMessage(options, requestOptions);
    }
    throw new Error("OpenClaw Beeper turns require OpenClaw channel inbound helpers");
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

export class OpenClawHostRuntimeAdapter implements OpenClawRuntimeRequestSurface {
  readonly #runtime: OpenClawHostRuntime;
  readonly #localEvents = new LocalEventBus();

  constructor(runtime: OpenClawHostRuntime) {
    this.#runtime = runtime;
  }

  request<T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions): Promise<T> {
    if (isDirectPluginRuntimeMethod(method)) {
      return this.#pluginRuntimeRequest<T>(method, params, options);
    }
    const call = this.#runtime.request ?? this.#runtime.call;
    if (!call) return this.#pluginRuntimeRequest<T>(method, params, options);
    return call(method, params, options);
  }

  events(filter?: (event: OpenClawGatewayEvent) => boolean): AsyncIterable<OpenClawGatewayEvent> {
    if (typeof this.#runtime.events === "object" && this.#runtime.events?.onAgentEvent) {
      return mergeEvents([
        agentRuntimeEvents(this.#runtime.events.onAgentEvent, filter),
        this.#localEvents.events(filter),
      ]);
    }
    if (typeof this.#runtime.events === "object" && this.#runtime.events?.onSessionTranscriptUpdate) {
      return mergeEvents([
        transcriptUpdateEvents(this.#runtime.events.onSessionTranscriptUpdate, filter),
        this.#localEvents.events(filter),
      ]);
    }
    const events = (typeof this.#runtime.events === "function" ? this.#runtime.events : undefined) ?? this.#runtime.subscribe;
    if (!events) return this.#localEvents.events(filter);
    return events(filter);
  }

  async sendMessage(options: OpenClawSessionSendOptions, requestOptions: GatewayRequestOptions = {}): Promise<OpenClawRunRef> {
    const raw = await sendSessionInPluginRuntime(this.#runtime, this.#localEvents, {
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
    if (!runId) throw new Error("OpenClaw channel inbound turn did not return a runId");
    return { raw, runId, sessionKey: stringValue(record.sessionKey) ?? options.sessionKey };
  }

  async #pluginRuntimeRequest<T = unknown>(
    method: string,
    params?: unknown,
    _options?: GatewayRequestOptions
  ): Promise<T> {
    switch (method) {
      case "agents.list":
        return { agents: agentsFromPluginConfig(this.#runtime.config?.current?.()) } as T;
      case "chat.history":
        return { messages: await historyFromPluginRuntime(this.#runtime, params) } as T;
      case "sessions.create":
        return await createSessionInPluginRuntime(this.#runtime, params) as T;
      case "sessions.list":
        return { sessions: sessionsFromPluginRuntime(this.#runtime, params) } as T;
      case "sessions.patch":
        return await patchSessionInPluginRuntime(this.#runtime, params) as T;
      default:
        throw new Error(`OpenClaw plugin runtime does not expose request/call for ${method}`);
    }
  }
}

export function createOpenClawHostRuntimeAdapter(runtime: OpenClawHostRuntime): OpenClawHostRuntimeAdapter {
  return new OpenClawHostRuntimeAdapter(runtime);
}

function isDirectPluginRuntimeMethod(method: string): boolean {
  return method === "agents.list"
    || method === "chat.history"
    || method === "sessions.create"
    || method === "sessions.patch"
    || method === "sessions.list";
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

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

async function* emptyEvents(): AsyncIterable<OpenClawGatewayEvent> {}

class LocalEventBus {
  readonly #subscribers = new Set<(event: OpenClawGatewayEvent) => void>();

  emit(event: OpenClawGatewayEvent): void {
    for (const subscriber of this.#subscribers) subscriber(event);
  }

  async *events(filter?: (event: OpenClawGatewayEvent) => boolean): AsyncIterable<OpenClawGatewayEvent> {
    const queue: OpenClawGatewayEvent[] = [];
    let notify: (() => void) | undefined;
    let closed = false;
    const subscriber = (event: OpenClawGatewayEvent) => {
      if (filter && !filter(event)) return;
      queue.push(event);
      notify?.();
      notify = undefined;
    };
    this.#subscribers.add(subscriber);
    try {
      for (;;) {
        const event = queue.shift();
        if (event) {
          yield event;
          continue;
        }
        if (closed) return;
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
      }
    } finally {
      closed = true;
      this.#subscribers.delete(subscriber);
      notify?.();
    }
  }
}

async function* mergeEvents(iterables: AsyncIterable<OpenClawGatewayEvent>[]): AsyncIterable<OpenClawGatewayEvent> {
  const queue: OpenClawGatewayEvent[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  const controllers = iterables.map(() => new AbortController());
  const pump = (async () => {
    await Promise.all(iterables.map(async (iterable, index) => {
      try {
        for await (const event of iterable) {
          if (controllers[index]?.signal.aborted) return;
          queue.push(event);
          notify?.();
          notify = undefined;
        }
      } catch {
        // Individual event surfaces are best effort. The bridge keeps any other
        // live source open so streaming does not die on optional host hooks.
      }
    }));
  })();
  try {
    for (;;) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      if (closed) return;
      await Promise.race([
        new Promise<void>((resolve) => {
          notify = resolve;
        }),
        pump.then(() => undefined),
      ]);
      if (queue.length === 0) return;
    }
  } finally {
    closed = true;
    for (const controller of controllers) controller.abort();
    notify?.();
  }
}

async function* agentRuntimeEvents(
  onAgentEvent: (listener: (event: OpenClawAgentRuntimeEvent) => void) => () => void,
  filter?: (event: OpenClawGatewayEvent) => boolean,
): AsyncIterable<OpenClawGatewayEvent> {
  const queue: OpenClawGatewayEvent[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  const unsubscribe = onAgentEvent((agentEvent) => {
    const data = recordValue(agentEvent.data) ?? {};
    const event = stripUndefined({
      event: agentEvent.stream,
      payload: stripUndefined({
        ...data,
        ...(agentEvent.sessionKey ? { sessionKey: agentEvent.sessionKey } : {}),
      }),
      seq: numberValue(data.seq),
    });
    if (filter && !filter(event)) return;
    queue.push(event);
    notify?.();
    notify = undefined;
  });
  try {
    for (;;) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    closed = true;
    unsubscribe();
    notify?.();
  }
}

async function* transcriptUpdateEvents(
  onSessionTranscriptUpdate: (listener: (update: OpenClawSessionTranscriptUpdate) => void) => () => void,
  filter?: (event: OpenClawGatewayEvent) => boolean,
): AsyncIterable<OpenClawGatewayEvent> {
  const queue: OpenClawGatewayEvent[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  const unsubscribe = onSessionTranscriptUpdate((update) => {
    const event = stripUndefined({
      event: "session.transcript.update",
      payload: update,
      seq: update.messageSeq,
    });
    if (filter && !filter(event)) return;
    queue.push(event);
    notify?.();
    notify = undefined;
  });
  try {
    for (;;) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      if (closed) return;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  } finally {
    closed = true;
    unsubscribe();
    notify?.();
  }
}

function agentsFromPluginConfig(config: unknown): Array<Record<string, unknown>> {
  const agents = recordValue(recordValue(config)?.agents);
  const configured = arrayValue(agents?.list)
    ?? arrayValue(agents?.agents)
    ?? arrayValue(agents?.items);
  const normalized = (configured ?? []).flatMap((agent) => {
    const record = recordValue(agent);
    if (!record) return [];
    const id = stringValue(record.id) ?? stringValue(record.agentId) ?? stringValue(record.name);
    if (!id) return [];
    return [stripUndefined({
      id,
      displayName: stringValue(record.displayName) ?? stringValue(record.name) ?? id,
      description: stringValue(record.description),
    })];
  });
  return normalized.length > 0 ? normalized : [{ id: "main", displayName: "main" }];
}

function sessionsFromPluginRuntime(runtime: OpenClawHostRuntime, params: unknown): Array<Record<string, unknown>> {
  const listSessionEntries = runtime.agent?.session?.listSessionEntries;
  if (!listSessionEntries) return [];
  const sessionEntriesByKey = new Map<string, { entry: Record<string, unknown>; sessionKey: string }>();
  for (const item of listSessionEntries() ?? []) {
    const entry = recordValue(item.entry);
    const sessionKey = stringValue(item.sessionKey) ?? stringValue(entry?.sessionKey) ?? stringValue(entry?.key);
    if (entry && sessionKey) sessionEntriesByKey.set(sessionKey, { entry, sessionKey });
  }
  for (const agentId of agentIdsFromPluginConfig(runtime.config?.current?.())) {
    for (const item of listSessionEntries({ agentId }) ?? []) {
      const entry = recordValue(item.entry);
      const sessionKey = stringValue(item.sessionKey) ?? stringValue(entry?.sessionKey) ?? stringValue(entry?.key);
      if (entry && sessionKey) sessionEntriesByKey.set(sessionKey, { entry, sessionKey });
    }
  }
  const sessionEntries = [...sessionEntriesByKey.values()];
  const includeArchived = recordValue(params)?.includeArchived === true;
  return sessionEntries.flatMap((item) => {
    const entry = recordValue(item.entry);
    const sessionKey = stringValue(item.sessionKey) ?? stringValue(entry?.sessionKey) ?? stringValue(entry?.key);
    if (!entry || !sessionKey) return [];
    if (!includeArchived && entry.archived === true) return [];
    const origin = recordValue(entry.origin);
    return [stripUndefined({
      agentId: stringValue(entry.agentId) ?? agentIdFromSessionKey(sessionKey),
      chatType: stringValue(entry.chatType) ?? stringValue(origin?.chatType),
      displayName: stringValue(entry.displayName) ?? stringValue(entry.title) ?? stringValue(entry.label) ?? stringValue(entry.derivedTitle) ?? sessionKey,
      derivedTitle: stringValue(entry.derivedTitle),
      key: sessionKey,
      label: stringValue(entry.label),
      lastAccountId: stringValue(entry.lastAccountId) ?? stringValue(origin?.accountId),
      lastChannel: stringValue(entry.lastChannel) ?? stringValue(origin?.provider) ?? stringValue(origin?.surface),
      lastProvider: stringValue(entry.lastProvider) ?? stringValue(origin?.provider),
      lastTo: stringValue(entry.lastTo) ?? stringValue(origin?.to),
      origin,
      provider: stringValue(entry.provider) ?? stringValue(origin?.provider),
      sessionFile: stringValue(entry.sessionFile),
      sessionId: stringValue(entry.sessionId),
      updatedAt: typeof entry.updatedAt === "number" || entry.updatedAt === null ? entry.updatedAt : undefined,
    })];
  });
}

async function createSessionInPluginRuntime(runtime: OpenClawHostRuntime, params: unknown): Promise<Record<string, unknown>> {
  const record = recordValue(params) ?? {};
  const agentId = stringValue(record.agentId) ?? "main";
  const label = stringValue(record.label);
  const sessionKey = stringValue(record.key) ?? buildPluginSessionKey(agentId, label);
  const entry = resolvePluginSession(runtime, sessionKey, agentId).entry ?? {};
  const sessionId = stringValue(entry.sessionId) ?? sessionIdFromSessionKey(sessionKey);
  const now = Date.now();
  const next = stripUndefined({
    ...entry,
    chatType: stringValue(entry.chatType) ?? "direct",
    derivedTitle: stringValue(entry.derivedTitle) ?? label,
    label: label ?? stringValue(entry.label),
    origin: recordValue(entry.origin) ?? { provider: "beeper", surface: "beeper", chatType: "direct" },
    provider: stringValue(entry.provider) ?? "beeper",
    reasoningLevel: stringValue(record.reasoningLevel) ?? stringValue(entry.reasoningLevel),
    sessionFile: stringValue(entry.sessionFile) ?? resolvePluginSessionFile(runtime, agentId, sessionId, entry),
    sessionId,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : now,
    verboseLevel: stringValue(record.verboseLevel) ?? stringValue(entry.verboseLevel),
  });
  await runtime.agent?.session?.upsertSessionEntry?.({ agentId, entry: next, sessionKey });
  return { agentId, key: sessionKey, label, sessionFile: next.sessionFile, sessionId };
}

async function patchSessionInPluginRuntime(runtime: OpenClawHostRuntime, params: unknown): Promise<Record<string, unknown>> {
  const record = recordValue(params) ?? {};
  const sessionKey = stringValue(record.key) ?? stringValue(record.sessionKey);
  if (!sessionKey) throw new Error("OpenClaw sessions.patch requires session key");
  const agentId = stringValue(record.agentId) ?? agentIdFromSessionKey(sessionKey) ?? "main";
  const resolved = resolvePluginSession(runtime, sessionKey, agentId);
  const entry = resolved.entry ?? {};
  const next = stripUndefined({
    ...entry,
    ...(record.label !== undefined ? { label: stringValue(record.label) } : {}),
    ...(record.reasoningLevel !== undefined ? { reasoningLevel: stringValue(record.reasoningLevel) } : {}),
    ...(record.verboseLevel !== undefined ? { verboseLevel: stringValue(record.verboseLevel) } : {}),
    updatedAt: Date.now(),
  });
  await runtime.agent?.session?.upsertSessionEntry?.({ agentId, entry: next, sessionKey });
  return { agentId, entry: next, key: sessionKey, ok: true };
}

async function sendSessionInPluginRuntime(
  runtime: OpenClawHostRuntime,
  localEvents: LocalEventBus,
  params: unknown,
  options?: GatewayRequestOptions,
): Promise<Record<string, unknown>> {
  const record = recordValue(params) ?? {};
  const sessionKey = stringValue(record.key) ?? stringValue(record.sessionKey);
  const message = stringValue(record.message);
  if (!sessionKey) throw new Error("OpenClaw channel inbound turn requires session key");
  if (!message) throw new Error("OpenClaw channel inbound turn requires message");
  const agentId = agentIdFromSessionKey(sessionKey) ?? "main";
  const resolved = resolvePluginSession(runtime, sessionKey, agentId);
  const entry = resolved.entry ?? {};
  const sessionId = stringValue(entry.sessionId) ?? sessionIdFromSessionKey(sessionKey);
  const sessionFile = stringValue(entry.sessionFile) ?? resolvePluginSessionFile(runtime, agentId, sessionId, entry);
  const runId = `beeper:${randomUUID()}`;
  const cfg = runtime.config?.current?.();
  if (!canRunNativeChannelTurn(runtime)) {
    throw new Error("OpenClaw Beeper requires OpenClaw channel inbound helpers (runtime.channel.inbound, runtime.channel.reply, and runtime.channel.session)");
  }
  const timeoutMs = options?.timeoutMs ?? numberValue(record.timeoutMs) ?? runtime.agent?.resolveAgentTimeoutMs?.({ cfg }) ?? 48 * 60 * 60 * 1000;
  startPluginRun(localEvents, {
    agentId,
    runId,
    sessionId,
    sessionKey,
  }, () =>
    runBeeperChannelTurnInPluginRuntime({
      agentId,
      cfg,
      localEvents,
      message,
      record,
      runId,
      runtime,
      sessionFile,
      sessionId,
      sessionKey,
      timeoutMs,
    })
  );
  return { runId, sessionFile, sessionId, sessionKey };
}

function startPluginRun(
  localEvents: LocalEventBus,
  base: { agentId: string; runId: string; sessionId: string; sessionKey: string },
  run: () => Promise<void>,
): void {
  localEvents.emit({ event: "run.queued", payload: base });
  void run().catch((error) => {
    localEvents.emit({
      event: "run.failed",
      payload: {
        ...base,
        error: errorText(error),
      },
    });
  });
}

function canRunNativeChannelTurn(runtime: OpenClawHostRuntime): boolean {
  return Boolean(
    runtime.channel?.inbound?.buildContext &&
      runtime.channel.inbound.dispatchReply &&
      runtime.channel.session?.recordInboundSession &&
      runtime.channel.reply?.dispatchReplyWithBufferedBlockDispatcher,
  );
}

async function runBeeperChannelTurnInPluginRuntime(params: {
  agentId: string;
  cfg: unknown;
  localEvents: LocalEventBus;
  message: string;
  record: Record<string, unknown>;
  runId: string;
  runtime: OpenClawHostRuntime;
  sessionFile: string;
  sessionId: string;
  sessionKey: string;
  timeoutMs: number;
}): Promise<void> {
  const inbound = params.runtime.channel?.inbound;
  const channelSession = params.runtime.channel?.session;
  const channelReply = params.runtime.channel?.reply;
  if (!inbound?.buildContext || !inbound.dispatchReply || !channelSession?.recordInboundSession || !channelReply?.dispatchReplyWithBufferedBlockDispatcher) {
    throw new Error("OpenClaw plugin runtime channel inbound helpers are incomplete");
  }

  const sender = recordValue(recordValue(params.record.matrix)?.sender) ?? {};
  const matrix = recordValue(params.record.matrix) ?? {};
  const senderId = stringValue(matrix.sender) ?? stringValue(sender.id) ?? "beeper";
  const command = recordValue(matrix.command);
  const commandName = stringValue(command?.name);
  const commandArgs = stringValue(command?.args) ?? "";
  const commandBody = commandName ? `/${commandName}${commandArgs ? ` ${commandArgs}` : ""}` : params.message;
  const roomId = stringValue(recordValue(params.record.matrix)?.roomId) ?? stringValue(params.record.roomId) ?? params.sessionKey;
  const eventId = stringValue(params.record.idempotencyKey) ?? params.runId;
  const sessionConfig = recordValue(recordValue(params.cfg)?.session);
  const storePath = channelSession.resolveStorePath?.(stringValue(sessionConfig?.store), { agentId: params.agentId })
    ?? path.dirname(params.sessionFile);
  const ctxPayload = inbound.buildContext({
    channel: "beeper",
    accountId: "beeper",
    provider: "beeper",
    surface: "beeper",
    messageId: eventId,
    timestamp: Date.now(),
    from: senderId,
    sender: {
      id: senderId,
      name: senderId,
      displayLabel: senderId,
    },
    conversation: {
      kind: "direct",
      id: roomId,
      label: roomId,
      routePeer: {
        kind: "direct",
        id: roomId,
      },
    },
    route: {
      agentId: params.agentId,
      accountId: "beeper",
      routeSessionKey: params.sessionKey,
      dispatchSessionKey: params.sessionKey,
      createIfMissing: true,
    },
    reply: {
      to: roomId,
      originatingTo: roomId,
      nativeChannelId: roomId,
      replyToId: stringValue(recordValue(matrix.relation)?.replyToEventId) ?? stringValue(recordValue(params.record.replyTo)?.eventId),
    },
    message: {
      body: params.message,
      rawBody: params.message,
      bodyForAgent: params.message,
      commandBody,
      envelopeFrom: senderId,
      senderLabel: senderId,
      preview: params.message.slice(0, 280),
    },
    ...(commandName
      ? {
          command: {
            authorized: true,
            body: commandBody,
            kind: "text-slash",
            name: commandName,
          },
        }
      : {}),
    access: {
      commands: {
        authorized: true,
        allowTextCommands: true,
        useAccessGroups: false,
        authorizers: [{ configured: true, allowed: true }],
      },
      dm: {
        decision: "allow",
        allowFrom: [],
      },
      event: {
        kind: "message",
        authMode: "none",
        mayPair: false,
        authorized: true,
        hasOriginSubject: true,
        originSubjectMatched: true,
      },
    },
    supplemental: relationSupplementalContext(matrix),
    extra: {
      OpenClawBeeperRunId: params.runId,
    },
  });

  const threadRoot = stringValue(recordValue(matrix.relation)?.threadRootEventId) ?? stringValue(recordValue(matrix.relation)?.replyToEventId);
  const stream = createBeeperReplyStreamEmitter({
    agentId: params.agentId,
    hostRuntime: params.runtime,
    localEvents: params.localEvents,
    roomId,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    ...(threadRoot ? { threadRoot } : {}),
  });
  params.localEvents.emit({ event: "run.started", payload: { agentId: params.agentId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  let unsubscribeAgentEvents: (() => void) | undefined;
  let streamCallbackTail = Promise.resolve();
  const enqueueStream = (operation: () => Promise<void>) => {
    streamCallbackTail = streamCallbackTail
      .catch(() => undefined)
      .then(operation);
    stream.trackExternal(streamCallbackTail);
    return streamCallbackTail;
  };
  const scheduleStream = (operation: () => Promise<void>) => {
    enqueueStream(operation);
  };
  unsubscribeAgentEvents = forwardAgentRuntimeStreamEvents({
    enqueue: enqueueStream,
    runId: params.runId,
    runtime: params.runtime,
    sessionKey: params.sessionKey,
    stream,
  });
  try {
    await inbound.dispatchReply({
      cfg: params.cfg,
      channel: "beeper",
      accountId: "beeper",
      agentId: params.agentId,
      routeSessionKey: params.sessionKey,
      storePath,
      ctxPayload,
      recordInboundSession: channelSession.recordInboundSession,
      dispatchReplyWithBufferedBlockDispatcher: channelReply.dispatchReplyWithBufferedBlockDispatcher,
      delivery: {
        deliver: async (payload: unknown, info?: unknown) => {
          const final = stringValue(recordValue(info)?.kind) === "final";
          enqueueStream(() => stream.textPayload(payload, final ? "final" : "block"));
          if (final) await stream.finish();
          return { visibleReplySent: true };
        },
        onError: async (error: unknown) => {
          await stream.fail(error);
          params.localEvents.emit({ event: "run.failed", payload: { agentId: params.agentId, error: errorText(error), runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
        },
      },
      replyOptions: {
        runId: params.runId,
        disableBlockStreaming: false,
        reasoningLevelOverride: "stream",
        verboseLevelOverride: "full",
        sourceReplyDeliveryMode: "automatic",
        timeoutOverrideSeconds: Math.max(1, Math.ceil(params.timeoutMs / 1000)),
        suppressDefaultToolProgressMessages: true,
        allowProgressCallbacksWhenSourceDeliverySuppressed: true,
        onAssistantMessageStart: stream.assistantMessageStart,
        onBlockReply: (payload: unknown) => scheduleStream(() => stream.textPayload(payload, "block")),
        onBlockReplyQueued: (payload: unknown) => scheduleStream(() => stream.textPayload(payload, "block")),
        onPartialReply: (payload: unknown) => scheduleStream(() => stream.textPayload(payload, "partial")),
        onReasoningEnd: () => scheduleStream(() => stream.reasoningEnd()),
        onReasoningStream: (payload: unknown) => scheduleStream(() => stream.reasoningPayload(payload)),
        onToolStart: (payload: unknown) => scheduleStream(() => stream.toolStart(payload)),
        onToolResult: (payload: unknown) => scheduleStream(() => stream.toolResult(payload)),
        onItemEvent: (payload: unknown) => scheduleStream(() => stream.itemEvent(payload)),
        onPlanUpdate: (payload: unknown) => scheduleStream(() => stream.planUpdate(payload)),
        onApprovalEvent: (payload: unknown) => scheduleStream(() => stream.approvalEvent(payload)),
        onCommandOutput: (payload: unknown) => scheduleStream(() => stream.commandOutput(payload)),
        onPatchSummary: (payload: unknown) => scheduleStream(() => stream.patchSummary(payload)),
        onCompactionStart: () => scheduleStream(() => stream.itemEvent({ kind: "compaction", phase: "start", title: "Compacting context" })),
        onCompactionEnd: () => scheduleStream(() => stream.itemEvent({ kind: "compaction", phase: "complete", title: "Compacted context" })),
      },
      record: {
        createIfMissing: true,
        onRecordError: (error: unknown) => {
          params.localEvents.emit({ event: "session.record.failed", payload: { agentId: params.agentId, error: errorText(error), runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
        },
        updateLastRoute: {
          sessionKey: params.sessionKey,
          channel: "beeper",
          to: roomId,
          accountId: "beeper",
        },
      },
      messageId: eventId,
    });
    await stream.finish();
    params.localEvents.emit({ event: "stream.finished", payload: { agentId: params.agentId, roomId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
    params.localEvents.emit({ event: "run.completed", payload: { agentId: params.agentId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  } catch (error) {
    await stream.fail(error);
    params.localEvents.emit({ event: "run.failed", payload: { agentId: params.agentId, error: errorText(error), runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  } finally {
    unsubscribeAgentEvents?.();
  }
}

function forwardAgentRuntimeStreamEvents(params: {
  enqueue: (operation: () => Promise<void>) => Promise<void>;
  runId: string;
  runtime: OpenClawHostRuntime;
  sessionKey: string;
  stream: ReturnType<typeof createBeeperReplyStreamEmitter>;
}): (() => void) | undefined {
  const onAgentEvent = typeof params.runtime.events === "object" ? params.runtime.events?.onAgentEvent : undefined;
  if (!onAgentEvent) {
    params.stream.debug("openclaw_beeper_agent_event_subscription_missing", {
      runId: params.runId,
      sessionKey: params.sessionKey,
    });
    return undefined;
  }
  params.stream.debug("openclaw_beeper_agent_event_subscription_started", {
    runId: params.runId,
    sessionKey: params.sessionKey,
  });
  return onAgentEvent((event) => {
    const data = recordValue(event.data) ?? {};
    const matched = matchesAgentStreamEvent({ data, event, runId: params.runId, sessionKey: params.sessionKey });
    const stream = normalizeAgentStream(event.stream) ?? stringValue(data.type);
    params.stream.debug("openclaw_beeper_agent_event_seen", {
      dataKeys: Object.keys(data).slice(0, 12),
      eventRunId: stringValue(event.runId) ?? stringValue(data.runId) ?? stringValue(data.run_id),
      eventSessionKey: stringValue(event.sessionKey) ?? stringValue(data.sessionKey) ?? stringValue(data.session_key),
      matched,
      stream: event.stream,
      normalizedStream: stream,
    });
    if (!matched) return;
    const exposedReasoningText = exposedCodexReasoningText(stream, data);
    if (exposedReasoningText) {
      params.enqueue(() => params.stream.reasoningPayload({
        text: exposedReasoningText,
        isReasoningSnapshot: true,
      }));
      return;
    }
    switch (stream) {
      case "assistant":
        params.enqueue(() => params.stream.textPayload(data, "partial"));
        break;
      case "run.progress":
      case "tool.progress":
      case "tool_progress":
        params.enqueue(() => params.stream.activity({
          ...data,
          activityType: stream,
          text: toolProgressText(data),
        }));
        break;
      case "lifecycle":
      case "metadata":
      case "model":
      case "usage":
      case "context":
        params.enqueue(() => params.stream.lifecycleEvent(data));
        break;
      case "thinking":
      case "reasoning":
        params.enqueue(() => params.stream.reasoningPayload(data));
        break;
      case "tool":
        if (stringValue(data.phase) === "start") {
          params.enqueue(() => params.stream.toolStart(data));
        } else if (isToolInputDeltaPhase(stringValue(data.phase)) || stringValue(data.inputTextDelta) || stringValue(data.argsDelta) || stringValue(data.argumentsDelta)) {
          params.enqueue(() => params.stream.toolInputDelta(data));
        } else if (stringValue(data.phase) === "result" || isCompletePhase(stringValue(data.phase))) {
          params.enqueue(() => params.stream.toolResult(data));
        } else {
          params.enqueue(() => params.stream.itemEvent({
            ...data,
            kind: "tool",
            progressText: stringValue(data.partialResult) ?? stringValue(data.output) ?? stringValue(data.result),
          }));
        }
        break;
      case "item":
        params.enqueue(() => params.stream.itemEvent(data));
        break;
      case "plan":
        params.enqueue(() => params.stream.planUpdate(data));
        break;
      case "approval":
        params.enqueue(() => params.stream.approvalEvent(data));
        break;
      case "command_output":
      case "command-output":
        params.enqueue(() => params.stream.commandOutput(data));
        break;
      case "patch":
        params.enqueue(() => params.stream.patchSummary(data));
        break;
      case "state":
      case "snapshot":
        params.enqueue(() => params.stream.stateSnapshot(data));
        break;
      case "source":
      case "sources":
        params.enqueue(() => params.stream.customData("source", data));
        break;
      case "file":
      case "files":
      case "document":
      case "documents":
        params.enqueue(() => params.stream.customData(stream, data));
        break;
      case "data":
        params.enqueue(() => params.stream.customData("data", data));
        break;
      case "raw":
        params.enqueue(() => params.stream.raw(stream, data));
        break;
      default:
        break;
    }
  });
}

function matchesAgentStreamEvent(params: {
  data: Record<string, unknown>;
  event: OpenClawAgentRuntimeEvent;
  runId: string;
  sessionKey: string;
}): boolean {
  const eventRunId = stringValue(params.event.runId) ?? stringValue(params.data.runId) ?? stringValue(params.data.run_id);
  if (eventRunId) return eventRunId === params.runId;
  const eventSessionKey = stringValue(params.event.sessionKey) ?? stringValue(params.data.sessionKey) ?? stringValue(params.data.session_key);
  return eventSessionKey === params.sessionKey;
}

function normalizeAgentStream(stream: string | undefined): string | undefined {
  const prefix = "codex_app_server.";
  return stream?.startsWith(prefix) ? stream.slice(prefix.length) : stream;
}

function specificToolName(value: string | undefined): string | undefined {
  if (!value || value === "tool" || value === "item" || value === "tool_call" || value === "tool-call") return undefined;
  return value;
}

function toolCallIdFromPayload(data: Record<string, unknown>): string | undefined {
  const toolCall = toolCallRecordFromPayload(data);
  return stringValue(data.toolCallId)
    ?? stringValue(data.callId)
    ?? stringValue(data.id)
    ?? stringValue(toolCall?.toolCallId)
    ?? stringValue(toolCall?.callId)
    ?? stringValue(toolCall?.id);
}

function toolNameFromPayload(data: Record<string, unknown>): string | undefined {
  const toolCall = toolCallRecordFromPayload(data);
  const fn = recordValue(toolCall?.function) ?? recordValue(data.function);
  return stringValue(data.toolName)
    ?? stringValue(data.name)
    ?? stringValue(data.command)
    ?? stringValue(toolCall?.toolName)
    ?? stringValue(toolCall?.name)
    ?? stringValue(fn?.name);
}

function toolTitleFromPayload(data: Record<string, unknown>, fallback?: string): string | undefined {
  const meta = recordValue(data.meta) ?? recordValue(data.metadata);
  return stringValue(data.title)
    ?? stringValue(data.label)
    ?? commandFromPayload(data)
    ?? stringValue(meta?.title)
    ?? fallback;
}

function toolDescriptionFromPayload(data: Record<string, unknown>): string | undefined {
  const meta = recordValue(data.meta) ?? recordValue(data.metadata);
  return stringValue(data.description)
    ?? stringValue(data.subtitle)
    ?? stringValue(meta?.description)
    ?? stringValue(meta?.subtitle);
}

function toolMetadataFromPayload(data: Record<string, unknown>, title?: string, description?: string): Record<string, unknown> | undefined {
  const base = recordValue(data.metadata) ?? recordValue(data.meta);
  const providerDisplayName = stringValue(data.providerName) ?? stringValue(recordValue(data.provider)?.displayName);
  const providerIconUrl = stringValue(data.providerIconUrl) ?? stringValue(recordValue(data.provider)?.iconUrl);
  const provider = providerDisplayName || providerIconUrl
    ? stripUndefined({ displayName: providerDisplayName, iconUrl: providerIconUrl })
    : undefined;
  const display = stripUndefined({
    displayName: title,
    description,
    iconUrl: stringValue(data.iconUrl),
    provider,
  });
  const hasDisplay = Object.keys(display).length > 0;
  if (!base && !hasDisplay) return undefined;
  return stripUndefined({
    ...(base ?? {}),
    ...display,
    provider: provider ?? recordValue(base?.provider),
  });
}

function toolInputFromPayload(data: Record<string, unknown>): unknown {
  const toolCall = toolCallRecordFromPayload(data);
  const fn = recordValue(toolCall?.function) ?? recordValue(data.function);
  const value = data.args
    ?? data.input
    ?? data.arguments
    ?? data.parameters
    ?? toolCall?.args
    ?? toolCall?.input
    ?? toolCall?.arguments
    ?? fn?.arguments;
  return typeof value === "string" ? parseMaybeJSONValue(value) : value;
}

function toolOutputFromPayload(data: Record<string, unknown>, fallback?: unknown, toolName?: string): unknown {
  void toolName;
  const toolResult = recordValue(data.toolResult) ?? recordValue(data.tool_result);
  const value = data.output
    ?? data.result
    ?? data.response
    ?? data.content
    ?? data.text
    ?? data.partialResult
    ?? toolResult?.output
    ?? toolResult?.result
    ?? toolResult?.response
    ?? toolResult?.content
    ?? toolResult?.text
    ?? fallback;
  return isStatusOnlyToolOutput(value) ? undefined : value;
}

function isCommandToolName(toolName: string | undefined): boolean {
  const normalized = toolName?.toLowerCase();
  return normalized === "bash" || normalized === "exec" || normalized === "shell" || normalized === "command";
}

function commandPartFields(data: Record<string, unknown>): Record<string, unknown> {
  const result = recordValue(data.result);
  const output = recordValue(data.output);
  const response = recordValue(data.response);
  const input = recordValue(data.input) ?? recordValue(data.args) ?? recordValue(data.arguments);
  const details = recordValue(data.details) ?? recordValue(result?.details) ?? recordValue(output?.details) ?? recordValue(response?.details);
  return stripUndefined({
    aggregated: stringValue(data.aggregated) ?? stringValue(result?.aggregated) ?? stringValue(output?.aggregated),
    command: commandFromPayload(data),
    cwd: stringValue(data.cwd) ?? stringValue(input?.cwd) ?? stringValue(result?.cwd) ?? stringValue(output?.cwd),
    details: data.details ?? result?.details ?? output?.details ?? response?.details,
    exitCode: numberValue(data.exitCode) ?? numberValue(data.exit_code) ?? numberValue(details?.exitCode) ?? numberValue(details?.exit_code) ?? numberValue(result?.exitCode) ?? numberValue(result?.exit_code) ?? numberValue(output?.exitCode) ?? numberValue(output?.exit_code),
    response: data.response,
    result: data.result,
    status: stringValue(data.status) ?? stringValue(details?.status),
    stderr: stringValue(data.stderr) ?? stringValue(result?.stderr) ?? stringValue(output?.stderr),
    stdout: stringValue(data.stdout) ?? stringValue(result?.stdout) ?? stringValue(output?.stdout),
  });
}

function commandFromPayload(data: Record<string, unknown>): string | undefined {
  const input = recordValue(data.input) ?? recordValue(data.args) ?? recordValue(data.arguments);
  const toolCall = toolCallRecordFromPayload(data);
  const toolInput = recordValue(toolCall?.input) ?? recordValue(toolCall?.args) ?? recordValue(toolCall?.arguments);
  const details = recordValue(data.details) ?? recordValue(recordValue(data.result)?.details) ?? recordValue(recordValue(data.output)?.details);
  return stringValue(data.command)
    ?? stringValue(data.cmd)
    ?? stringValue(input?.command)
    ?? stringValue(input?.cmd)
    ?? stringValue(toolInput?.command)
    ?? stringValue(toolInput?.cmd)
    ?? stringValue(details?.command);
}

function isStatusOnlyToolOutput(value: unknown): boolean {
  const record = recordValue(value);
  if (!record) return false;
  const keys = Object.keys(record);
  return keys.length > 0 && keys.every((key) =>
    key === "action" ||
    key === "finalUrl" ||
    key === "final_url" ||
    key === "phase" ||
    key === "queries" ||
    key === "query" ||
    key === "queryUnavailable" ||
    key === "state" ||
    key === "status" ||
    key === "url"
  );
}

function toolProgressText(data: Record<string, unknown>): string | undefined {
  return stringValue(data.text)
    ?? stringValue(data.progressText)
    ?? stringValue(data.progressSummary)
    ?? stringValue(data.message)
    ?? stringValue(data.summary)
    ?? stringValue(data.status)
    ?? stringValue(data.phase)
    ?? stringValue(data.name);
}

function toolItemOutput(data: Record<string, unknown>): unknown {
  return data.progressText ?? data.summary ?? data.output ?? data.result ?? data.partialResult ?? data.error;
}

function toolCallRecordFromPayload(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const direct = recordValue(data.toolCall) ?? recordValue(data.tool_call) ?? recordValue(data.call);
  if (direct) return direct;
  const content = arrayValue(data.content);
  if (!content) return undefined;
  for (const part of content) {
    const record = recordValue(part);
    const type = stringValue(record?.type);
    if (record && (!type || type === "toolCall" || type === "tool_call" || type === "function_call")) return record;
  }
  return undefined;
}

function parseMaybeJSONValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return value;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function isToolInputDeltaPhase(value: string | undefined): boolean {
  return value === "delta" || value === "input_delta" || value === "args_delta" || value === "arguments_delta" || value === "toolcall_delta";
}

function beeperCustomEvents(name: string, payload: unknown): AGUIEvent[] {
  const normalized = name === "sources" ? "source"
    : name === "documents" ? "document"
      : name === "files" ? "file"
        : name;
  if (normalized === "source") {
    const events = sourceEventsFromPayload(payload, "source");
    return events.length > 0 ? events : mapOpenClawCustom(name, payload);
  }
  if (normalized === "document") {
    const events = documentEventsFromPayload(payload);
    return events.length > 0 ? events : mapOpenClawCustom(name, payload);
  }
  if (normalized === "file") {
    const events = fileEventsFromPayload(payload);
    return events.length > 0 ? events : mapOpenClawCustom(name, payload);
  }
  if (normalized === "data") {
    const record = recordValue(payload);
    return mapOpenClawCustom("com.beeper.data", record && stringValue(record.name) ? payload : { name: "openclaw.data", value: payload });
  }
  return mapOpenClawCustom(name, payload);
}

function toolArtifactEvents(toolName: string | undefined, output: unknown): AGUIEvent[] {
  const name = toolName?.toLowerCase();
  if (!name) return [];
  const value = typeof output === "string" ? parseMaybeJSONValue(output) : output;
  if (name === "web_search" || name === "search" || name.includes("web_search")) {
    return sourceEventsFromPayload(value, "web_search");
  }
  if (name === "fetch" || name === "web_fetch" || name.includes("fetch")) {
    return [
      ...sourceEventsFromPayload(value, "fetch"),
      ...documentEventsFromPayload(value),
    ];
  }
  return [];
}

function sourceEventsFromPayload(payload: unknown, appearanceKind: string): AGUIEvent[] {
  const records = artifactRecords(payload, ["items", "results", "sources", "urls"]);
  return records.flatMap((record) => {
    const source = sourcePayload(record, appearanceKind);
    return source ? mapOpenClawCustom("com.beeper.source", source) : [];
  });
}

function documentEventsFromPayload(payload: unknown): AGUIEvent[] {
  const records = artifactRecords(payload, ["documents", "docs", "items", "results"]);
  return records.flatMap((record) => {
    const document = documentPayload(record);
    return document ? mapOpenClawCustom("com.beeper.document", document) : [];
  });
}

function answerURLSourceEvents(text: string, emitted: Set<string>): AGUIEvent[] {
  const matches = text.matchAll(/\bhttps?:\/\/[^\s<>)\]}"]+/giu);
  const events: AGUIEvent[] = [];
  for (const match of matches) {
    const url = trimURLPunctuation(match[0]);
    if (!url || emitted.has(url)) continue;
    emitted.add(url);
    events.push(...mapOpenClawCustom("com.beeper.source", stripUndefined({
      appearances: [{ kind: "answer" }],
      sourceId: url,
      title: hostnameTitle(url),
      url,
    })));
  }
  return events;
}

function trimURLPunctuation(url: string): string {
  return url.replace(/[.,;:!?]+$/u, "");
}

function hostnameTitle(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

function fileEventsFromPayload(payload: unknown): AGUIEvent[] {
  const records = artifactRecords(payload, ["files", "items", "results"]);
  return records.flatMap((record) => {
    const url = stringValue(record.url) ?? stringValue(record.mxc) ?? stringValue(record.uri);
    const title = stringValue(record.title) ?? stringValue(record.name) ?? stringValue(record.filename);
    if (!url && !title) return [];
    return mapOpenClawCustom("com.beeper.file", stripUndefined({
      id: stringValue(record.id),
      mediaType: stringValue(record.mediaType) ?? stringValue(record.mimeType),
      title,
      url,
    }));
  });
}

function artifactRecords(payload: unknown, arrayKeys: string[]): Record<string, unknown>[] {
  const directArray = arrayValue(payload);
  if (directArray) return directArray.flatMap((item) => recordValue(item) ? [recordValue(item)!] : []);
  const record = recordValue(payload);
  if (!record) return [];
  for (const key of arrayKeys) {
    const values = arrayValue(record[key]);
    if (values) return values.flatMap((item) => recordValue(item) ? [recordValue(item)!] : []);
  }
  return [record];
}

function sourcePayload(record: Record<string, unknown>, appearanceKind: string): Record<string, unknown> | undefined {
  const url = stringValue(record.url) ?? stringValue(record.finalUrl) ?? stringValue(record.final_url);
  const title = stringValue(record.title) ?? stringValue(record.name);
  const sourceId = stringValue(record.sourceId) ?? stringValue(record.id) ?? url ?? title;
  if (!sourceId && !url && !title) return undefined;
  return stripUndefined({
    appearances: arrayValue(record.appearances) ?? [{ kind: appearanceKind }],
    author: stringValue(record.author),
    description: stringValue(record.description) ?? stringValue(record.summary) ?? stringValue(record.text),
    faviconUrl: stringValue(record.faviconUrl) ?? stringValue(record.favicon_url),
    finalUrl: stringValue(record.finalUrl) ?? stringValue(record.final_url),
    highlights: arrayValue(record.highlights),
    imageUrl: stringValue(record.imageUrl) ?? stringValue(record.image_url),
    metadata: recordValue(record.metadata),
    publishedAt: stringValue(record.publishedAt) ?? stringValue(record.published_at),
    siteName: stringValue(record.siteName) ?? stringValue(record.site_name),
    sourceId,
    title,
    url,
  });
}

function documentPayload(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const text = stringValue(record.markdown) ?? stringValue(record.text) ?? stringValue(record.content);
  const url = stringValue(record.url) ?? stringValue(record.finalUrl) ?? stringValue(record.final_url);
  const title = stringValue(record.title) ?? stringValue(record.name);
  const id = stringValue(record.id) ?? stringValue(record.requestId) ?? stringValue(record.request_id) ?? url ?? title;
  if (!id || !text) return undefined;
  return stripUndefined({
    id,
    markdown: stringValue(record.markdown),
    mediaType: stringValue(record.mediaType) ?? stringValue(record.mimeType) ?? "text/markdown",
    metadata: recordValue(record.metadata),
    sourceId: stringValue(record.sourceId) ?? id,
    text: stringValue(record.text) ?? text,
    title,
    url,
  });
}

function usageFromPayload(data: Record<string, unknown>): Record<string, number> | undefined {
  const usage = recordValue(data.usage) ?? data;
  const promptTokens = intValue(usage.promptTokens) ?? intValue(usage.prompt_tokens) ?? intValue(usage.inputTokens) ?? intValue(usage.input);
  const completionTokens = intValue(usage.completionTokens) ?? intValue(usage.completion_tokens) ?? intValue(usage.outputTokens) ?? intValue(usage.output);
  const reasoningTokens = intValue(usage.reasoningTokens) ?? intValue(usage.reasoning_tokens);
  const totalTokens = intValue(usage.totalTokens) ?? intValue(usage.total_tokens) ?? intValue(usage.total);
  const contextLimit = intValue(usage.contextLimit) ?? intValue(usage.context_limit) ?? intValue(data.contextTokenBudget);
  const out = stripUndefined({ promptTokens, completionTokens, reasoningTokens, totalTokens, contextLimit });
  return Object.keys(out).length > 0 ? out : undefined;
}

function lifecycleModelMetadata(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const model = stripUndefined({
    model: stringValue(data.model) ?? stringValue(data.modelId) ?? stringValue(data.selectedModel),
    provider: stringValue(data.provider),
    reasoning: data.reasoning ?? data.reasoningLevel,
    requestId: stringValue(data.requestId) ?? stringValue(data.request_id),
    serviceTier: stringValue(data.serviceTier) ?? stringValue(data.service_tier),
    systemFingerprint: stringValue(data.systemFingerprint) ?? stringValue(data.system_fingerprint),
  });
  return Object.keys(model).length > 0 ? model : undefined;
}

function lifecycleContextMetadata(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const context = stripUndefined({
    contextTokenBudget: intValue(data.contextTokenBudget),
    contextWindowReferenceTokens: intValue(data.contextWindowReferenceTokens),
    contextWindowSource: stringValue(data.contextWindowSource),
    promptTokens: intValue(data.promptTokens) ?? intValue(data.prompt_tokens),
    sessionId: stringValue(data.sessionId),
    sessionKey: stringValue(data.sessionKey),
  });
  return Object.keys(context).length > 0 ? context : undefined;
}

function isToolItemType(value: string | undefined): boolean {
  return value === "toolCall"
    || value === "tool_call"
    || value === "tool-call"
    || value === "toolUse"
    || value === "tool_use"
    || value === "tool-use"
    || value === "toolResult"
    || value === "tool_result"
    || value === "tool-result"
    || value === "command"
    || value === "patch";
}

function isCompletePhase(value: string | undefined): boolean {
  return value === "complete" || value === "completed" || value === "end" || value === "ended" || value === "finish" || value === "finished" || value === "done";
}

function createBeeperReplyStreamEmitter(base: {
  agentId: string;
  hostRuntime?: OpenClawHostRuntime;
  localEvents: LocalEventBus;
  roomId: string;
  runId: string;
  sessionId: string;
  sessionKey: string;
  threadRoot?: string;
}) {
  const channelRuntime = getBeeperChannelRuntimeForHost(base.hostRuntime);
  if (!channelRuntime) {
    throw new Error("OpenClaw Beeper requires the Beeper channel runtime for native rich streaming");
  }
  const publisher = channelRuntime.createStreamPublisher({
    agentId: base.agentId,
    roomId: base.roomId,
    runId: base.runId,
    sessionKey: base.sessionKey,
    ...(base.threadRoot ? { threadRoot: base.threadRoot } : {}),
  });
  const approvalState = createApprovalRunState();
  let hasPublished = false;
  let finalized = false;
  let lastVisibleText = "";
  let lastReasoningText = "";
  let startPromise: Promise<void> | undefined;
  const externalTasks = new Set<Promise<void>>();
  const toolInputs = new Map<string, unknown>();
  const toolNames = new Map<string, string>();
  const pendingToolCalls = new Set<string>();
  const pendingToolWaiters = new Set<() => void>();
  const startedToolCalls = new Set<string>();
  const emittedSourceUrls = new Set<string>();
  let latestUsage: unknown;
  const emit = (event: string, payload: Record<string, unknown>) => {
    base.localEvents.emit({
      event,
      payload: stripUndefined({
        agentId: base.agentId,
        runId: base.runId,
        sessionId: base.sessionId,
        sessionKey: base.sessionKey,
        ...payload,
      }),
    });
  };
  const ensureStarted = async () => {
    if (hasPublished || finalized) return;
    if (!startPromise) {
      startPromise = (async () => {
        channelRuntime.debug("openclaw_beeper_stream_starting", {
          agentId: base.agentId,
          roomId: base.roomId,
          runId: base.runId,
          sessionId: base.sessionId,
          sessionKey: base.sessionKey,
        });
        await publisher.start();
        hasPublished = true;
        channelRuntime.debug("openclaw_beeper_stream_started", {
          agentId: base.agentId,
          eventId: publisher.targetEventId,
          roomId: base.roomId,
          runId: base.runId,
          sessionId: base.sessionId,
          sessionKey: base.sessionKey,
        });
      })().catch((error) => {
        startPromise = undefined;
        throw error;
      });
    }
    await startPromise;
  };
  const markPublished = () => {
    if (hasPublished) return;
    hasPublished = true;
    channelRuntime.debug("openclaw_beeper_stream_started", {
      agentId: base.agentId,
      eventId: publisher.targetEventId,
      roomId: base.roomId,
      runId: base.runId,
      sessionId: base.sessionId,
      sessionKey: base.sessionKey,
    });
  };
  const publish = async (parts: Iterable<AGUIEvent>) => {
    if (finalized) return;
    const list = [...parts];
    if (list.length === 0) return;
    channelRuntime.debug("openclaw_beeper_stream_publish", {
      count: list.length,
      firstType: stringValue(list[0]?.type),
      roomId: base.roomId,
      runId: base.runId,
    });
    await publisher.publishMany(list);
    markPublished();
    channelRuntime.recordOutboundActivity();
  };
  const publishPart = async (part: Parameters<typeof publisher.publishPart>[0]) => {
    if (finalized) return;
    channelRuntime.debug("openclaw_beeper_stream_publish_part", {
      kind: part.kind,
      roomId: base.roomId,
      runId: base.runId,
    });
    await publisher.publishPart(part);
    markPublished();
    channelRuntime.recordOutboundActivity();
  };
  const publishParts = async (parts: Array<Parameters<typeof publisher.publishPart>[0]>) => {
    if (parts.length === 0 || finalized) return;
    await publisher.publishParts(parts);
    markPublished();
    channelRuntime.recordOutboundActivity();
  };
  const publishCustomEvents = async (events: AGUIEvent[]) => {
    const customParts: Array<Parameters<typeof publisher.publishPart>[0]> = [];
    const rawEvents: AGUIEvent[] = [];
    for (const event of events) {
      if (event.type === "CUSTOM") {
        customParts.push(stripUndefined({
          kind: "custom",
          name: stringValue(event.name) ?? "openclaw.data",
          value: event.value,
        }));
      } else {
        rawEvents.push(event);
      }
    }
    await publishParts(customParts);
    if (rawEvents.length > 0) await publish(rawEvents);
  };
  const trackExternal = (promise: Promise<void>) => {
    let tracked: Promise<void>;
    tracked = promise.catch((error) => {
      channelRuntime.debug("openclaw_beeper_external_stream_event_failed", {
        error: errorText(error),
        roomId: base.roomId,
        runId: base.runId,
      });
    }).finally(() => {
      externalTasks.delete(tracked);
    });
    externalTasks.add(tracked);
  };
  const drainExternal = async () => {
    while (externalTasks.size > 0) {
      await Promise.all([...externalTasks]);
    }
  };
  const textPayload = async (payload: unknown, source: "partial" | "block" | "final" = "partial") => {
    const text = replyPayloadText(payload);
    channelRuntime.debug("openclaw_beeper_text_payload_received", {
      hasDelta: stringValue(recordValue(payload)?.delta) !== undefined,
      source,
      textLength: text?.length ?? 0,
    });
    if (!text) return;
    const sourceEvents = source === "final" ? answerURLSourceEvents(text, emittedSourceUrls) : [];
    if (isWorkingPlaceholder(text)) {
      channelRuntime.debug("openclaw_beeper_text_payload_suppressed", {
        reason: "working_placeholder",
        source,
        textLength: text.length,
      });
      if (source !== "final") {
        await ensureStarted();
      }
      return;
    }
    const explicitDelta = stringValue(recordValue(payload)?.delta);
    const delta = explicitDelta ?? visibleTextDelta(lastVisibleText, text);
    lastVisibleText = nextVisibleText(lastVisibleText, text, delta);
    if (!delta && sourceEvents.length === 0) {
      channelRuntime.debug("openclaw_beeper_text_payload_suppressed", {
        reason: "empty_delta",
        source,
        textLength: text.length,
      });
      return;
    }
    channelRuntime.debug("openclaw_beeper_text_payload_delta", {
      deltaLength: delta.length,
      source,
      textLength: text.length,
    });
    emit("assistant.delta", { delta, source, text });
    if (delta) await publishPart({ kind: "text", text: delta });
    if (sourceEvents.length > 0) await publishCustomEvents(sourceEvents);
  };
  const reasoningPayload = async (payload: unknown) => {
    const text = reasoningPayloadText(payload);
    if (!text) return;
    const payloadRecord = recordValue(payload);
    const explicitDelta = reasoningDeltaText(payloadRecord);
    const isSnapshot = booleanValue(payloadRecord?.isReasoningSnapshot) === true;
    const delta = explicitDelta && !isSnapshot
      ? explicitDelta
      : (text.startsWith(lastReasoningText) ? text.slice(lastReasoningText.length) : text);
    lastReasoningText = explicitDelta && !isSnapshot
      ? `${lastReasoningText}${explicitDelta}`
      : text;
    if (!delta) return;
    emit("thinking.delta", { delta, text });
    await publishPart({ kind: "reasoning", text: delta });
  };
  const toolIdFor = (payload: Record<string, unknown>, fallback: string) =>
    toolCallIdFromPayload(payload) ?? stringValue(payload.itemId) ?? stringValue(payload.approvalId) ?? fallback;
  const fallbackToolIdForName = (name: string | undefined, fallback: string) => `tool:${name || fallback}`;
  const rememberTool = (toolCallId: string, toolName: string | undefined, input?: unknown) => {
    if (toolName) toolNames.set(toolCallId, toolName);
    if (input !== undefined) toolInputs.set(toolCallId, input);
  };
  const rememberedToolName = (toolCallId: string, fallback?: string) => toolNames.get(toolCallId) ?? fallback;
  const markToolPending = (toolCallId: string | undefined) => {
    if (toolCallId) pendingToolCalls.add(toolCallId);
  };
  const markToolComplete = (toolCallId: string | undefined) => {
    if (!toolCallId) return;
    pendingToolCalls.delete(toolCallId);
    if (pendingToolCalls.size === 0) {
      for (const resolve of pendingToolWaiters) resolve();
      pendingToolWaiters.clear();
    }
  };
  const waitForPendingTools = async (timeoutMs = 1200) => {
    if (pendingToolCalls.size === 0) return;
    channelRuntime.debug("openclaw_beeper_stream_waiting_for_tools", {
      pendingToolCalls: [...pendingToolCalls],
      roomId: base.roomId,
      runId: base.runId,
      timeoutMs,
    });
    await Promise.race([
      new Promise<void>((resolve) => {
        pendingToolWaiters.add(resolve);
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    if (pendingToolCalls.size > 0) {
      channelRuntime.debug("openclaw_beeper_stream_tools_still_pending", {
        pendingToolCalls: [...pendingToolCalls],
        roomId: base.roomId,
        runId: base.runId,
      });
    }
  };
  const completePendingToolsForFinal = async () => {
    if (pendingToolCalls.size === 0) return;
    const toolCallIds = [...pendingToolCalls];
    channelRuntime.debug("openclaw_beeper_stream_completing_pending_tools", {
      pendingToolCalls: toolCallIds,
      roomId: base.roomId,
      runId: base.runId,
    });
    for (const toolCallId of toolCallIds) {
      const toolName = rememberedToolName(toolCallId, "tool") ?? "tool";
      await publishPart({
        kind: "tool_result",
        state: "complete",
        toolCallId,
        toolName,
      });
      markToolComplete(toolCallId);
    }
  };
  return {
    start: ensureStarted,
    trackExternal,
    assistantMessageStart: () => {
      lastVisibleText = "";
      emit("assistant.message.start", {});
    },
    reasoningEnd: async () => {
      emit("thinking.end", {});
      await publishPart({ kind: "reasoning_end" });
    },
    reasoningPayload,
    textPayload,
    activity: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const text = stringValue(data.text)
        ?? stringValue(data.progressText)
        ?? stringValue(data.progressSummary)
        ?? stringValue(data.message)
        ?? stringValue(data.status)
        ?? stringValue(data.phase)
        ?? stringValue(data.title);
      if (!text) return;
      const activityType = stringValue(data.activityType) ?? stringValue(data.type) ?? "activity";
      if (isWorkingPlaceholder(text)) {
        channelRuntime.debug("openclaw_beeper_activity_suppressed", {
          activityType,
          reason: "working_placeholder",
          roomId: base.roomId,
          runId: base.runId,
        });
        await ensureStarted();
        return;
      }
      emit("activity.updated", { activityType, text });
      await publishPart({
        kind: "activity",
        activityType,
        content: stripUndefined({
          label: stringValue(data.label) ?? stringValue(data.title) ?? stringValue(data.name),
          phase: stringValue(data.phase),
          state: stringValue(data.state) ?? stringValue(data.status) ?? "running",
          text,
        }),
        replace: true,
      });
    },
    toolStart: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const toolName = toolNameFromPayload(data);
      const toolCallId = toolIdFor(data, fallbackToolIdForName(toolName, "tool"));
      const input = toolInputFromPayload(data);
      const title = toolTitleFromPayload(data);
      const description = toolDescriptionFromPayload(data);
      const metadata = toolMetadataFromPayload(data, title, description);
      rememberTool(toolCallId, toolName, input);
      emit("tool.call.started", {
        input,
        phase: stringValue(data.phase),
        toolCallId,
        toolName,
      });
      if (recordValue(data.approval)) {
        if (startedToolCalls.has(toolCallId)) return;
        startedToolCalls.add(toolCallId);
        markToolPending(toolCallId);
        await publishPart(stripUndefined({
          approval: recordValue(data.approval),
          description,
          dynamic: booleanValue(data.dynamic),
          index: numberValue(data.index),
          input,
          kind: "tool_start",
          metadata,
          providerExecuted: booleanValue(data.providerExecuted),
          startedAtMs: numberValue(data.startedAt) ?? numberValue(data.startedAtMs),
          title,
          toolCallId,
          toolName,
        }));
        return;
      }
      markToolPending(toolCallId);
      await publishPart(stripUndefined({
        kind: "tool_start",
        description,
        dynamic: booleanValue(data.dynamic),
        index: numberValue(data.index),
        input,
        metadata,
        providerExecuted: booleanValue(data.providerExecuted),
        startedAtMs: numberValue(data.startedAt) ?? numberValue(data.startedAtMs),
        title,
        toolCallId,
        toolName,
      }));
    },
    toolInputDelta: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const rawToolName = toolNameFromPayload(data);
      const toolCallId = toolIdFor(data, fallbackToolIdForName(rawToolName, "tool_delta"));
      const toolName = rememberedToolName(toolCallId, rawToolName);
      const input = toolInputFromPayload(data);
      const inputTextDelta = stringValue(data.inputTextDelta) ?? stringValue(data.argsDelta) ?? stringValue(data.argumentsDelta) ?? stringValue(data.delta);
      const title = toolTitleFromPayload(data);
      const description = toolDescriptionFromPayload(data);
      const metadata = toolMetadataFromPayload(data, title, description);
      rememberTool(toolCallId, toolName, input);
      markToolPending(toolCallId);
      emit("tool.call.input.delta", {
        inputTextDelta,
        toolCallId,
        toolName,
      });
      await publishPart(stripUndefined({
        description,
        delta: inputTextDelta,
        input,
        kind: "tool_input",
        metadata,
        providerExecuted: booleanValue(data.providerExecuted),
        startedAtMs: numberValue(data.startedAt) ?? numberValue(data.startedAtMs),
        title,
        toolCallId,
        toolName,
      }));
    },
    toolResult: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const toolCallId = toolIdFor(data, "tool_result");
      const toolName = rememberedToolName(toolCallId, toolNameFromPayload(data));
      const input = data.input ?? toolInputs.get(toolCallId);
      const title = toolTitleFromPayload(data);
      const description = toolDescriptionFromPayload(data);
      const metadata = toolMetadataFromPayload(data, title, description);
      const commandTool = isCommandToolName(toolName);
      const error = data.error ?? (booleanValue(data.isError) ? toolOutputFromPayload(data, payload, toolName) : undefined);
      const output = commandTool ? firstNonUndefined(data.output, data.result, data.response, data.value) : toolOutputFromPayload(data, payload, toolName);
      markToolComplete(toolCallId);
      emit("tool.call.completed", {
        output,
        toolCallId,
        toolName,
      });
      if (output !== undefined || error !== undefined) {
        await publishPart(stripUndefined({
          completedAtMs: numberValue(data.completedAt) ?? numberValue(data.completedAtMs),
          description,
          error,
          input,
          kind: "tool_result",
          metadata,
          output: error === undefined ? output : undefined,
          providerExecuted: booleanValue(data.providerExecuted),
          ...(commandTool ? commandPartFields(data) : {}),
          title,
          toolCallId,
          toolName,
        }));
      }
      await publishCustomEvents(toolArtifactEvents(toolName, output));
    },
    itemEvent: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const rawToolName = toolNameFromPayload(data);
      const itemType = stringValue(data.type);
      const kind = stringValue(data.kind);
      const hasToolIdentity = Boolean(rawToolName || toolCallIdFromPayload(data) || kind === "tool" || kind === "command" || kind === "patch");
      if (!hasToolIdentity && !isToolItemType(itemType)) return;
      const toolCallId = toolIdFor(data, stringValue(data.kind) ?? "item");
      const toolName = rememberedToolName(toolCallId, rawToolName ?? specificToolName(kind) ?? specificToolName(itemType) ?? "tool");
      const input = toolInputFromPayload(data);
      const inputTextDelta = stringValue(data.inputTextDelta) ?? stringValue(data.argsDelta) ?? stringValue(data.argumentsDelta) ?? (isToolInputDeltaPhase(stringValue(data.phase)) ? stringValue(data.delta) : undefined);
      const title = toolTitleFromPayload(data, stringValue(data.progressText) ?? stringValue(data.summary) ?? rawToolName ?? itemType ?? kind);
      const description = toolDescriptionFromPayload(data);
      const metadata = toolMetadataFromPayload(data, title, description);
      const commandTool = isCommandToolName(toolName);
      const output = commandTool ? firstNonUndefined(data.output, data.result, data.response, data.value, toolItemOutput(data)) : toolItemOutput(data);
      const phase = stringValue(data.phase);
      const status = stringValue(data.status);
      const preliminary = !isCompletePhase(phase) && !isCompletePhase(status);
      const error = data.error;
      rememberTool(toolCallId, toolName, input);
      if (preliminary) markToolPending(toolCallId);
      else markToolComplete(toolCallId);
      emit("tool.call.updated", {
        output,
        phase,
        preliminary,
        toolCallId,
        toolName,
      });
      const parts: Array<Parameters<typeof publisher.publishPart>[0]> = [];
      if (inputTextDelta) {
        parts.push(stripUndefined({
          description,
          delta: inputTextDelta,
          input,
          kind: "tool_input",
          metadata,
          providerExecuted: booleanValue(data.providerExecuted),
          startedAtMs: numberValue(data.startedAt) ?? numberValue(data.startedAtMs),
          title,
          toolCallId,
          toolName,
        }));
      }
      if (output !== undefined || error !== undefined || !inputTextDelta) {
        parts.push(stripUndefined({
          description,
          error,
          input: input ?? toolInputs.get(toolCallId),
          kind: "tool_result",
          metadata,
          output: error === undefined ? output : undefined,
          preliminary,
          completedAtMs: numberValue(data.completedAt) ?? numberValue(data.completedAtMs),
          providerExecuted: booleanValue(data.providerExecuted),
          ...(commandTool ? commandPartFields(data) : {}),
          title,
          toolCallId,
          toolName,
        }));
      }
      await publishParts(parts);
      if (!preliminary) await publishCustomEvents(toolArtifactEvents(toolName, output));
    },
    planUpdate: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const output = stringValue(data.explanation) ?? stringValue(data.title);
      if (!output) return;
      const phase = stringValue(data.phase);
      const preliminary = phase !== "complete" && phase !== "end";
      rememberTool("plan", "plan");
      if (preliminary) markToolPending("plan");
      else markToolComplete("plan");
      emit("tool.call.completed", {
        output,
        preliminary,
        toolCallId: "plan",
        toolName: "plan",
      });
      await publishPart({
        kind: "tool_result",
        output,
        preliminary,
        toolCallId: "plan",
        toolName: "plan",
      });
      const steps = arrayValue(data.steps)?.filter((step): step is string => typeof step === "string");
      if (steps?.length) {
        await publishPart({ delta: [{ op: "add", path: "/plan", value: steps }], kind: "state_delta" });
      }
    },
    stateSnapshot: async (payload: unknown) => {
      emit("state.snapshot", { snapshot: payload });
      await publishPart({ kind: "state_snapshot", value: payload });
    },
    customData: async (name: string, payload: unknown) => {
      emit(`${name}.event`, { value: payload });
      await publishCustomEvents(beeperCustomEvents(name, payload));
    },
    lifecycleEvent: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const phase = stringValue(data.phase);
      const usage = usageFromPayload(data);
      if (usage !== undefined) latestUsage = usage;
      const model = lifecycleModelMetadata(data);
      const context = lifecycleContextMetadata(data);
      if (phase) {
        emit("lifecycle.phase", { phase });
        if (!isCompletePhase(phase) && phase !== "failed" && phase !== "error") await ensureStarted();
      }
      const events = [
        ...(model ? mapOpenClawCustom("com.beeper.data", { name: "openclaw.model", value: model }) : []),
        ...(context ? mapOpenClawCustom("com.beeper.data", { name: "openclaw.context", value: context }) : []),
        ...(usage !== undefined ? mapOpenClawCustom("com.beeper.data", { name: "openclaw.usage", value: usage }) : []),
      ];
      if (events.length > 0) {
        emit("lifecycle.metadata", {
          context,
          model,
          phase,
          usage,
        });
        await publishCustomEvents(events);
      }
    },
    raw: async (source: string, payload: unknown) => {
      emit("raw.event", { source, value: payload });
      await publishPart({ kind: "raw", source, value: payload });
    },
    approvalEvent: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const phase = stringValue(data.phase);
      if (phase === "requested") {
        const approvalId = stringValue(data.approvalId) ?? stringValue(data.approvalSlug);
        const toolCallId = stringValue(data.toolCallId) ?? stringValue(data.itemId);
        const toolName = rememberedToolName(toolCallId ?? "", stringValue(data.kind) ?? stringValue(data.command));
        const message = stringValue(data.message) ?? stringValue(data.reason) ?? stringValue(data.title);
        if (toolCallId) rememberTool(toolCallId, toolName);
        emit("approval.requested", {
          approvalId,
          message,
          toolCallId,
          toolName,
        });
        await publish([mapOpenClawApprovalRequest(approvalState, stripUndefined({ approvalId, message, toolCallId, toolName }))]);
        return;
      }
      if (phase === "resolved" || phase === "complete" || stringValue(data.status)) {
        const approvalId = stringValue(data.approvalId) ?? stringValue(data.approvalSlug);
        const status = stringValue(data.status);
        const approved = status === "approved" || status === "allow" || status === "approve";
        if (!approvalId) return;
        const toolCallId = stringValue(data.toolCallId) ?? stringValue(data.itemId);
        emit("approval.resolved", {
          approvalId,
          approved,
          decision: status,
          toolCallId,
        });
        await publish([mapOpenClawApprovalResponse(stripUndefined({
          approvalId,
          approved,
          approvedAlways: booleanValue(data.always) ?? booleanValue(data.approvedAlways),
          toolCallId,
        }))]);
      }
    },
    debug: (event: string, payload: Record<string, unknown>) => {
      channelRuntime.debug(event, {
        roomId: base.roomId,
        runId: base.runId,
        sessionId: base.sessionId,
        sessionKey: base.sessionKey,
        ...payload,
      });
    },
    commandOutput: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const toolName = stringValue(data.name) ?? stringValue(data.title) ?? "command";
      const phase = stringValue(data.phase);
      const status = stringValue(data.status);
      const complete = isCompletePhase(phase) || isCompletePhase(status);
      const toolCallId = toolIdFor(data, fallbackToolIdForName(toolName, "command"));
      const input = toolInputFromPayload(data);
      const title = isCommandToolName(toolName) ? undefined : toolTitleFromPayload(data, toolName);
      const description = toolDescriptionFromPayload(data);
      const metadata = toolMetadataFromPayload(data, title, description);
      const output = isCommandToolName(toolName)
        ? firstNonUndefined(data.output, data.result, data.response, data.value, complete ? undefined : toolProgressText(data))
        : toolOutputFromPayload(data, complete ? undefined : toolProgressText(data), toolName);
      rememberTool(toolCallId, toolName, input);
      if (complete) markToolComplete(toolCallId);
      else markToolPending(toolCallId);
      emit("tool.call.completed", {
        output,
        preliminary: !complete,
        toolCallId,
        toolName,
      });
      if (output !== undefined || !complete) {
        await publishPart(stripUndefined({
          description,
          input: input ?? toolInputs.get(toolCallId),
          kind: "tool_result",
          metadata,
          output,
          preliminary: !complete,
          ...(isCommandToolName(toolName) ? commandPartFields(data) : {}),
          title,
          toolCallId,
          toolName,
        }));
      }
      if (complete) {
        await publishCustomEvents(toolArtifactEvents(toolName, output));
      }
    },
    patchSummary: async (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const toolCallId = toolIdFor(data, "patch");
      const toolName = rememberedToolName(toolCallId, stringValue(data.name) ?? "patch");
      const output = data.summary ?? data;
      const title = toolTitleFromPayload(data, "Patch");
      const description = toolDescriptionFromPayload(data);
      const metadata = toolMetadataFromPayload(data, title, description);
      rememberTool(toolCallId, toolName);
      emit("tool.call.completed", {
        output,
        toolCallId,
        toolName,
      });
      await publishPart(stripUndefined({
        description,
        input: toolInputs.get(toolCallId),
        kind: "tool_result",
        metadata,
        output,
        title,
        toolCallId,
        toolName,
      }));
      await publishCustomEvents(toolArtifactEvents(toolName, output));
    },
    finish: async (payload?: unknown) => {
      if (payload !== undefined) await textPayload(payload, "final");
      await drainExternal();
      await waitForPendingTools();
      await drainExternal();
      await completePendingToolsForFinal();
      if (!hasPublished || finalized) return;
      finalized = true;
      channelRuntime.debug("openclaw_beeper_stream_finalizing", {
        roomId: base.roomId,
        runId: base.runId,
      });
      await publisher.finalize({
        finishReason: "stop",
        ...(latestUsage !== undefined ? { usage: latestUsage } : {}),
      });
      channelRuntime.recordOutboundActivity();
      channelRuntime.clearActiveStream(base.sessionKey, publisher);
      channelRuntime.debug("openclaw_beeper_stream_finalized", {
        eventId: publisher.targetEventId,
        roomId: base.roomId,
        runId: base.runId,
      });
    },
    fail: async (error: unknown) => {
      if (finalized) return;
      await drainExternal();
      finalized = true;
      channelRuntime.debug("openclaw_beeper_stream_failing", {
        error: errorText(error),
        roomId: base.roomId,
        runId: base.runId,
      });
      await publisher.finalize({
        terminalPart: {
          error: { message: errorText(error) },
          message: errorText(error),
          runId: base.runId,
          threadId: base.runId,
          type: AGUIEventType.RUN_ERROR,
        },
      });
      channelRuntime.recordOutboundActivity();
      channelRuntime.clearActiveStream(base.sessionKey, publisher);
    },
  };
}

function replyPayloadText(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const record = recordValue(payload);
  if (!record) return undefined;
  const direct =
    stringValue(record.text) ??
    stringValue(record.body) ??
    stringValue(record.content) ??
    stringValue(record.textDelta) ??
    stringValue(record.text_delta) ??
    stringValue(record.delta);
  if (direct) return direct;
  const parts = arrayValue(record.parts) ?? arrayValue(record.content);
  if (!parts) return undefined;
  const chunks: string[] = [];
  for (const part of parts) {
    const partRecord = recordValue(part);
    if (partRecord && !isVisibleTextPart(stringValue(partRecord.type))) continue;
    const text = stringValue(partRecord?.text) ?? stringValue(partRecord?.content);
    if (text) chunks.push(text);
  }
  return chunks.length > 0 ? chunks.join("") : undefined;
}

function reasoningPayloadText(payload: unknown): string | undefined {
  if (typeof payload === "string") return payload;
  const record = recordValue(payload);
  if (!record) return undefined;
  return stringValue(record.text)
    ?? stringValue(record.body)
    ?? stringValue(record.reasoningText)
    ?? stringValue(record.reasoning_text)
    ?? stringValue(record.thinking)
    ?? stringValue(record.reasoning)
    ?? stringValue(record.summaryText)
    ?? stringValue(record.summary_text)
    ?? reasoningDeltaText(record)
    ?? reasoningTextFromRecord(recordValue(record.item) ?? record, true);
}

function reasoningDeltaText(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) return undefined;
  return stringValue(record.delta)
    ?? stringValue(record.reasoningDelta)
    ?? stringValue(record.reasoning_delta)
    ?? stringValue(record.thinkingDelta)
    ?? stringValue(record.thinking_delta)
    ?? stringValue(record.summaryTextDelta)
    ?? stringValue(record.summary_text_delta);
}

function exposedCodexReasoningText(stream: string | undefined, data: Record<string, unknown>): string | undefined {
  const method = stringValue(data.method);
  const item = recordValue(data.item) ?? recordValue(recordValue(data.params)?.item);
  if (
    stream === "raw" ||
    stream === "item" ||
    method === "rawResponseItem/completed" ||
    method === "item/completed"
  ) {
    return reasoningTextFromRecord(item ?? data, false);
  }
  if (stream === "reasoning") {
    return reasoningTextFromRecord(item ?? data, true);
  }
  return undefined;
}

function reasoningTextFromRecord(record: Record<string, unknown> | undefined, allowUntyped: boolean): string | undefined {
  if (!record) return undefined;
  if (stringValue(record.type) !== "reasoning" && !allowUntyped) {
    return undefined;
  }
  if (!record.summary && !record.content) {
    return undefined;
  }
  const chunks = [
    ...reasoningTextEntries(record.summary),
    ...reasoningTextEntries(record.content),
  ].filter((text) => text.trim().length > 0);
  return chunks.length > 0 ? chunks.join("\n\n") : undefined;
}

function reasoningTextEntries(value: unknown): string[] {
  if (typeof value === "string") return [value];
  const entries = arrayValue(value);
  if (!entries) return [];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const record = recordValue(entry);
    if (!record) return [];
    const type = stringValue(record.type);
    if (type && type !== "summary_text" && type !== "reasoning_text" && type !== "text") {
      return [];
    }
    const text = stringValue(record.text) ?? stringValue(record.content);
    return text ? [text] : [];
  });
}

function isVisibleTextPart(type: string | undefined): boolean {
  if (!type) return true;
  return type === "text" || type === "output_text" || type === "assistant_text" || type === "markdown";
}

function isWorkingPlaceholder(text: string): boolean {
  return /^working(?:\.{3}|\u2026)?$/iu.test(text.trim());
}

function visibleTextDelta(previous: string, next: string): string {
  if (!next || next === previous) return "";
  if (!previous) return next;
  if (next.startsWith(previous)) return next.slice(previous.length);
  return next;
}

function nextVisibleText(previous: string, next: string, delta: string): string {
  if (!delta) return previous;
  if (!previous || next.startsWith(previous)) return next;
  return previous + delta;
}

function relationSupplementalContext(matrix: Record<string, unknown>): Record<string, unknown> | undefined {
  const relation = recordValue(matrix.relation);
  const quote = recordValue(relation?.quote);
  if (!quote) return undefined;
  return {
    quote: stripUndefined({
      id: stringValue(relation?.replyToEventId) ?? stringValue(relation?.targetEventId),
      body: stringValue(quote.body),
      sender: stringValue(quote.sender),
      senderAllowed: true,
      isQuote: true,
    }),
  };
}

function resolvePluginSession(runtime: OpenClawHostRuntime, sessionKey: string, agentId?: string): { entry?: Record<string, unknown>; sessionKey: string } {
  const getSessionEntry = runtime.agent?.session?.getSessionEntry;
  const direct = recordValue(getSessionEntry?.({ agentId, sessionKey }));
  if (direct) return { entry: direct, sessionKey };
  for (const item of sessionsFromPluginRuntime(runtime, { includeArchived: true })) {
    if (stringValue(item.key) === sessionKey) return { entry: item, sessionKey };
  }
  return { sessionKey };
}

function buildPluginSessionKey(agentId: string, label?: string): string {
  const suffix = (label ?? randomUUID()).toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 48) || randomUUID();
  return `agent:${agentId}:beeper:${suffix}`;
}

function sessionIdFromSessionKey(sessionKey: string): string {
  return sessionKey.toLowerCase().replace(/[^a-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 96) || randomUUID();
}

function resolvePluginSessionFile(
  runtime: OpenClawHostRuntime,
  agentId: string,
  sessionId: string,
  entry?: Record<string, unknown>,
): string {
  const resolver = runtime.agent?.session?.resolveSessionFilePath;
  if (resolver) return resolver(sessionId, entry, { agentId });
  const agentDir = runtime.agent?.resolveAgentDir?.(runtime.config?.current?.(), agentId);
  if (agentDir) return path.join(agentDir, "sessions", `${sessionId}.jsonl`);
  return path.join(process.env.OPENCLAW_STATE_DIR ?? path.join(process.env.HOME ?? ".", ".openclaw"), "agents", agentId, "sessions", `${sessionId}.jsonl`);
}

async function historyFromPluginRuntime(runtime: OpenClawHostRuntime, params: unknown): Promise<Array<Record<string, unknown>>> {
  const record = recordValue(params) ?? {};
  const sessionKey = stringValue(record.sessionKey) ?? stringValue(record.key);
  if (!sessionKey) return [];
  const agentId = agentIdFromSessionKey(sessionKey) ?? "main";
  const entry = resolvePluginSession(runtime, sessionKey, agentId).entry;
  const sessionId = stringValue(entry?.sessionId);
  const sessionFile = stringValue(entry?.sessionFile) ?? (sessionId ? resolvePluginSessionFile(runtime, agentId, sessionId, entry) : undefined);
  if (!sessionFile) return [];
  const limit = numberValue(record.limit);
  const messages = await readHistoryMessages(sessionFile);
  return limit && limit > 0 ? messages.slice(-limit) : messages;
}

async function readHistoryMessages(sessionFile: string): Promise<Array<Record<string, unknown>>> {
  let raw = "";
  try {
    raw = await fs.readFile(sessionFile, "utf8");
  } catch {
    return [];
  }
  const messages: Array<Record<string, unknown>> = [];
  let seq = 0;
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const message = normalizeHistoryRecord(parsed, ++seq);
    if (message) messages.push(message);
  }
  return messages;
}

function normalizeHistoryRecord(value: unknown, seq: number): Record<string, unknown> | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const message = recordValue(record.message) ?? recordValue(record.data) ?? record;
  const role = stringValue(message.role) ?? stringValue(record.role);
  const content = historyContentText(message.content) ?? stringValue(message.text) ?? stringValue(message.content) ?? stringValue(record.text);
  if (!role || !content) return undefined;
  return stripUndefined({
    content,
    id: stringValue(message.id) ?? stringValue(record.id) ?? `history:${seq}`,
    messageSeq: numberValue(record.messageSeq) ?? seq,
    role: role === "assistant" ? "agent" : role,
    timestamp: numberValue(record.timestamp) ?? numberValue(message.timestamp) ?? numberValue(record.createdAt) ?? numberValue(message.createdAt),
  });
}

function historyContentText(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  const content = arrayValue(value);
  if (!content) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    const record = recordValue(part);
    const text = stringValue(record?.text) ?? stringValue(record?.thinking);
    if (text) parts.push(text);
  }
  return parts.length ? parts.join("") : undefined;
}

function agentIdsFromPluginConfig(config: unknown): string[] {
  const ids = new Set(["main"]);
  for (const agent of agentsFromPluginConfig(config)) {
    const id = stringValue(agent.id) ?? stringValue(agent.agentId);
    if (id) ids.add(id);
  }
  return [...ids];
}

function agentIdFromSessionKey(sessionKey: string): string | undefined {
  return /^agent:([^:]+)/.exec(sessionKey)?.[1];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function firstNonUndefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function intValue(value: unknown): number | undefined {
  const number = numberValue(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
