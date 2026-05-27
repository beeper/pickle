import type { BridgeCreatePortalOptions, PickleBridge, Portal, UserLogin } from "@beeper/pickle-bridge";
import type {
  OpenClawChatHistoryMessage,
  OpenClawSessionHistoryRuntime,
  OpenClawListedSession,
} from "./openclaw-runtime";
import { agentContactFromOpenClawAgent, agentGhostUserId, bindingIdForRoom, userContactFromOpenClawSession } from "./rooms";
import type { OpenClawBridgeRegistry } from "./registry";
import type { OpenClawBridgeConfig, OpenClawImportSource, OpenClawSessionBinding, OpenClawUserContact } from "./types";

export interface OpenClawBackfillSession {
  agentId: string;
  human?: OpenClawUserContact;
  label: string;
  session: OpenClawListedSession;
  sessionKey: string;
  source: "terminal" | "mac-app" | "channel" | "unknown";
}

export interface OpenClawBackfillMessage {
  content: Record<string, unknown>;
  id: string;
  role: "assistant" | "system" | "tool" | "user" | string;
  sender: "agent" | "human" | "system";
  seq: number;
  timestamp?: Date;
}

export interface OpenClawBackfillImport {
  binding: OpenClawSessionBinding;
  human?: OpenClawUserContact;
  messages: OpenClawBackfillMessage[];
  source: OpenClawBackfillSession["source"];
}

export interface BackfillAllOpenClawSessionsOptions {
  bridge: PickleBridge;
  importSources?: OpenClawImportSource[];
  limit?: number;
  login: UserLogin;
  registry: OpenClawBridgeRegistry;
  runtime: OpenClawSessionHistoryRuntime;
}

export interface BackfillAllOpenClawSessionsResult {
  portals: Portal[];
  sessions: OpenClawBackfillSession[];
  skipped: OpenClawBackfillSession[];
}

export async function discoverOneToOneSessions(
  runtime: OpenClawSessionHistoryRuntime,
  options: { importSources?: OpenClawImportSource[] } = {},
): Promise<OpenClawBackfillSession[]> {
  const sessions = await runtime.listSessions({ includeArchived: true });
  return sessions.flatMap((session) => {
    if (!isOneToOneSession(session)) return [];
    if (!shouldImportSession(session, options.importSources)) return [];
    const agentId = resolveAgentId(session);
    const result: OpenClawBackfillSession = {
      agentId,
      label: session.displayName ?? session.derivedTitle ?? session.label ?? session.key,
      session,
      sessionKey: session.key,
      source: sessionSource(session),
    };
    const human = userContactFromOpenClawSession(runtime.config, session);
    if (human !== undefined) result.human = human;
    return [result];
  });
}

export async function buildBackfillImport(
  runtime: Pick<OpenClawSessionHistoryRuntime, "loadHistory">,
  config: OpenClawBridgeConfig,
  session: OpenClawBackfillSession,
  options: { limit?: number; roomId: string }
): Promise<OpenClawBackfillImport> {
  const messages = (await runtime.loadHistory(session.sessionKey, options.limit)).map((message, index) =>
    normalizeHistoryMessage(message, index)
  );
  const binding: OpenClawSessionBinding = {
      agentId: session.agentId,
      createdAt: Date.now(),
      ghostUserId: agentGhostUserId(config, session.agentId),
      id: bindingIdForRoom(options.roomId),
      kind: "session",
      label: session.label,
      owner: "imported",
      roomId: options.roomId,
      sessionKey: session.sessionKey,
      updatedAt: Date.now(),
  };
  if (session.human !== undefined) binding.humanGhostUserId = session.human.ghostUserId;
  return {
    binding,
    ...(session.human !== undefined ? { human: session.human } : {}),
    messages,
    source: session.source,
  };
}

export async function backfillAllOpenClawSessions(options: BackfillAllOpenClawSessionsOptions): Promise<BackfillAllOpenClawSessionsResult> {
  const discoverOptions: { importSources?: OpenClawImportSource[] } = {};
  const importSources = options.importSources ?? options.runtime.config.importSources;
  if (importSources !== undefined) discoverOptions.importSources = importSources;
  const sessions = await discoverOneToOneSessions(options.runtime, discoverOptions);
  const portals: Portal[] = [];
  const importedSessions: OpenClawBackfillSession[] = [];
  const skipped: OpenClawBackfillSession[] = [];
  if (sessions.length === 0) {
    const portal = await createInitialOpenClawRoom(options);
    if (portal) portals.push(portal);
    await options.registry.save();
    return { portals, sessions: importedSessions, skipped };
  }
  for (const session of sessions) {
    const existingBinding = options.registry.getBindingBySessionKey(session.sessionKey);
    if (existingBinding) {
      healBindingGhosts(options.runtime.config, options.registry, existingBinding);
      skipped.push(session);
      continue;
    }
    const agent = normalizeAgentContact(options.runtime.config, options.registry.getAgent(session.agentId) ?? {
      agentId: session.agentId,
      displayName: session.agentId,
    });
    options.registry.upsertAgent(agent);
    if (session.human) options.registry.upsertUser(session.human);
    const portalOptions: BridgeCreatePortalOptions = {
      id: portalIdForBackfillSession(session),
      metadata: {
        openclaw: stripUndefined({
          agentId: session.agentId,
          ghostUserId: agent.ghostUserId,
          humanGhostUserId: session.human?.ghostUserId,
          sessionKey: session.sessionKey,
          source: session.source,
        }),
      },
      name: session.label,
      roomType: "dm",
    };
    const creationContent = openClawBackfillRoomCreationContent(options.runtime.config);
    if (creationContent) portalOptions.creationContent = creationContent;
    const portal = getExistingBridgePortal(options.bridge, { id: portalOptions.id, receiver: options.login.id })
      ?? await options.bridge.createPortal(options.login, portalOptions);
    portals.push(portal);
    if (!portal.mxid) {
      skipped.push(session);
      continue;
    }
    const importOptions: { limit?: number; roomId: string } = { roomId: portal.mxid };
    if (options.limit !== undefined) importOptions.limit = options.limit;
    const imported = await buildBackfillImport(options.runtime, options.runtime.config, session, importOptions);
    await options.bridge.backfillPortal(options.login, portal, {
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });
    options.registry.upsertBinding(imported.binding);
    importedSessions.push(session);
  }
  await options.registry.save();
  return { portals, sessions: importedSessions, skipped };
}

async function createInitialOpenClawRoom(options: BackfillAllOpenClawSessionsOptions): Promise<Portal | undefined> {
  const contacts = await options.runtime.listAgentContacts();
  const agent = normalizeAgentContact(
    options.runtime.config,
    contacts[0] ?? options.registry.data.agents[0] ?? agentContactFromOpenClawAgent(options.runtime.config, { id: "main", name: "OpenClaw" }),
  );
  options.registry.upsertAgent(agent);
  const sessionKey = agentPortalSessionKey(agent.agentId);
  const existing = options.registry.getBindingBySessionKey(sessionKey);
  if (existing) {
    healBindingGhosts(options.runtime.config, options.registry, existing);
    return undefined;
  }
  const portalOptions: BridgeCreatePortalOptions = {
    id: `agent:${agent.agentId}`,
    metadata: {
      openclaw: {
        agentId: agent.agentId,
        ghostUserId: agent.ghostUserId,
        sessionKey,
      },
    },
    name: agent.displayName,
    roomType: "dm",
  };
  const creationContent = openClawBackfillRoomCreationContent(options.runtime.config);
  if (creationContent) portalOptions.creationContent = creationContent;
  const portal = getExistingBridgePortal(options.bridge, { id: portalOptions.id, receiver: options.login.id })
    ?? await options.bridge.createPortal(options.login, portalOptions);
  if (portal.mxid) {
    const now = Date.now();
    options.registry.upsertBinding({
      agentId: agent.agentId,
      createdAt: now,
      ghostUserId: agent.ghostUserId,
      id: bindingIdForRoom(portal.mxid),
      kind: "session",
      label: agent.displayName,
      owner: "bridge",
      roomId: portal.mxid,
      sessionKey,
      updatedAt: now,
    });
  }
  return portal;
}

export function portalIdForBackfillSession(session: Pick<OpenClawBackfillSession, "sessionKey">): string {
  return `session:${Buffer.from(session.sessionKey).toString("base64url")}`;
}

function agentPortalSessionKey(agentId: string): string {
  return `agent:${agentId}`;
}

function getExistingBridgePortal(bridge: PickleBridge, portalKey: { id: string; receiver: string }): Portal | null {
  const getPortal = (bridge as { getPortal?: (key: { id: string; receiver?: string }) => Portal | null }).getPortal;
  return getPortal?.call(bridge, portalKey) ?? null;
}

function normalizeAgentContact(
  config: OpenClawBridgeConfig,
  agent: { agentId?: string; avatarMxc?: string; description?: string; displayName?: string; ghostUserId?: string } | undefined,
) {
  const normalized = agentContactFromOpenClawAgent(config, {
    avatarMxc: agent?.avatarMxc,
    description: agent?.description,
    displayName: agent?.displayName,
    id: agent?.agentId,
  });
  return normalized;
}

function healBindingGhosts(
  config: OpenClawBridgeConfig,
  registry: OpenClawBridgeRegistry,
  binding: OpenClawSessionBinding,
): void {
  const agent = normalizeAgentContact(config, registry.getAgent(binding.agentId) ?? {
    agentId: binding.agentId,
    displayName: binding.label ?? binding.agentId,
  });
  registry.upsertAgent(agent);
  registry.updateBinding(binding.id, (existing) => ({
    ...existing,
    ghostUserId: agent.ghostUserId,
    updatedAt: Date.now(),
  }));
}

export function isOneToOneSession(session: OpenClawListedSession): boolean {
  const chatType = session.chatType?.toLowerCase();
  if (chatType && ["dm", "direct", "private", "one_to_one", "1:1"].includes(chatType)) return true;
  if (session.lastTo && !session.lastTo.includes(",") && !session.lastTo.includes(" ")) return true;
  const originType = stringValue(session.origin?.type) ?? stringValue(session.origin?.surface);
  return originType === "terminal" || isDashboardSurface(originType);
}

export function shouldImportSession(
  session: OpenClawListedSession,
  importSources: readonly OpenClawImportSource[] | undefined,
): boolean {
  if (!importSources || importSources.length === 0) return false;
  const normalized = new Set(importSources);
  if (session.updatedAt === null) return normalized.has("archived");
  const source = sessionSource(session);
  if (source === "terminal") return normalized.has("tui");
  if (source === "mac-app") return normalized.has("dashboard");
  if (source === "channel") return normalized.has("channels");
  return normalized.has("channels");
}

function normalizeHistoryMessage(message: OpenClawChatHistoryMessage, index: number): OpenClawBackfillMessage {
  const role = typeof message.role === "string" ? message.role : "assistant";
  const text = contentText(message.content);
  const normalized: OpenClawBackfillMessage = {
    content: {
      body: text || JSON.stringify(message.content ?? message),
      msgtype: role === "assistant" ? "m.text" : "m.notice",
      "com.beeper.openclaw.backfill": {
        messageSeq: message.messageSeq ?? index,
        role,
      },
    },
    id: typeof message.id === "string" ? message.id : `history_${index}`,
    role,
    sender: role === "assistant" || role === "tool" ? "agent" : role === "system" ? "system" : "human",
    seq: typeof message.messageSeq === "number" ? message.messageSeq : index,
  };
  const timestamp = historyTimestamp(message);
  if (timestamp !== undefined) normalized.timestamp = timestamp;
  return normalized;
}

function resolveAgentId(session: OpenClawListedSession): string {
  if (session.agentId) return session.agentId;
  const match = /^agent:([^:]+)/.exec(session.key);
  return match?.[1] ?? "main";
}

function sessionSource(session: OpenClawListedSession): OpenClawBackfillSession["source"] {
  const originSurface = stringValue(session.origin?.surface) ?? stringValue(session.origin?.type);
  const provider = session.provider ?? session.lastProvider ?? session.lastChannel;
  if (originSurface === "terminal" || provider === "terminal") return "terminal";
  if (isDashboardSurface(originSurface) || isDashboardSurface(provider)) return "mac-app";
  if (session.lastChannel || session.lastProvider) return "channel";
  return "unknown";
}

function isDashboardSurface(value: string | undefined): boolean {
  return value === "mac-app" || value === "desktop" || value === "webchat" || value === "dashboard";
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    const record = recordValue(part);
    return stringValue(record?.text) ?? stringValue(record?.content) ?? "";
  }).join("");
}

function historyTimestamp(message: OpenClawChatHistoryMessage): Date | undefined {
  const raw =
    message.timestamp ??
    message.createdAt ??
    message.created_at ??
    message.time ??
    message.date;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const milliseconds = raw < 10_000_000_000 ? raw * 1000 : raw;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  if (typeof raw === "string" && raw.trim()) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric)) return historyTimestamp({ timestamp: numeric });
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}

function openClawBackfillRoomCreationContent(config: OpenClawBridgeConfig): Record<string, unknown> | undefined {
  return config.nonFederatedRooms ? { "m.federate": false } : undefined;
}
