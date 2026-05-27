import { createChannelPluginBase, createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import type { ChatType } from "openclaw/plugin-sdk/core";
import type { ChannelAccountSnapshot, ChannelCapabilities, ChannelGatewayContext, ChannelMessageActionName } from "openclaw/plugin-sdk/channel-contract";
import type { BridgeLogger } from "@beeper/pickle-bridge";
import { createConfigFromOpenClawSetup, defaultDataDir } from "./config";
import beeperChannelConfigSchema from "./beeper-channel-config.schema.json";
import type { setupOpenClawBeeperBridge, SetupOpenClawBeeperBridgeOptions } from "./beeper-setup";
import { createBeeperApprovalNotice } from "./approval";
import { requireBeeperChannelRuntimeForHost } from "./beeper-channel-runtime";
import type { OpenClawHostRuntime } from "./openclaw-runtime";

export type OpenClawSetupConfig = OpenClawConfig;

export type BeeperImportSource = "dashboard" | "tui" | "channels" | "archived";

export interface BeeperChannelSettings {
  accessToken?: string;
  allowedRoomIds?: string[];
  allowedUserIds?: string[];
  appserviceId?: string;
  asToken?: string;
  approvalBehavior?: "native" | "disabled";
  backfillLimit?: number;
  beeperEnv?: "production" | "staging" | "dev" | "local";
  bridgeManagerToken?: string;
  bridgeId?: string;
  contactVisibility?: "agents" | "agents-and-users" | "none";
  dataDir?: string;
  enabled?: boolean;
  homeserver?: string;
  hsToken?: string;
  importSources?: BeeperImportSource[];
  matrixDeviceId?: string;
  matrixUserId?: string;
  homeserverDomain?: string;
}

export interface BeeperSetupInput {
  accessToken?: string;
  allowedRoomIds?: string[] | string;
  allowedUserIds?: string[] | string;
  appserviceId?: string;
  asToken?: string;
  approvalBehavior?: string;
  backfillLimit?: number | string;
  beeperEnv?: string;
  bridgeManagerToken?: string;
  bridgeId?: string;
  code?: string;
  contactVisibility?: string;
  dataDir?: string;
  email?: string;
  getOnly?: boolean | string;
  homeserverDomain?: string;
  importSources?: string[] | string;
  postState?: boolean | string;
  push?: boolean | string;
  selfHosted?: boolean | string;
  username?: string;
}

export interface BeeperSetupRuntime {
  setupBridge?: (options: SetupOpenClawBeeperBridgeOptions) => Promise<Awaited<ReturnType<typeof setupOpenClawBeeperBridge>>>;
}

type StartedBeeperBridge = {
  stop?: () => Promise<void> | void;
};

type BeeperGatewayContext = {
  abortSignal: AbortSignal;
  accountId: string;
  cfg: OpenClawSetupConfig;
  hostRuntime?: unknown;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
  runtime?: unknown;
  setStatus?: (next: ChannelAccountSnapshot) => void;
};

type BeeperWizardPrompter = {
  confirm: (params: { message: string; initialValue?: boolean }) => Promise<boolean>;
  multiselect: <T>(params: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValues?: T[];
    searchable?: boolean;
  }) => Promise<T[]>;
  progress?: (label: string) => { update: (message: string) => void; stop: (message?: string) => void };
  select: <T>(params: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
    searchable?: boolean;
  }) => Promise<T>;
  text: (params: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    sensitive?: boolean;
    validate?: (value: string) => string | undefined;
  }) => Promise<string>;
};

export const BEEPER_CHANNEL_ID = "beeper";

let openClawPluginRuntime: object | undefined;

export function setBeeperOpenClawPluginRuntime(runtime: unknown): void {
  openClawPluginRuntime = typeof runtime === "object" && runtime !== null ? runtime : undefined;
}

function requireBeeperChannelRuntime() {
  return requireBeeperChannelRuntimeForHost(openClawPluginRuntime);
}

export const BeeperChannelConfigSchema = beeperChannelConfigSchema;

export const BeeperChannelUiHints = {
  accessToken: {
    help: "Beeper Matrix access token returned by login.",
    label: "Beeper Access Token",
    sensitive: true,
  },
  bridgeManagerToken: {
    help: "Optional Beeper bridge-manager token used to register the self-hosted bridge.",
    label: "Bridge Manager Token",
    sensitive: true,
  },
  asToken: {
    help: "Appservice token returned by Beeper bridge registration.",
    label: "Appservice Token",
    sensitive: true,
  },
  hsToken: {
    help: "Homeserver token returned by Beeper bridge registration.",
    label: "Homeserver Token",
    sensitive: true,
  },
} as const;

export const beeperMessageAdapter = {
  id: BEEPER_CHANNEL_ID,
  durableFinal: {
    capabilities: {
      media: true,
      messageSendingHooks: true,
      replyTo: true,
      text: true,
      thread: true,
    },
  },
  live: {
    capabilities: {
      nativeStreaming: true,
      previewFinalization: true,
      progressUpdates: true,
      quietFinalization: true,
    },
    finalizer: {
      capabilities: {
        finalEdit: true,
        normalFallback: false,
        previewReceipt: true,
        retainOnAmbiguousFailure: true,
      },
    },
  },
  receive: {
    defaultAckPolicy: "after_agent_dispatch",
    supportedAckPolicies: ["after_receive_record", "after_agent_dispatch"],
  },
  send: {
    text: async (ctx: {
      cfg: OpenClawSetupConfig;
      to: string;
      text: string;
      replyToId?: string | null;
      threadId?: string | number | null;
    }) => beeperMessageSendResult(await beeperOutboundAdapter.sendText(ctx)),
    media: async (ctx: {
      cfg: OpenClawSetupConfig;
      to: string;
      text?: string;
      mediaUrl?: string;
      mediaReadFile?: (filePath: string) => Promise<Buffer>;
      replyToId?: string | null;
      threadId?: string | number | null;
    }) => beeperMessageSendResult(await beeperOutboundAdapter.sendMedia(ctx)),
    payload: async (ctx: {
      cfg: OpenClawSetupConfig;
      to: string;
      text?: string;
      mediaUrl?: string;
      mediaReadFile?: (filePath: string) => Promise<Buffer>;
      payload?: unknown;
      replyToId?: string | null;
      threadId?: string | number | null;
    }) => beeperMessageSendResult(await beeperOutboundAdapter.sendPayload(ctx)),
  },
} as const;

export const beeperOutboundAdapter = {
  deliveryMode: "direct",
  sendText: async (ctx: {
    to: string;
    text: string;
    replyToId?: string | null;
    threadId?: string | number | null;
  }) => {
    const runtime = requireBeeperChannelRuntime();
    const sent = await runtime.sendText({
      roomId: resolveBeeperRoomTarget(ctx.to),
      text: ctx.text,
      ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
      ...(ctx.threadId != null ? { threadRoot: ctx.threadId } : {}),
    });
    return beeperOutboundResult(sent);
  },
  sendMedia: async (ctx: {
    to: string;
    text?: string;
    mediaUrl?: string;
    mediaReadFile?: (filePath: string) => Promise<Buffer>;
    threadId?: string | number | null;
  }) => {
    const runtime = requireBeeperChannelRuntime();
    const mediaUrl = ctx.mediaUrl?.trim();
    if (!mediaUrl) {
      return await beeperOutboundAdapter.sendText({
        to: ctx.to,
        text: ctx.text ?? "",
        ...(ctx.threadId != null ? { threadId: ctx.threadId } : {}),
      });
    }
    const bytes = ctx.mediaReadFile ? await ctx.mediaReadFile(mediaUrl) : undefined;
    const filename = mediaUrl.split("/").pop();
    const mediaOptions = {
      roomId: resolveBeeperRoomTarget(ctx.to),
      ...(bytes !== undefined ? { bytes } : {}),
      ...(ctx.text !== undefined ? { caption: ctx.text } : {}),
      ...(filename ? { filename } : {}),
      ...(bytes === undefined ? { path: mediaUrl } : {}),
      ...(ctx.threadId != null ? { threadRoot: String(ctx.threadId) } : {}),
    };
    const sent = await runtime.sendMedia(mediaOptions);
    return beeperOutboundResult(sent);
  },
  sendPayload: async (ctx: {
    to: string;
    text?: string;
    mediaUrl?: string;
    mediaReadFile?: (filePath: string) => Promise<Buffer>;
    payload?: unknown;
    replyToId?: string | null;
    threadId?: string | number | null;
  }) => {
    const mediaUrl = ctx.mediaUrl ?? firstPayloadMediaUrl(ctx.payload);
    const text = ctx.text ?? firstPayloadText(ctx.payload) ?? "";
    if (mediaUrl) {
      return await beeperOutboundAdapter.sendMedia({
        mediaUrl,
        text,
        to: ctx.to,
        ...(ctx.mediaReadFile !== undefined ? { mediaReadFile: ctx.mediaReadFile } : {}),
        ...(ctx.threadId != null ? { threadId: ctx.threadId } : {}),
      });
    }
    return await beeperOutboundAdapter.sendText({
      text,
      to: ctx.to,
      ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
      ...(ctx.threadId != null ? { threadId: ctx.threadId } : {}),
    });
  },
} as const;

export const beeperMessagingAdapter = {
  defaultMarkdownTableMode: "bullets",
  targetPrefixes: ["beeper", "agent", "openclaw"],
  normalizeTarget: normalizeBeeperMessagingTarget,
  resolveInboundConversation: ({ to, conversationId, threadId }: {
    to?: string;
    conversationId?: string;
    threadId?: string | number;
    isGroup: boolean;
  }) => {
    const id = normalizeBeeperConversationId(conversationId ?? to);
    if (!id) return null;
    return stripUndefined({
      conversationId: id,
      ...(threadId !== undefined ? { parentConversationId: id } : {}),
    });
  },
  resolveDeliveryTarget: ({ conversationId }: { conversationId: string; parentConversationId?: string }) => ({
    to: normalizeBeeperConversationId(conversationId) ?? conversationId,
  }),
  resolveSessionConversation: ({ kind, rawId }: { kind: "group" | "channel"; rawId: string }) =>
    kind === "channel"
      ? {
          baseConversationId: normalizeBeeperConversationId(rawId) ?? rawId,
          id: normalizeBeeperConversationId(rawId) ?? rawId,
          parentConversationCandidates: [normalizeBeeperConversationId(rawId) ?? rawId],
        }
      : null,
  resolveSessionTarget: ({ id }: { kind: "group" | "channel"; id: string }) => `beeper:${id}`,
  inferTargetChatType: (): ChatType => "direct",
  formatTargetDisplay: ({ target, display }: { target: string; display?: string }) =>
    display?.trim() || formatBeeperTargetDisplay(target),
  resolveOutboundSessionRoute: (params: {
    cfg: OpenClawSetupConfig;
    agentId: string;
    accountId?: string | null;
    target: string;
    resolvedTarget?: { to?: string };
  }) => {
    const target = normalizeBeeperMessagingTarget(params.resolvedTarget?.to ?? params.target);
    if (!target) return null;
    const sessionKey = [
      "agent",
      params.agentId,
      BEEPER_CHANNEL_ID,
      params.accountId ?? "default",
      "direct",
      target,
    ].join(":");
    return {
      baseSessionKey: sessionKey,
      chatType: "direct" as const,
      from: `beeper:${target}`,
      peer: { kind: "direct" as const, id: target },
      sessionKey,
      to: `beeper:${target}`,
    };
  },
  targetResolver: {
    hint: "<agent-id|@agent-mxid|room-id>",
    looksLikeId: (value: string) => Boolean(normalizeBeeperMessagingTarget(value)),
    resolveTarget: async ({ input, normalized }: { input: string; normalized: string }) => {
      const target = normalizeBeeperMessagingTarget(normalized) ?? normalizeBeeperMessagingTarget(input);
      return target
        ? {
            display: formatBeeperTargetDisplay(target),
            kind: "user" as const,
            source: "normalized" as const,
            to: target,
          }
        : null;
    },
  },
} as const;

export const beeperConversationBindings = {
  supportsCurrentConversationBinding: true,
  defaultTopLevelPlacement: "current",
  resolveConversationRef: ({ conversationId, parentConversationId }: {
    accountId?: string | null;
    conversationId: string;
    parentConversationId?: string;
    threadId?: string | number | null;
  }) => stripUndefined({
    conversationId: normalizeBeeperConversationId(conversationId) ?? conversationId,
    ...(parentConversationId ? { parentConversationId } : {}),
  }),
  buildBoundReplyPayload: ({ operation, conversation }: {
    operation: "acp-spawn";
    placement: "current" | "child";
    conversation: { channel: string; accountId?: string | null; conversationId: string; parentConversationId?: string };
  }) => operation === "acp-spawn"
    ? {
        channelData: {
          beeper: {
            conversationId: conversation.conversationId,
            kind: "agent_dm",
          },
        },
      }
    : null,
} as const;

export const beeperDirectoryAdapter = {
  listPeers: async ({ cfg, query, limit }: {
    cfg: OpenClawSetupConfig;
    query?: string | null;
    limit?: number | null;
  }) => listLiveOrConfiguredAgentDirectoryEntries(cfg, query, limit),
  listPeersLive: async ({ cfg, query, limit }: {
    cfg: OpenClawSetupConfig;
    query?: string | null;
    limit?: number | null;
  }) => listLiveOrConfiguredAgentDirectoryEntries(cfg, query, limit),
  listGroups: async () => [],
} as const;

export const beeperResolverAdapter = {
  resolveTargets: async ({ cfg, inputs, kind }: {
    cfg: OpenClawSetupConfig;
    accountId?: string | null;
    inputs: string[];
    kind: "user" | "group";
  }) => {
    if (kind === "group") {
      return inputs.map((input) => ({
        input,
        note: "Beeper OpenClaw v1 supports agent DMs only.",
        resolved: false as const,
      }));
    }
    const peers = await beeperDirectoryAdapter.listPeers({ cfg });
    return inputs.map((input) => {
      const target = normalizeBeeperMessagingTarget(input);
      if (!target) return { input, resolved: false as const };
      const directoryHit = peers.find((peer) =>
        peer.id.toLowerCase() === target.toLowerCase() ||
        peer.handle?.toLowerCase() === target.toLowerCase() ||
        peer.name?.toLowerCase() === target.toLowerCase()
      );
      return {
        id: directoryHit?.id ?? target,
        input,
        name: directoryHit?.name ?? formatBeeperTargetDisplay(target),
        resolved: true as const,
      };
    });
  },
} as const;

export const beeperHeartbeatAdapter = {
  sendTyping: async ({ to }: { to: string }) => {
    await requireBeeperChannelRuntime().typing({ roomId: resolveBeeperRoomTarget(to) });
  },
  clearTyping: async ({ to }: { to: string }) => {
    await requireBeeperChannelRuntime().typing({ roomId: resolveBeeperRoomTarget(to), typing: false });
  },
} as const;

export const beeperApprovalCapability = {
  initiatingSurface: {
    exec: () => ({ kind: "enabled" }),
    plugin: () => ({ kind: "enabled" }),
  },
  render: {
    exec: {
      buildPendingPayload: ({ request, nowMs }: { request: { id?: string; approvalId?: string; command?: string; toolCallId?: string; toolName?: string; expiresAtMs?: number }; nowMs: number }) => {
        const approvalId = request.approvalId ?? request.id ?? `approval_${nowMs}`;
        const toolName = request.toolName ?? request.command ?? "OpenClaw tool";
        const body = `Approval requested: ${request.command ?? request.id ?? request.approvalId ?? "OpenClaw tool call"}`;
        const notice = createBeeperApprovalNotice({
          approvalId,
          body,
          input: {
            command: request.command,
            createdAtMs: nowMs,
            kind: "exec",
          },
          messageId: approvalId,
          toolCallId: request.toolCallId ?? approvalId,
          toolName,
          ...(request.expiresAtMs !== undefined ? { expiresAtMs: request.expiresAtMs } : {}),
        });
        return {
          body,
          channelData: {
            beeper: {
              approvalId,
              createdAt: nowMs,
              kind: "exec",
              notice,
            },
          },
          content: {
            body,
            msgtype: "m.notice",
            ...notice,
          },
        };
      },
    },
  },
} as const;

const beeperMessageToolActions = ["send", "react", "read"] as const satisfies readonly ChannelMessageActionName[];

function beeperToolTextResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
}

export const beeperMessageActions = {
  resolveExecutionMode: () => "gateway" as const,
  describeMessageTool: () => ({
    actions: beeperMessageToolActions,
    capabilities: [],
  }),
  supportsAction: ({ action }: { action: string }) =>
    action === "send" || action === "react" || action === "read",
  extractToolSend: () => null,
  handleAction: async (ctx: { action: string; params: Record<string, unknown>; mediaReadFile?: (filePath: string) => Promise<Buffer>; sessionKey?: string | null }) => {
    const runtime = requireBeeperChannelRuntime();
    const params = ctx.params;
    if (ctx.action === "send") {
      const text = readRequiredString(params, "message", "text", "body");
      const sent = await runtime.publishActiveText({
        ...(ctx.sessionKey !== undefined ? { sessionKey: ctx.sessionKey } : {}),
        text,
      });
      return beeperToolTextResult(`Published Beeper native stream text ${sent.eventId}`);
    }
    const roomId = resolveBeeperRoomTarget(readRequiredString(params, "to", "roomId", "channelId"));
    if (ctx.action === "react") {
      const eventId = readRequiredString(params, "messageId", "eventId");
      const emoji = readRequiredString(params, "emoji", "reaction", "key");
      const remove = params.remove === true;
      if (remove) {
        await runtime.removeReaction({ emoji, eventId, roomId });
        return beeperToolTextResult(`Removed Beeper reaction ${emoji}`);
      }
      const sent = await runtime.react({ emoji, eventId, roomId });
      return beeperToolTextResult(`Sent Beeper reaction ${sent.eventId}`);
    }
    if (ctx.action === "read") {
      const eventId = readRequiredString(params, "messageId", "eventId");
      await runtime.readReceipt({ eventId, roomId });
      return beeperToolTextResult(`Marked Beeper message read ${eventId}`);
    }
    if (ctx.action === "mark_unread") {
      const eventId = readRequiredString(params, "messageId", "eventId");
      const unread = params.unread !== false;
      await runtime.markUnread({ eventId, roomId, unread });
      return beeperToolTextResult(`${unread ? "Marked" : "Unmarked"} Beeper room unread`);
    }
    throw new Error(`Unsupported Beeper message action: ${ctx.action}`);
  },
} as const;

export const beeperCommandAdapter = {
  nativeCommandsAutoEnabled: true,
  nativeSkillsAutoEnabled: true,
  skipWhenConfigEmpty: false,
} as const;

export const beeperAgentPromptAdapter = {
  inboundFormattingHints: () => ({
    rules: [
      "Beeper OpenClaw rooms are direct chats between the owner and one OpenClaw agent ghost.",
      "Matrix replies, edits, reactions, redactions, mentions, and attachments are forwarded as structured metadata when available.",
      "Native Beeper streaming renders assistant text, tool calls, approvals, and terminal status incrementally.",
    ],
    text_markup: "Matrix-flavored plain text with optional formatted_body metadata",
  }),
  messageToolCapabilities: () => ["reactions"],
  reactionGuidance: () => ({ channelLabel: "Beeper", level: "minimal" as const }),
} as const;

export const beeperSetupAdapter = {
  resolveAccountId: () => "default",
  resolveBindingAccountId: () => "default",
  applyAccountName: ({ cfg }: { cfg: OpenClawSetupConfig }) => cfg,
  validateInput: ({ input }: { input: BeeperSetupInput }) => validateBeeperSetupInput(input),
  applyAccountConfig: ({
    cfg,
    input,
    runtime,
  }: {
    cfg: OpenClawSetupConfig;
    accountId: string;
    input: BeeperSetupInput;
    runtime?: BeeperSetupRuntime;
  }): OpenClawSetupConfig => {
    if (input.email) {
      throw new Error("Beeper email login is asynchronous; use the Beeper setup wizard or pickle-openclaw login.");
    }
    return applyBeeperChannelSettings(cfg, normalizeBeeperSetupInput(input));
  },
};

export const beeperSetupWizard = {
  channel: BEEPER_CHANNEL_ID,
  async getStatus(ctx: { cfg: OpenClawSetupConfig }) {
    const settings = getBeeperChannelSettings(ctx.cfg);
    const configured = isBeeperChannelConfigured(ctx.cfg);
    return {
      channel: BEEPER_CHANNEL_ID,
      configured,
      statusLines: [
        "Runtime: OpenClaw plugin",
        "Registration transport: websocket",
        `Import sources: ${(settings.importSources ?? []).join(", ") || "none"}`,
      ],
      selectionHint: configured ? "Beeper bridge configured" : "Beeper login and bridge registration required",
      quickstartScore: configured ? 100 : 20,
    };
  },
  async configure(ctx: { cfg: OpenClawSetupConfig }) {
    return {
      accountId: "default",
      cfg: applyBeeperChannelSettings(ctx.cfg, defaultBeeperChannelSettings()),
    };
  },
  async configureInteractive(ctx: {
    cfg: OpenClawSetupConfig;
    runtime?: unknown;
    prompter: BeeperWizardPrompter;
  }) {
    const current = {
      ...defaultBeeperChannelSettings(),
      ...getBeeperChannelSettings(ctx.cfg),
    };
    const email = await ctx.prompter.text({
      message: "Beeper email",
      placeholder: "name@example.com",
      validate: (value) => validateBeeperSetupInput({ email: value }) ?? undefined,
    });
    const code = await ctx.prompter.text({
      message: "Beeper login code",
      sensitive: true,
      validate: (value) => (value.trim() ? undefined : "Beeper login code is required."),
    });
    const beeperEnv = await ctx.prompter.select<BeeperChannelSettings["beeperEnv"]>({
      message: "Beeper environment",
      initialValue: current.beeperEnv ?? "production",
      options: [
        { value: "production", label: "Production" },
        { value: "staging", label: "Staging" },
        { value: "dev", label: "Development" },
        { value: "local", label: "Local" },
      ],
    });
    const bridgeManagerToken = await ctx.prompter.text({
      message: "Bridge manager token",
      ...(current.bridgeManagerToken ? { initialValue: current.bridgeManagerToken } : {}),
      placeholder: "optional",
      sensitive: true,
    });
    const homeserverDomain = await ctx.prompter.text({
      message: "Homeserver domain",
      ...(current.homeserverDomain ? { initialValue: current.homeserverDomain } : {}),
      placeholder: "optional",
    });
    const importSources = await ctx.prompter.multiselect<BeeperImportSource>({
      message: "OpenClaw sessions to import",
      initialValues: current.importSources ?? ["dashboard", "tui"],
      options: [
        { value: "dashboard", label: "Dashboard" },
        { value: "tui", label: "TUI" },
        { value: "channels", label: "Channel-origin sessions" },
        { value: "archived", label: "Archived sessions" },
      ],
    });
    const backfillLimit = await ctx.prompter.text({
      message: "Backfill limit per session",
      initialValue: String(current.backfillLimit ?? 500),
      validate: (value) => validateBeeperSetupInput({ backfillLimit: value }) ?? undefined,
    });
    const contactVisibility = await ctx.prompter.select<BeeperChannelSettings["contactVisibility"]>({
      message: "Beeper contact visibility",
      initialValue: current.contactVisibility ?? "agents",
      options: [
        { value: "agents", label: "Agents" },
        { value: "agents-and-users", label: "Agents and users" },
        { value: "none", label: "None" },
      ],
    });
    const approvalBehavior = await ctx.prompter.select<BeeperChannelSettings["approvalBehavior"]>({
      message: "Approval behavior",
      initialValue: current.approvalBehavior ?? "native",
      options: [
        { value: "native", label: "Native" },
        { value: "disabled", label: "Disabled" },
      ],
    });
    const progress = ctx.prompter.progress?.("Setting up Beeper bridge");
    progress?.update("Logging in and registering appservice");
    try {
      const input: BeeperSetupInput = {
        backfillLimit,
        code,
        email,
        importSources,
      };
      if (approvalBehavior !== undefined) input.approvalBehavior = approvalBehavior;
      if (beeperEnv !== undefined) input.beeperEnv = beeperEnv;
      if (bridgeManagerToken.trim()) input.bridgeManagerToken = bridgeManagerToken.trim();
      if (contactVisibility !== undefined) input.contactVisibility = contactVisibility;
      if (homeserverDomain.trim()) input.homeserverDomain = homeserverDomain.trim();
      const setupParams: Parameters<typeof applyBeeperSetupConfig>[0] = {
        cfg: ctx.cfg,
        input,
      };
      const setupRuntime = beeperSetupRuntime(ctx.runtime);
      if (setupRuntime) setupParams.runtime = setupRuntime;
      const cfg = await applyBeeperSetupConfig(setupParams);
      progress?.stop("Beeper bridge configured");
      return { accountId: "default", cfg };
    } catch (error) {
      progress?.stop("Beeper bridge setup failed");
      throw error;
    }
  },
  disable: (cfg: OpenClawSetupConfig) => applyBeeperChannelSettings(cfg, { enabled: false }),
};

export const beeperChannelConfig = {
  listAccountIds: () => ["default"],
  defaultAccountId: () => "default",
  resolveAccount: (cfg: OpenClawSetupConfig) => ({
    accountId: "default",
    configured: isBeeperChannelConfigured(cfg),
    settings: getBeeperChannelSettings(cfg),
  }),
  isEnabled: (account: { settings?: BeeperChannelSettings }) => account.settings?.enabled !== false,
  isConfigured: (account: { configured?: boolean }) => account.configured === true,
  hasConfiguredState: ({ cfg }: { cfg: OpenClawSetupConfig }) => isBeeperChannelConfigured(cfg),
  describeAccount: (account: { configured?: boolean; settings?: BeeperChannelSettings }) => ({
    accountId: "default",
    name: "Beeper",
    configured: account.configured === true,
    extra: {
      registrationUrl: "websocket",
    },
  }),
};

export const beeperStatusAdapter = {
  defaultRuntime: {
    accountId: "default",
    configured: false,
    enabled: false,
    extra: {
      mode: "self-hosted-appservice",
    },
    running: false,
  },
  buildChannelSummary: ({ snapshot }: { snapshot: Record<string, unknown> }) => ({
    configured: snapshot.configured === true,
    enabled: snapshot.enabled !== false,
    homeserver: recordValue(snapshot.extra)?.homeserver,
    mode: "self-hosted-appservice",
    running: snapshot.running === true,
  }),
  buildAccountSnapshot: ({ account, runtime }: { account: { accountId?: string; configured?: boolean; settings?: BeeperChannelSettings }; runtime?: Record<string, unknown> }) => {
    const settings = account.settings ?? {};
    return {
      accountId: account.accountId ?? "default",
      configured: account.configured === true,
      enabled: settings.enabled !== false,
      extra: {
        approvalBehavior: settings.approvalBehavior ?? "native",
        beeperEnv: settings.beeperEnv ?? "production",
        contactVisibility: settings.contactVisibility ?? "agents",
        homeserver: settings.homeserver,
        importSources: settings.importSources ?? [],
        mode: "self-hosted-appservice",
        registrationUrl: "websocket",
      },
      name: "Beeper",
      running: runtime?.running === true,
    };
  },
  resolveAccountState: ({ configured, enabled }: { configured: boolean; enabled: boolean }) => {
    if (!enabled) return "disabled";
    return configured ? "configured" : "not configured";
  },
  collectStatusIssues: (accounts: Array<{ configured?: boolean; enabled?: boolean }>) =>
    accounts
      .filter((account) => account.enabled !== false && account.configured !== true)
      .map((account) => ({
        accountId: "accountId" in account && typeof account.accountId === "string" ? account.accountId : "default",
        channel: BEEPER_CHANNEL_ID,
        kind: "config" as const,
        message: "Beeper bridge is not fully configured; run Beeper channel setup.",
        severity: "warning" as const,
      })),
};

const startedBridges = new Map<string, StartedBeeperBridge>();

export async function applyBeeperSetupConfig(params: {
  cfg: OpenClawSetupConfig;
  input: BeeperSetupInput;
  runtime?: BeeperSetupRuntime;
}): Promise<OpenClawSetupConfig> {
  const baseSettings = normalizeBeeperSetupInput(params.input);
  if (!params.input.email) return applyBeeperChannelSettings(params.cfg, baseSettings);
  const setupBridge = params.runtime?.setupBridge ?? (await loadBeeperSetupBridge());
  const bridgeOptions = setupOptionsFromInput(params.input);
  const result = await setupBridge(bridgeOptions);
  const setupSettings: Partial<BeeperChannelSettings> = {
    ...baseSettings,
    enabled: true,
  };
  if (result.config.homeserver) setupSettings.homeserver = result.config.homeserver;
  if (result.config.accessToken) setupSettings.accessToken = result.config.accessToken;
  if (result.config.appserviceId) setupSettings.appserviceId = result.config.appserviceId;
  if (result.config.asToken) setupSettings.asToken = result.config.asToken;
  if (result.config.bridgeId) setupSettings.bridgeId = result.config.bridgeId;
  if (result.config.homeserverDomain) setupSettings.homeserverDomain = result.config.homeserverDomain;
  else if (params.input.homeserverDomain) setupSettings.homeserverDomain = params.input.homeserverDomain;
  if (result.config.hsToken) setupSettings.hsToken = result.config.hsToken;
  if (result.config.matrixDeviceId) setupSettings.matrixDeviceId = result.config.matrixDeviceId;
  if (result.config.matrixUserId) setupSettings.matrixUserId = result.config.matrixUserId;
  return applyBeeperChannelSettings(params.cfg, setupSettings);
}

async function loadBeeperSetupBridge(): Promise<typeof setupOpenClawBeeperBridge> {
  return (await import("./beeper-setup")).setupOpenClawBeeperBridge;
}

export const BeeperChannelConfigSchemaForSdk = {
  schema: BeeperChannelConfigSchema,
  uiHints: BeeperChannelUiHints,
} as const;

const BeeperChannelCapabilities: ChannelCapabilities = {
  chatTypes: ["direct", "group", "thread"],
  blockStreaming: true,
  media: true,
  nativeCommands: true,
  reactions: true,
  threads: true,
};

type BeeperResolvedAccount = {
  accountId: string;
  configured: boolean;
  settings: BeeperChannelSettings;
};

export const beeperChannelPlugin: ChannelPlugin<BeeperResolvedAccount> & { uiHints: typeof BeeperChannelUiHints } = {
  ...createChatChannelPlugin({
  base: {
    ...createChannelPluginBase({
      id: BEEPER_CHANNEL_ID,
      meta: {
        id: BEEPER_CHANNEL_ID,
        label: "Beeper",
        selectionLabel: "Beeper bridge",
        docsPath: "/channels/beeper",
        docsLabel: "beeper",
        blurb: "bridges OpenClaw sessions and agents into Beeper.",
        order: 90,
        quickstartAllowFrom: true,
      },
      capabilities: BeeperChannelCapabilities,
      reload: { configPrefixes: ["channels.beeper"] },
      commands: beeperCommandAdapter,
      configSchema: BeeperChannelConfigSchemaForSdk,
      config: beeperChannelConfig,
      setup: beeperSetupAdapter,
      setupWizard: beeperSetupWizard,
      agentPrompt: beeperAgentPromptAdapter,
    }),
    capabilities: BeeperChannelCapabilities,
    config: beeperChannelConfig,
    setup: beeperSetupAdapter,
    status: beeperStatusAdapter,
    conversationBindings: beeperConversationBindings,
    message: beeperMessageAdapter,
    messaging: beeperMessagingAdapter,
    outbound: beeperOutboundAdapter,
    directory: beeperDirectoryAdapter,
    resolver: beeperResolverAdapter,
    heartbeat: beeperHeartbeatAdapter,
    approvalCapability: beeperApprovalCapability,
    actions: beeperMessageActions,
    bindings: {
      selfParentConversationByDefault: true,
      compileConfiguredBinding: ({ conversationId }: { conversationId: string }) => ({ conversationId }),
      matchInboundConversation: ({ compiledBinding, conversationId }: { compiledBinding: { conversationId: string }; conversationId: string }) =>
        compiledBinding.conversationId === conversationId ? compiledBinding : null,
      resolveCommandConversation: ({ originatingTo, commandTo, fallbackTo }: {
        originatingTo?: string;
        commandTo?: string;
        fallbackTo?: string;
      }) => {
        const conversationId = commandTo ?? originatingTo ?? fallbackTo;
        return conversationId ? { conversationId } : null;
      },
    },
    gateway: {
      startAccount: startBeeperGatewayAccount,
      stopAccount: stopBeeperGatewayAccount,
    },
  },
  threading: { topLevelReplyToMode: "reply" },
  }),
  uiHints: BeeperChannelUiHints,
};

export type BeeperChannelPlugin = typeof beeperChannelPlugin;

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

function normalizeBeeperMessagingTarget(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .replace(/^beeper:/iu, "")
    .replace(/^agent:/iu, "")
    .replace(/^openclaw:/iu, "")
    .trim() || undefined;
}

function normalizeBeeperConversationId(raw: string | undefined): string | undefined {
  const normalized = normalizeBeeperMessagingTarget(raw);
  if (!normalized) return undefined;
  if (normalized.startsWith("room:")) return normalized.slice("room:".length) || undefined;
  return normalized;
}

function formatBeeperTargetDisplay(target: string): string {
  const normalized = normalizeBeeperMessagingTarget(target) ?? target;
  if (normalized.startsWith("@")) return normalized;
  if (normalized.startsWith("!")) return normalized;
  return `@${normalized}`;
}

function resolveBeeperRoomTarget(target: string): string {
  const normalized = normalizeBeeperConversationId(target);
  if (!normalized) throw new Error("Beeper target is required.");
  return normalized;
}

function beeperOutboundResult(sent: { eventId: string; roomId: string }): {
  channel: string;
  messageId: string;
  conversationId: string;
} {
  return {
    channel: BEEPER_CHANNEL_ID,
    conversationId: sent.roomId,
    messageId: sent.eventId,
  };
}

function beeperMessageSendResult(result: { messageId: string; conversationId?: string }): {
  messageId: string;
  receipt: {
    platformMessageIds: string[];
    parts: [];
    sentAt: number;
  };
  raw: unknown;
} {
  return {
    messageId: result.messageId,
    receipt: {
      platformMessageIds: [result.messageId],
      parts: [],
      sentAt: Date.now(),
    },
    raw: result,
  };
}

function firstPayloadText(payload: unknown): string | undefined {
  const record = recordValue(payload);
  return stringValue(record?.text)
    ?? stringValue(record?.body)
    ?? stringValue(record?.message)
    ?? stringValue(recordValue(record?.content)?.text);
}

function firstPayloadMediaUrl(payload: unknown): string | undefined {
  const record = recordValue(payload);
  const media = record?.media ?? record?.mediaUrl ?? record?.filePath ?? record?.path;
  if (typeof media === "string") return media;
  if (Array.isArray(media)) return media.find((item): item is string => typeof item === "string");
  return undefined;
}

function readRequiredString(params: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = stringValue(params[key]);
    if (value) return value;
  }
  throw new Error(`Missing required Beeper action parameter: ${keys.join(" or ")}`);
}

function stringifyOptional(value: string | number | null | undefined): string | undefined {
  return value == null ? undefined : String(value);
}

function listConfiguredAgentDirectoryEntries(
  cfg: OpenClawSetupConfig,
  query?: string | null,
  limit?: number | null,
): Array<{ kind: "user"; id: string; name?: string; handle?: string; raw?: unknown }> {
  const agents = recordValue(cfg)?.agents;
  const list = recordValue(agents)?.list;
  if (!Array.isArray(list)) return [];
  const normalizedQuery = query?.trim().toLowerCase();
  return list.flatMap((agent) => {
    const record = recordValue(agent);
    const id = stringValue(record?.id) ?? stringValue(record?.name);
    if (!id) return [];
    const name = stringValue(record?.displayName) ?? stringValue(record?.name) ?? id;
    const haystack = `${id} ${name}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return [];
    return [stripUndefined({
      handle: id,
      id,
      kind: "user" as const,
      name,
      raw: agent,
    })];
  }).slice(0, limit ?? 100);
}

function listLiveOrConfiguredAgentDirectoryEntries(
  cfg: OpenClawSetupConfig,
  query?: string | null,
  limit?: number | null,
): Array<{ kind: "user"; id: string; name?: string; handle?: string; avatarUrl?: string; description?: string; raw?: unknown }> {
  const runtimeAgents = (() => {
    try {
      return requireBeeperChannelRuntime().listAgents();
    } catch {
      return [];
    }
  })();
  if (runtimeAgents.length === 0) return listConfiguredAgentDirectoryEntries(cfg, query, limit);
  const normalizedQuery = query?.trim().toLowerCase();
  return runtimeAgents.flatMap((agent) => {
    const agentRecord = recordValue(agent);
    const id = agent.agentId ?? stringValue(agentRecord?.id);
    if (!id) return [];
    const name = agent.displayName ?? stringValue(agentRecord?.displayName) ?? stringValue(agentRecord?.name) ?? id;
    const avatarUrl = agent.avatarMxc ?? stringValue(agentRecord?.avatarMxc) ?? stringValue(agentRecord?.avatarUrl);
    const description = agent.description ?? stringValue(agentRecord?.description);
    const haystack = `${id} ${name} ${description ?? ""}`.toLowerCase();
    if (normalizedQuery && !haystack.includes(normalizedQuery)) return [];
    const entry = stripUndefined({
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(description ? { description } : {}),
      handle: id,
      id,
      kind: "user" as const,
      name,
      raw: agent,
    });
    return [entry];
  }).slice(0, limit ?? 100);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function startBeeperGatewayAccount(ctx: BeeperGatewayContext | ChannelGatewayContext<{ accountId: string; configured: boolean; settings: BeeperChannelSettings }>): Promise<void> {
  try {
    ctx.log?.info?.("Beeper bridge startup beginning.");
    const settings = getBeeperChannelSettings(ctx.cfg);
    if (settings.enabled === false) {
      ctx.log?.info?.("Beeper bridge is disabled; skipping startup.");
      return;
    }
    if (!isBeeperChannelConfigured(ctx.cfg)) {
      throw new Error("Beeper bridge is not fully configured; run Beeper channel setup first.");
    }
    const { accountFromOpenClawConfig, startOpenClawBeeperBridge } = await import("./appservice");
    const config = createConfigFromOpenClawSetup(ctx.cfg);
    const hostRuntime = resolveBeeperHostRuntime(ctx);
    const bridge = await startOpenClawBeeperBridge({
      account: accountFromOpenClawConfig(config),
      backfill: Boolean(config.importSources?.length),
      ...(config.backfillLimit !== undefined ? { backfillLimit: config.backfillLimit } : {}),
      config,
      dataDir: config.dataDir,
      log: bridgeLoggerFromChannelContext(ctx),
      ...(hostRuntime ? { runtime: hostRuntime } : {}),
    });
    const key = gatewayAccountKey(ctx.accountId);
    startedBridges.set(key, bridge as StartedBeeperBridge);
    ctx.setStatus?.({
      accountId: ctx.accountId,
      configured: true,
      enabled: true,
      running: true,
    });
    ctx.log?.info?.("Beeper bridge started.");
    try {
      await waitForAbort(ctx.abortSignal);
    } finally {
      startedBridges.delete(key);
      await bridge.stop?.();
      ctx.setStatus?.({
        accountId: ctx.accountId,
        running: false,
      });
      ctx.log?.info?.("Beeper bridge stopped.");
    }
  } catch (error) {
    ctx.log?.error?.(`Beeper bridge startup failed: ${formatStartupError(error)}`);
    throw error;
  }
}

function bridgeLoggerFromChannelContext(ctx: BeeperGatewayContext): BridgeLogger {
  return (level, message, data) => {
    const logger = level === "error" ? ctx.log?.error
      : level === "warn" ? ctx.log?.warn
        : ctx.log?.info;
    logger?.(data === undefined ? `[pickle-bridge] ${message}` : `[pickle-bridge] ${message} ${formatBridgeLogData(data)}`);
  };
}

function formatBridgeLogData(data: unknown): string {
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function formatStartupError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.stack ?? error.message;
}

function resolveBeeperHostRuntime(ctx: BeeperGatewayContext): OpenClawHostRuntime | undefined {
  if (ctx.hostRuntime && typeof ctx.hostRuntime === "object" && hasOpenClawSessionRuntime(ctx.hostRuntime)) return ctx.hostRuntime;
  if (ctx.runtime && typeof ctx.runtime === "object" && hasOpenClawSessionRuntime(ctx.runtime)) return ctx.runtime;
  return undefined;
}

function hasOpenClawSessionRuntime(value: object): value is OpenClawHostRuntime {
  const agent = (value as { agent?: unknown }).agent;
  if (!agent || typeof agent !== "object") return false;
  const session = (agent as { session?: unknown }).session;
  if (!session || typeof session !== "object") return false;
  return typeof (session as { listSessionEntries?: unknown }).listSessionEntries === "function"
    || typeof (session as { getSessionEntry?: unknown }).getSessionEntry === "function";
}

export async function stopBeeperGatewayAccount(ctx: BeeperGatewayContext | ChannelGatewayContext<{ accountId: string; configured: boolean; settings: BeeperChannelSettings }>): Promise<void> {
  const bridge = startedBridges.get(gatewayAccountKey(ctx.accountId));
  if (!bridge) return;
  startedBridges.delete(gatewayAccountKey(ctx.accountId));
  await bridge.stop?.();
  ctx.setStatus?.({
    accountId: ctx.accountId,
    running: false,
  });
}

export function getBeeperChannelSettings(cfg: OpenClawSetupConfig): BeeperChannelSettings {
  const channelSettings = recordValue(cfg.channels?.[BEEPER_CHANNEL_ID]);
  return (channelSettings as BeeperChannelSettings | undefined) ?? {};
}

export function isBeeperChannelConfigured(cfg: OpenClawSetupConfig): boolean {
  const settings = getBeeperChannelSettings(cfg);
  return Boolean(
    settings.enabled &&
    settings.accessToken &&
    settings.asToken &&
    settings.homeserver &&
    settings.hsToken &&
    settings.matrixDeviceId &&
    settings.matrixUserId
  );
}

export function applyBeeperChannelSettings(
  cfg: OpenClawSetupConfig,
  patch: Partial<BeeperChannelSettings>,
): OpenClawSetupConfig {
  const current = getBeeperChannelSettings(cfg);
  const nextSettings = {
    ...current,
    ...patch,
  };
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [BEEPER_CHANNEL_ID]: nextSettings,
    },
  };
}

export function defaultBeeperChannelSettings(): BeeperChannelSettings {
  return {
    approvalBehavior: "native",
    backfillLimit: 500,
    beeperEnv: "production",
    contactVisibility: "agents",
    dataDir: defaultDataDir(),
    enabled: true,
    importSources: ["dashboard", "tui"],
  };
}

export function validateBeeperSetupInput(input: BeeperSetupInput): string | null {
  if (input.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(input.email)) return "Beeper email must be a valid email address.";
  if (input.beeperEnv !== undefined && normalizeBeeperEnv(input.beeperEnv) === undefined) return "Beeper environment must be production, staging, dev, or local.";
  if (input.contactVisibility !== undefined && normalizeContactVisibility(input.contactVisibility) === undefined) return "Contact visibility must be agents, agents-and-users, or none.";
  if (input.approvalBehavior !== undefined && normalizeApprovalBehavior(input.approvalBehavior) === undefined) return "Approval behavior must be native or disabled.";
  const backfillLimit = normalizeOptionalNumber(input.backfillLimit);
  if (backfillLimit !== undefined && (!Number.isInteger(backfillLimit) || backfillLimit < 0)) return "Backfill limit must be a non-negative integer.";
  return null;
}

export function normalizeBeeperSetupInput(input: BeeperSetupInput): Partial<BeeperChannelSettings> {
  const settings: Partial<BeeperChannelSettings> = { enabled: true };
  const allowedRoomIds = normalizeStringList(input.allowedRoomIds);
  const allowedUserIds = normalizeStringList(input.allowedUserIds);
  const approvalBehavior = normalizeApprovalBehavior(input.approvalBehavior);
  const backfillLimit = normalizeOptionalNumber(input.backfillLimit);
  const beeperEnv = normalizeBeeperEnv(input.beeperEnv);
  const contactVisibility = normalizeContactVisibility(input.contactVisibility);
  const importSources = normalizeImportSources(input.importSources);
  if (input.accessToken) settings.accessToken = input.accessToken;
  if (input.appserviceId) settings.appserviceId = input.appserviceId;
  if (input.asToken) settings.asToken = input.asToken;
  if (allowedRoomIds) settings.allowedRoomIds = allowedRoomIds;
  if (allowedUserIds) settings.allowedUserIds = allowedUserIds;
  if (approvalBehavior) settings.approvalBehavior = approvalBehavior;
  if (backfillLimit !== undefined) settings.backfillLimit = backfillLimit;
  if (beeperEnv) settings.beeperEnv = beeperEnv;
  if (contactVisibility) settings.contactVisibility = contactVisibility;
  if (input.bridgeManagerToken) settings.bridgeManagerToken = input.bridgeManagerToken;
  if (input.bridgeId) settings.bridgeId = input.bridgeId;
  if (input.dataDir) settings.dataDir = input.dataDir;
  if (input.homeserverDomain) settings.homeserverDomain = input.homeserverDomain;
  if (importSources) settings.importSources = importSources;
  return settings;
}

export function setupOptionsFromInput(input: BeeperSetupInput): SetupOpenClawBeeperBridgeOptions {
  if (!input.email) throw new Error("Beeper email is required for dashboard login setup");
  const options: SetupOpenClawBeeperBridgeOptions = {
    email: input.email,
  };
  const env = normalizeBeeperEnv(input.beeperEnv);
  const getOnly = normalizeOptionalBoolean(input.getOnly);
  const push = normalizeOptionalBoolean(input.push);
  const selfHosted = normalizeOptionalBoolean(input.selfHosted);
  if (env) options.env = env;
  if (input.bridgeManagerToken) options.bridgeManagerToken = input.bridgeManagerToken;
  if (input.code) options.getLoginCode = () => input.code!;
  if (getOnly !== undefined) options.getOnly = getOnly;
  if (input.homeserverDomain) options.homeserverDomain = input.homeserverDomain;
  if (push !== undefined) options.push = push;
  if (selfHosted !== undefined) options.selfHosted = selfHosted;
  if (input.username) options.username = input.username;
  return options;
}

function normalizeImportSources(value: string[] | string | undefined): BeeperImportSource[] | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value : value.split(",");
  const sources = raw.map((entry) => entry.trim()).filter(Boolean);
  if (sources.every(isImportSource)) return [...new Set(sources)];
  return undefined;
}

function normalizeStringList(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const entries = (Array.isArray(value) ? value : value.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? [...new Set(entries)] : undefined;
}

function isImportSource(value: string): value is BeeperImportSource {
  return value === "dashboard" || value === "tui" || value === "channels" || value === "archived";
}

function normalizeBeeperEnv(value: string | undefined): BeeperChannelSettings["beeperEnv"] | undefined {
  if (value === "production" || value === "staging" || value === "dev" || value === "local") return value;
  return undefined;
}

function setupBeeperBaseDomain(env: BeeperChannelSettings["beeperEnv"]): string | undefined {
  if (env === undefined || env === "production") return undefined;
  if (env === "dev") return "beeper-dev.com";
  if (env === "local") return "beeper.localtest.me";
  return "beeper-staging.com";
}

function beeperSetupRuntime(value: unknown): BeeperSetupRuntime | undefined {
  const record = recordValue(value);
  if (typeof record?.setupBridge !== "function") return undefined;
  const setupBridge = record.setupBridge as NonNullable<BeeperSetupRuntime["setupBridge"]>;
  return { setupBridge };
}

function gatewayAccountKey(accountId: string): string {
  return accountId || "default";
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function normalizeContactVisibility(value: string | undefined): BeeperChannelSettings["contactVisibility"] | undefined {
  if (value === "agents" || value === "agents-and-users" || value === "none") return value;
  return undefined;
}

function normalizeApprovalBehavior(value: string | undefined): BeeperChannelSettings["approvalBehavior"] | undefined {
  if (value === "native" || value === "disabled") return value;
  return undefined;
}

function normalizeOptionalNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalBoolean(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === "") return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
