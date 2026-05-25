import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
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

export interface OpenClawHostRuntime {
  agent?: {
    ensureAgentWorkspace?: (config: unknown, agentId?: string) => Promise<string> | string;
    resolveAgentDir?: (config: unknown, agentId?: string) => string;
    resolveAgentTimeoutMs?: (options: Record<string, unknown>) => number;
    resolveAgentWorkspaceDir?: (config: unknown, agentId?: string) => string;
    runEmbeddedAgent?: (params: Record<string, unknown>) => Promise<unknown>;
    runEmbeddedPiAgent?: (params: Record<string, unknown>) => Promise<unknown>;
    session?: {
      getSessionEntry?: (options: Record<string, unknown>) => Record<string, unknown> | undefined;
      listSessionEntries?: (options?: Record<string, unknown>) => Array<{ entry: Record<string, unknown>; sessionKey: string }>;
      resolveSessionFilePath?: (sessionId: string, entry?: Record<string, unknown>, options?: Record<string, unknown>) => string;
      upsertSessionEntry?: (options: Record<string, unknown>) => Promise<void> | void;
    };
  };
  channel?: {
    reply?: {
      dispatchReplyWithBufferedBlockDispatcher?: (params: Record<string, unknown>) => Promise<unknown>;
    };
    session?: {
      recordInboundSession?: (params: Record<string, unknown>) => Promise<void> | void;
      resolveStorePath?: (store?: string, options?: Record<string, unknown>) => string;
    };
    turn?: {
      buildContext?: (params: Record<string, unknown>) => Record<string, unknown>;
      runAssembled?: (params: Record<string, unknown>) => Promise<unknown>;
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

export class OpenClawHostTransport implements OpenClawTransport {
  readonly #runtime: OpenClawHostRuntime;
  readonly #localEvents = new LocalEventBus();

  constructor(runtime: OpenClawHostRuntime) {
    this.#runtime = runtime;
  }

  request<T = unknown>(method: string, params?: unknown, options?: GatewayRequestOptions): Promise<T> {
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
      case "sessions.send":
        return await sendSessionInPluginRuntime(this.#runtime, this.#localEvents, params, _options) as T;
      default:
        throw new Error(`OpenClaw plugin runtime does not expose request/call for ${method}`);
    }
  }
}

export function createOpenClawHostTransport(runtime: OpenClawHostRuntime): OpenClawHostTransport {
  return new OpenClawHostTransport(runtime);
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
  return normalized.length > 0 ? normalized : [{ id: "main", displayName: "OpenClaw" }];
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
    sessionFile: stringValue(entry.sessionFile) ?? resolvePluginSessionFile(runtime, agentId, sessionId, entry),
    sessionId,
    updatedAt: typeof entry.updatedAt === "number" ? entry.updatedAt : now,
  });
  await runtime.agent?.session?.upsertSessionEntry?.({ agentId, entry: next, sessionKey });
  return { agentId, key: sessionKey, label, sessionFile: next.sessionFile, sessionId };
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
  if (!sessionKey) throw new Error("OpenClaw plugin sessions.send requires key");
  if (!message) throw new Error("OpenClaw plugin sessions.send requires message");
  const agentId = agentIdFromSessionKey(sessionKey) ?? "main";
  const resolved = resolvePluginSession(runtime, sessionKey, agentId);
  const entry = resolved.entry ?? {};
  const sessionId = stringValue(entry.sessionId) ?? sessionIdFromSessionKey(sessionKey);
  const sessionFile = stringValue(entry.sessionFile) ?? resolvePluginSessionFile(runtime, agentId, sessionId, entry);
  const runId = `beeper:${randomUUID()}`;
  const cfg = runtime.config?.current?.();
  const runEmbeddedAgent = runtime.agent?.runEmbeddedAgent ?? runtime.agent?.runEmbeddedPiAgent;
  if (!runEmbeddedAgent && !canRunNativeChannelTurn(runtime)) {
    throw new Error("OpenClaw plugin runtime does not expose channel turn helpers or agent.runEmbeddedAgent");
  }
  const timeoutMs = options?.timeoutMs ?? numberValue(record.timeoutMs) ?? runtime.agent?.resolveAgentTimeoutMs?.({ cfg }) ?? 48 * 60 * 60 * 1000;
  queuePluginRun(() => {
    if (canRunNativeChannelTurn(runtime)) {
      return runBeeperChannelTurnInPluginRuntime({
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
      });
    }
    return runEmbeddedAgentInPluginRuntime({
      agentId,
      cfg,
      localEvents,
      message,
      record,
      runEmbeddedAgent: runEmbeddedAgent as (params: Record<string, unknown>) => Promise<unknown>,
      runId,
      runtime,
      sessionFile,
      sessionId,
      sessionKey,
      timeoutMs,
    });
  });
  return { runId, sessionFile, sessionId, sessionKey };
}

function queuePluginRun(run: () => Promise<void>): void {
  setTimeout(() => {
    void run().catch(() => {
      // The runner emits run.failed with details. This catch keeps the timer
      // task from surfacing an unhandled rejection in plugin hosts.
    });
  }, 0);
}

function canRunNativeChannelTurn(runtime: OpenClawHostRuntime): boolean {
  return Boolean(
    runtime.channel?.turn?.buildContext &&
      runtime.channel.turn.runAssembled &&
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
  const turn = params.runtime.channel?.turn;
  const channelSession = params.runtime.channel?.session;
  const channelReply = params.runtime.channel?.reply;
  if (!turn?.buildContext || !turn.runAssembled || !channelSession?.recordInboundSession || !channelReply?.dispatchReplyWithBufferedBlockDispatcher) {
    throw new Error("OpenClaw plugin runtime channel turn helpers are incomplete");
  }

  const sender = recordValue(recordValue(params.record.matrix)?.sender) ?? {};
  const matrix = recordValue(params.record.matrix) ?? {};
  const senderId = stringValue(matrix.sender) ?? stringValue(sender.id) ?? "beeper";
  const roomId = stringValue(recordValue(params.record.matrix)?.roomId) ?? stringValue(params.record.roomId) ?? params.sessionKey;
  const eventId = stringValue(params.record.idempotencyKey) ?? params.runId;
  const sessionConfig = recordValue(recordValue(params.cfg)?.session);
  const storePath = channelSession.resolveStorePath?.(stringValue(sessionConfig?.store), { agentId: params.agentId })
    ?? path.dirname(params.sessionFile);
  const ctxPayload = turn.buildContext({
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
      sourceReplyDeliveryMode: "direct",
    },
    message: {
      body: params.message,
      rawBody: params.message,
      bodyForAgent: params.message,
      commandBody: params.message,
      envelopeFrom: senderId,
      senderLabel: senderId,
      preview: params.message.slice(0, 280),
    },
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

  const emit = createBeeperReplyEventEmitter(params.localEvents, {
    agentId: params.agentId,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
  });
  params.localEvents.emit({ event: "run.started", payload: { agentId: params.agentId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  try {
    await turn.runAssembled({
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
        deliver: async (payload: unknown) => {
          emit.textPayload(payload);
          return { visibleReplySent: true };
        },
        onError: (error: unknown) => {
          params.localEvents.emit({ event: "run.failed", payload: { agentId: params.agentId, error: errorText(error), runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
        },
      },
      replyOptions: {
        runId: params.runId,
        timeoutOverrideSeconds: Math.max(1, Math.ceil(params.timeoutMs / 1000)),
        suppressDefaultToolProgressMessages: true,
        allowProgressCallbacksWhenSourceDeliverySuppressed: true,
        onAssistantMessageStart: emit.assistantMessageStart,
        onBlockReply: emit.textPayload,
        onBlockReplyQueued: emit.textPayload,
        onPartialReply: emit.textPayload,
        onReasoningEnd: emit.reasoningEnd,
        onReasoningStream: emit.reasoningPayload,
        onToolStart: emit.toolStart,
        onToolResult: emit.toolResult,
        onItemEvent: emit.itemEvent,
        onPlanUpdate: emit.planUpdate,
        onApprovalEvent: emit.approvalEvent,
        onCommandOutput: emit.commandOutput,
        onPatchSummary: emit.patchSummary,
        onCompactionStart: () => emit.itemEvent({ kind: "compaction", phase: "start", title: "Compacting context" }),
        onCompactionEnd: () => emit.itemEvent({ kind: "compaction", phase: "complete", title: "Compacted context" }),
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
    params.localEvents.emit({ event: "run.completed", payload: { agentId: params.agentId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  } catch (error) {
    params.localEvents.emit({ event: "run.failed", payload: { agentId: params.agentId, error: errorText(error), runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  }
}

async function runEmbeddedAgentInPluginRuntime(params: {
  agentId: string;
  cfg: unknown;
  localEvents: LocalEventBus;
  message: string;
  record: Record<string, unknown>;
  runEmbeddedAgent: (params: Record<string, unknown>) => Promise<unknown>;
  runId: string;
  runtime: OpenClawHostRuntime;
  sessionFile: string;
  sessionId: string;
  sessionKey: string;
  timeoutMs: number;
}): Promise<void> {
  params.localEvents.emit({ event: "run.started", payload: { agentId: params.agentId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
  const emit = createBeeperReplyEventEmitter(params.localEvents, {
    agentId: params.agentId,
    runId: params.runId,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
  });
  await params.runEmbeddedAgent(stripUndefined({
    agentId: params.agentId,
    config: params.cfg,
    currentMessageId: stringValue(params.record.idempotencyKey),
    messageChannel: "beeper",
    messageProvider: "beeper",
    prompt: params.message,
    runId: params.runId,
    sessionFile: params.sessionFile,
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    timeoutMs: params.timeoutMs,
    trigger: "user",
    workspaceDir: await resolvePluginWorkspaceDir(params.runtime, params.cfg, params.agentId),
    agentDir: params.runtime.agent?.resolveAgentDir?.(params.cfg, params.agentId),
    onAgentEvent: (event: OpenClawAgentRuntimeEvent) => {
      const data = recordValue(event.data) ?? {};
      params.localEvents.emit(stripUndefined({
        event: event.stream,
        payload: stripUndefined({
          ...data,
          runId: stringValue(data.runId) ?? params.runId,
          sessionKey: event.sessionKey ?? stringValue(data.sessionKey) ?? params.sessionKey,
        }),
        seq: numberValue(data.seq),
      }));
    },
    onAssistantMessageStart: emit.assistantMessageStart,
    onBlockReply: emit.textPayload,
    onBlockReplyQueued: emit.textPayload,
    onPartialReply: emit.textPayload,
    onReasoningEnd: emit.reasoningEnd,
    onReasoningStream: emit.reasoningPayload,
    onToolResult: emit.toolResult,
  })).then(
    (result) => {
      emit.finalText(finalTextFromEmbeddedRunResult(result));
      params.localEvents.emit({ event: "run.completed", payload: { agentId: params.agentId, runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
    },
    (error) => {
      params.localEvents.emit({ event: "run.failed", payload: { agentId: params.agentId, error: errorText(error), runId: params.runId, sessionId: params.sessionId, sessionKey: params.sessionKey } });
    },
  );
}

function createBeeperReplyEventEmitter(localEvents: LocalEventBus, base: {
  agentId: string;
  runId: string;
  sessionId: string;
  sessionKey: string;
}) {
  let lastPartialText = "";
  let lastReasoningText = "";
  const emit = (event: string, payload: Record<string, unknown>) => {
    localEvents.emit({ event, payload: stripUndefined({ ...base, ...payload }) });
  };
  const textPayload = (payload: unknown) => {
    const text = stringValue(recordValue(payload)?.text);
    if (!text) return;
    const explicitDelta = stringValue(recordValue(payload)?.delta);
    const delta = explicitDelta ?? (text.startsWith(lastPartialText) ? text.slice(lastPartialText.length) : text);
    lastPartialText = text;
    if (delta) emit("assistant.delta", { delta, text });
  };
  const reasoningPayload = (payload: unknown) => {
    const text = stringValue(recordValue(payload)?.text);
    if (!text) return;
    const explicitDelta = stringValue(recordValue(payload)?.delta);
    const delta = explicitDelta ?? (text.startsWith(lastReasoningText) ? text.slice(lastReasoningText.length) : text);
    lastReasoningText = text;
    if (delta) emit("thinking.delta", { delta, text });
  };
  const toolIdFor = (payload: Record<string, unknown>, fallback: string) =>
    stringValue(payload.toolCallId) ?? stringValue(payload.itemId) ?? stringValue(payload.approvalId) ?? fallback;
  return {
    assistantMessageStart: () => {
      lastPartialText = "";
      emit("assistant.message.start", {});
    },
    finalText: (text: string | undefined) => {
      if (!text) return;
      textPayload({ text });
    },
    reasoningEnd: () => emit("thinking.end", {}),
    reasoningPayload,
    textPayload,
    toolStart: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      emit("tool.call.started", {
        args: data.args,
        input: data.args,
        phase: stringValue(data.phase),
        toolCallId: toolIdFor(data, `tool:${stringValue(data.name) ?? "tool"}`),
        toolName: stringValue(data.name),
      });
    },
    toolResult: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      emit("tool.call.completed", {
        output: data.text ?? data.content ?? payload,
        toolCallId: toolIdFor(data, "tool_result"),
        toolName: stringValue(data.toolName) ?? stringValue(data.name),
      });
    },
    itemEvent: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      emit("tool.call.delta", {
        delta: stringValue(data.progressText) ?? stringValue(data.summary) ?? stringValue(data.status) ?? stringValue(data.phase),
        inputTextDelta: stringValue(data.progressText) ?? stringValue(data.summary) ?? stringValue(data.status) ?? stringValue(data.phase),
        toolCallId: toolIdFor(data, `item:${stringValue(data.name) ?? stringValue(data.kind) ?? "work"}`),
        toolName: stringValue(data.name) ?? stringValue(data.kind),
      });
    },
    planUpdate: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      emit("tool.call.delta", {
        delta: stringValue(data.title) ?? stringValue(data.explanation) ?? stringValue(data.phase),
        inputTextDelta: stringValue(data.title) ?? stringValue(data.explanation) ?? stringValue(data.phase),
        toolCallId: "plan",
        toolName: "plan",
      });
    },
    approvalEvent: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const phase = stringValue(data.phase);
      if (phase === "requested") {
        emit("approval.requested", {
          approvalId: stringValue(data.approvalId) ?? stringValue(data.approvalSlug),
          message: stringValue(data.message) ?? stringValue(data.reason) ?? stringValue(data.title),
          toolCallId: stringValue(data.toolCallId) ?? stringValue(data.itemId),
          toolName: stringValue(data.kind) ?? stringValue(data.command),
        });
        return;
      }
      if (phase === "resolved" || phase === "complete" || stringValue(data.status)) {
        emit("approval.resolved", {
          approvalId: stringValue(data.approvalId) ?? stringValue(data.approvalSlug),
          approved: stringValue(data.status) === "approved" || stringValue(data.status) === "allow",
          decision: stringValue(data.status),
          toolCallId: stringValue(data.toolCallId) ?? stringValue(data.itemId),
        });
      }
    },
    commandOutput: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      const complete = stringValue(data.phase) === "complete" || stringValue(data.status) === "complete";
      emit("tool.call.completed", {
        output: stringValue(data.output) ?? data,
        preliminary: !complete,
        toolCallId: toolIdFor(data, `command:${stringValue(data.name) ?? "output"}`),
        toolName: stringValue(data.name) ?? stringValue(data.title) ?? "command",
      });
    },
    patchSummary: (payload: unknown) => {
      const data = recordValue(payload) ?? {};
      emit("tool.call.completed", {
        output: data.summary ?? data,
        toolCallId: toolIdFor(data, "patch"),
        toolName: stringValue(data.name) ?? "patch",
      });
    },
  };
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

function finalTextFromEmbeddedRunResult(result: unknown): string | undefined {
  const record = recordValue(result);
  const direct = stringValue(record?.text) ?? stringValue(record?.message) ?? stringValue(record?.finalText);
  if (direct) return direct;
  const payloads = arrayValue(record?.payloads);
  if (!payloads) return undefined;
  const parts: string[] = [];
  for (const payload of payloads) {
    const payloadRecord = recordValue(payload);
    const text = stringValue(payloadRecord?.text) ?? stringValue(payloadRecord?.content);
    if (text) parts.push(text);
  }
  return parts.length > 0 ? parts.join("\n") : undefined;
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

async function resolvePluginWorkspaceDir(runtime: OpenClawHostRuntime, cfg: unknown, agentId: string): Promise<string> {
  const ensured = await runtime.agent?.ensureAgentWorkspace?.(cfg, agentId);
  if (typeof ensured === "string" && ensured) return ensured;
  const resolved = runtime.agent?.resolveAgentWorkspaceDir?.(cfg, agentId);
  if (resolved) return resolved;
  return process.cwd();
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
