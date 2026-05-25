import type { BridgeCreatePortalOptions, PickleBridge, Portal, UserLogin } from "@beeper/pickle-bridge";
import type {
  OpenClawChatHistoryMessage,
  OpenClawGatewayRuntime,
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
  runtime: OpenClawGatewayRuntime;
}

export interface BackfillAllOpenClawSessionsResult {
  portals: Portal[];
  sessions: OpenClawBackfillSession[];
  skipped: OpenClawBackfillSession[];
}

export async function discoverOneToOneSessions(
  runtime: OpenClawGatewayRuntime,
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
  runtime: OpenClawGatewayRuntime,
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
  for (const session of sessions) {
    if (options.registry.getBindingBySessionKey(session.sessionKey)) {
      skipped.push(session);
      continue;
    }
    const agent = options.registry.getAgent(session.agentId) ?? agentContactFromOpenClawAgent(options.runtime.config, {
      id: session.agentId,
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
      sender: session.agentId,
    };
    const creationContent = openClawBackfillRoomCreationContent(options.runtime.config);
    if (creationContent) portalOptions.creationContent = creationContent;
    const portal = await options.bridge.createPortal(options.login, portalOptions);
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

export function portalIdForBackfillSession(session: Pick<OpenClawBackfillSession, "sessionKey">): string {
  return `session:${Buffer.from(session.sessionKey).toString("base64url")}`;
}

export function isOneToOneSession(session: OpenClawListedSession): boolean {
  const chatType = session.chatType?.toLowerCase();
  if (chatType && ["dm", "direct", "private", "one_to_one", "1:1"].includes(chatType)) return true;
  if (session.lastTo && !session.lastTo.includes(",") && !session.lastTo.includes(" ")) return true;
  const originType = stringValue(session.origin?.type) ?? stringValue(session.origin?.surface);
  return originType === "terminal" || originType === "mac-app";
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
  if (originSurface === "terminal" || session.provider === "terminal") return "terminal";
  if (originSurface === "mac-app" || originSurface === "desktop" || session.provider === "mac-app") return "mac-app";
  if (session.lastChannel || session.lastProvider) return "channel";
  return "unknown";
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
