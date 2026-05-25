import {
  randomUUID,
} from "node:crypto";
import {
  createRemoteMessage,
  type BackfillingNetworkAPI,
  BridgeConnector,
  BridgeContext,
  BridgeRequestContext,
  BridgeUser,
  ConnectContext,
  type ContactListingNetworkAPI,
  FetchMessagesParams,
  FetchMessagesResponse,
  type EditHandlingNetworkAPI,
  IdentifierResolvingNetworkAPI,
  type ListContactsParams,
  type ListContactsResponse,
  LoginCreateContext,
  LoginFlow,
  LoginProcess,
  LoadUserLoginContext,
  MatrixEdit,
  MatrixMessage,
  MatrixMessageResponse,
  MatrixReaction,
  MatrixReactionRemove,
  MatrixRedaction,
  MatrixReadReceipt,
  MatrixMarkedUnread,
  MatrixDeleteChat,
  MatrixMembership,
  MatrixRoomAvatar,
  MatrixRoomName,
  MatrixRoomTopic,
  MatrixTyping,
  MessageHandlingNetworkAPI,
  type DeleteChatHandlingNetworkAPI,
  type MarkedUnreadHandlingNetworkAPI,
  type MembershipHandlingNetworkAPI,
  NetworkAPI,
  NetworkGeneralCapabilities,
  Portal,
  type PortalKey,
  ReactionHandlingNetworkAPI,
  type ReadReceiptHandlingNetworkAPI,
  type ReactionRemoveHandlingNetworkAPI,
  type RedactionHandlingNetworkAPI,
  type RoomAvatarHandlingNetworkAPI,
  type RoomNameHandlingNetworkAPI,
  type RoomTopicHandlingNetworkAPI,
  type TypingHandlingNetworkAPI,
  Reaction,
  ResolveIdentifierParams,
  ResolveIdentifierResponse,
  UserLogin,
} from "@beeper/pickle-bridge";
import { backfillAllOpenClawSessions, buildBackfillImport, discoverOneToOneSessions } from "./backfill";
import { parseApprovalReactionContent, parseApprovalResponseContent } from "./approval";
import { BeeperChannelRuntime, setBeeperChannelRuntime } from "./beeper-channel-runtime";
import { agentPortalSessionKey, OpenClawMatrixBridgeAgent } from "./bridge-agent";
import { createDefaultConfig } from "./config";
import { parseMatrixTextMessage, type ParsedMatrixTextMessage } from "./matrix-parser";
import { createOpenClawHostTransport, OpenClawGatewayRuntime, type OpenClawHostRuntime, type OpenClawMatrixMessageMetadata } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";
import { agentContactFromOpenClawAgent, agentGhostUserId, serviceBotUserId } from "./rooms";
import type { OpenClawAgentContact, OpenClawBridgeConfig, OpenClawSessionBinding, OpenClawUserContact } from "./types";

const DEFAULT_NEW_SESSION_LABEL = "New OpenClaw Session";

export interface OpenClawConnectorOptions {
  config?: OpenClawBridgeConfig;
  registry?: OpenClawBridgeRegistry;
  runtime?: OpenClawGatewayRuntime | OpenClawHostRuntime;
  runtimeFactory?: (config: OpenClawBridgeConfig) => OpenClawGatewayRuntime;
}

export function createOpenClawConnector(options: OpenClawConnectorOptions = {}): OpenClawBridgeConnector {
  return new OpenClawBridgeConnector(options);
}

export class OpenClawBridgeConnector implements BridgeConnector<OpenClawBridgeConfig> {
  readonly config: OpenClawBridgeConfig;
  readonly registry: OpenClawBridgeRegistry;
  readonly runtime: OpenClawGatewayRuntime | undefined;
  #runtimeFactory: (config: OpenClawBridgeConfig) => OpenClawGatewayRuntime;

  constructor(options: OpenClawConnectorOptions = {}) {
    this.config = options.config ?? createDefaultConfig();
    this.registry = options.registry ?? new OpenClawBridgeRegistry();
    const runtime = options.runtime instanceof OpenClawGatewayRuntime
      ? options.runtime
      : options.runtime
        ? new OpenClawGatewayRuntime({ config: this.config, transport: createOpenClawHostTransport(options.runtime) })
        : undefined;
    this.runtime = runtime;
    this.#runtimeFactory =
      options.runtimeFactory ??
      ((config) => {
        if (runtime) return runtime;
        throw new Error("OpenClaw direct plugin runtime is required");
      });
  }

  getName() {
    return {
      beeperBridgeType: "openclaw",
      defaultCommandPrefix: "!openclaw",
      displayName: "OpenClaw",
      networkId: "openclaw",
      networkUrl: "https://github.com/openclaw/openclaw",
    };
  }

  getBridgeInfoVersion() {
    return { capabilities: 1, info: 1 };
  }

  getConfig() {
    return { data: this.config };
  }

  getDBMetaTypes() {
    return {
      ghost: () => ({}),
      portal: () => ({}),
      userLogin: () => ({}),
    };
  }

  getCapabilities(): NetworkGeneralCapabilities {
    return {
      native: true,
      provisioning: {
        resolveIdentifier: {
          contactList: true,
          createDM: true,
          lookupUsername: true,
        },
      },
    };
  }

  getLoginFlows(): LoginFlow[] {
    return [];
  }

  async init(ctx: BridgeContext): Promise<void> {
    await this.registry.load();
    const ownUserId = ctx.bridge.getOwnUserId();
    const login = userLoginFromOpenClawConfig(this.config);
    setBeeperChannelRuntime(new BeeperChannelRuntime({
      bridge: ctx.bridge,
      client: ctx.client,
      getAgents: () => this.registry.data.agents,
      getBindingByRoom: (roomId) => this.registry.getBindingByRoom(roomId),
      getBindingBySessionKey: (sessionKey) => this.registry.getBindingBySessionKey(sessionKey),
      login,
      log: (level, message, data) => ctx.log(level, message, data),
      ...(ownUserId ? { userId: ownUserId } : {}),
    }));
  }

  async start(ctx: BridgeContext): Promise<void> {
    await this.registry.save();
    const login = userLoginFromOpenClawConfig(this.config);
    try {
      await ctx.bridge.loadUserLogin(login);
    } catch (error: unknown) {
      ctx.log("warn", "openclaw_default_login_load_failed", { error, loginId: login.id });
    }
  }

  createLogin(_ctx: LoginCreateContext, _user: BridgeUser, flowId: string): LoginProcess {
    throw new Error(`Unsupported OpenClaw login flow in direct plugin mode: ${flowId}`);
  }

  loadUserLogin(_ctx: LoadUserLoginContext, login: UserLogin): NetworkAPI {
    return new OpenClawNetworkAPI({
      config: this.config,
      login,
      registry: this.registry,
      runtime: this.#runtimeFactory(this.config),
    });
  }
}

export class OpenClawNetworkAPI implements NetworkAPI, IdentifierResolvingNetworkAPI, ContactListingNetworkAPI, MessageHandlingNetworkAPI, EditHandlingNetworkAPI, ReactionHandlingNetworkAPI, ReactionRemoveHandlingNetworkAPI, RedactionHandlingNetworkAPI, ReadReceiptHandlingNetworkAPI, MarkedUnreadHandlingNetworkAPI, TypingHandlingNetworkAPI, RoomNameHandlingNetworkAPI, RoomTopicHandlingNetworkAPI, RoomAvatarHandlingNetworkAPI, MembershipHandlingNetworkAPI, DeleteChatHandlingNetworkAPI, BackfillingNetworkAPI {
  readonly #agent: OpenClawMatrixBridgeAgent;
  readonly #config: OpenClawBridgeConfig;
  readonly #login: UserLogin;
  readonly #registry: OpenClawBridgeRegistry;
  readonly #runtime: OpenClawGatewayRuntime;

  constructor(options: {
    config: OpenClawBridgeConfig;
    login: UserLogin;
    registry: OpenClawBridgeRegistry;
    runtime: OpenClawGatewayRuntime;
  }) {
    this.#config = options.config;
    this.#login = options.login;
    this.#registry = options.registry;
    this.#runtime = options.runtime;
    this.#agent = new OpenClawMatrixBridgeAgent({
      registry: options.registry,
      runtime: options.runtime,
    });
  }

  async connect(ctx: ConnectContext): Promise<void> {
    await this.#agent.syncAgentContacts();
    const contactVisibility = this.#runtime.config.contactVisibility ?? "agents";
    if (contactVisibility !== "none") {
      for (const contact of this.#registry.data.agents) {
        ctx.bridge.registerGhost({
          displayName: contact.displayName,
          id: contact.agentId,
          metadata: { openclaw: contact },
          mxid: contact.ghostUserId,
        });
      }
    }
    if (contactVisibility === "agents-and-users") {
      for (const contact of this.#registry.data.users) {
        ctx.bridge.registerGhost({
          displayName: contact.displayName,
          id: contact.userId,
          metadata: { openclaw: contact },
          mxid: contact.ghostUserId,
        });
      }
    }
  }

  async disconnect(): Promise<void> {
    await this.#runtime.close();
  }

  async resolveIdentifier(ctx: BridgeRequestContext, params: ResolveIdentifierParams): Promise<ResolveIdentifierResponse> {
    await this.#agent.syncAgentContacts();
    const contact = findAgentContact(this.#registry.data.agents, params.identifier);
    if (!contact) return {};
    let portal = params.createDM
      ? await this.createSessionPortalForAgent(ctx, contact)
      : undefined;
    if (portal && params.createDM && !portal.mxid) {
      const portalOptions: Parameters<typeof ctx.bridge.createPortal>[1] = {
        id: portal.id,
        metadata: portal.metadata,
        name: contact.displayName,
        roomType: "dm",
      };
      const creationContent = openClawPortalCreationContent(this.#runtime.config);
      if (creationContent) portalOptions.creationContent = creationContent;
      const created = await ctx.bridge.createPortal(this.#login, portalOptions);
      const nextPortal: Portal = {
        ...portal,
        ...created,
        metadata: created.metadata ?? portal.metadata,
        portalKey: created.portalKey ?? portal.portalKey,
      };
      const receiver = created.receiver ?? portal.receiver;
      if (receiver !== undefined) nextPortal.receiver = receiver;
      portal = nextPortal;
      this.upsertPortalBinding(portal);
      await this.#registry.save();
    }
    return contactResponse(contact, portal);
  }

  async listContacts(_ctx: BridgeRequestContext, params: ListContactsParams = {}): Promise<ListContactsResponse> {
    await this.#agent.syncAgentContacts();
    const contactVisibility = this.#runtime.config.contactVisibility ?? "agents";
    if (contactVisibility === "none") return { contacts: [] };
    const query = params.query?.trim().toLowerCase();
    const contacts = [
      ...this.#registry.data.agents.map((contact) => ({
        response: contactResponse(contact),
        text: `${contact.agentId} ${contact.displayName}`.toLowerCase(),
      })),
      ...(contactVisibility === "agents-and-users"
        ? this.#registry.data.users.map((contact) => ({
            response: userContactResponse(contact),
            text: `${contact.userId} ${contact.displayName} ${contact.source ?? ""}`.toLowerCase(),
          }))
        : []),
    ]
      .filter((contact) => !query || contact.text.includes(query))
      .slice(0, params.limit ?? 100)
      .map((contact) => contact.response);
    return { contacts };
  }

  async handleMatrixMessage(ctx: BridgeRequestContext, msg: MatrixMessage): Promise<MatrixMessageResponse> {
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, msg.sender.userId)) {
      this.logRejectedMatrixIngress(ctx, "message", msg.portal.mxid, msg.sender.userId);
      return { pending: false };
    }
    const binding = bindingFromPortal(msg.portal, this.#runtime.config);
    if (binding && !this.#registry.getBindingByRoom(msg.portal.mxid ?? "")) this.#registry.upsertBinding(binding);
    let currentBinding = msg.portal.mxid ? this.#registry.getBindingByRoom(msg.portal.mxid) ?? binding : binding;
    const approval = parseApprovalResponseContent(msg.content);
    if (approval) {
      if (approvalNativeEnabled(this.#runtime.config)) {
        await this.#agent.handleApprovalContent(msg.content, approval.approvalId ?? approvalIdFromMatrixReply(msg));
      }
      return { pending: false };
    }
    const parsed = parseMatrixTextMessage(msg.text, msg.content, msg);
    if (msg.portal.mxid) {
      if (parsed.command?.name === "stop" || parsed.command?.name === "abort") {
        const abortOptions: { runId?: string; sessionKey?: string } = {};
        if (currentBinding?.lastRunId) abortOptions.runId = currentBinding.lastRunId;
        if (currentBinding?.sessionKey) abortOptions.sessionKey = currentBinding.sessionKey;
        await this.#runtime.abortSession(abortOptions);
        return { pending: false };
      }
      if (currentBinding) this.registerCanonicalPortalForBinding(ctx, msg.portal, currentBinding);
      if (parsed.command) {
        return await this.handleSlashCommand(ctx, parsed.command, currentBinding, msg);
      }
      if (!currentBinding) {
        ctx.log?.("warn", "openclaw_matrix_message_unbound_room", {
          portalId: msg.portal.id,
          portalKey: msg.portal.portalKey,
          roomId: msg.portal.mxid,
        });
        currentBinding = await this.createBindingForMatrixRoom(msg.portal.mxid, DEFAULT_NEW_SESSION_LABEL);
        ctx.log?.("info", "openclaw_matrix_message_bound_room", {
          agentId: currentBinding.agentId,
          roomId: msg.portal.mxid,
          sessionKey: currentBinding.sessionKey,
        });
      }
      this.registerCanonicalPortalForBinding(ctx, msg.portal, currentBinding);
      ctx.log?.("info", "openclaw_matrix_message_dispatching", {
        eventId: msg.event.eventId,
        roomId: msg.portal.mxid,
        sessionKey: currentBinding.sessionKey,
      });
      await this.#agent.handleMatrixText({
        ...(parsed.attachments.length > 0 ? { attachments: parsed.attachments } : {}),
        eventId: msg.event.eventId,
        matrix: matrixMetadataFromParsed(parsed, msg.sender.userId, streamTargetRelationPatch(currentBinding, parsed.replyToEventId)),
        roomId: msg.portal.mxid,
        ...(parsed.replyToEventId ? { replyToEventId: parsed.replyToEventId } : {}),
        sender: msg.sender.userId,
        text: parsed.text,
      });
      ctx.log?.("info", "openclaw_matrix_message_dispatched", {
        eventId: msg.event.eventId,
        lastRunId: this.#registry.getBindingByRoom(msg.portal.mxid)?.lastRunId,
        roomId: msg.portal.mxid,
        sessionKey: this.#registry.getBindingByRoom(msg.portal.mxid)?.sessionKey,
      });
    }
    return { pending: false };
  }

  async handleMatrixEdit(_ctx: BridgeRequestContext, msg: MatrixEdit): Promise<MatrixMessageResponse> {
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, msg.sender.userId)) return { pending: false };
    this.upsertPortalBinding(msg.portal);
    const parsed = parseMatrixTextMessage(msg.text, msg.content, msg);
    const targetId = msg.targetMessage.id;
    const binding = msg.portal.mxid ? this.#registry.getBindingByRoom(msg.portal.mxid) : undefined;
    if (msg.portal.mxid) {
      await this.#agent.handleMatrixText({
        ...(parsed.attachments.length > 0 ? { attachments: parsed.attachments } : {}),
        eventId: `${msg.event.eventId}:edit`,
        matrix: matrixMetadataFromParsed(parsed, msg.sender.userId, {
          kind: "edit",
          targetEventId: targetId,
          ...streamTargetRelationPatch(binding, targetId),
        }),
        roomId: msg.portal.mxid,
        replyToEventId: targetId,
        sender: msg.sender.userId,
        text: parsed.text,
      });
    }
    return { pending: false };
  }

  async handleMatrixReaction(_ctx: BridgeRequestContext, msg: MatrixReaction): Promise<Reaction | null> {
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, senderUserId(msg.event.sender))) return null;
    const approval = parseApprovalResponseContent(msg.content);
    if (approval) {
      if (!approvalReactionsEnabled(this.#runtime.config)) {
        return { id: msg.event.eventId, metadata: { openclaw: { approval, ignored: "approval-reactions-disabled" } } };
      }
      await this.#agent.handleApprovalContent(msg.content, approval.approvalId ?? msg.targetMessage.id);
      return { id: msg.event.eventId, metadata: { openclaw: { approval } } };
    }
    const approvalReaction = parseApprovalReactionContent(msg.content);
    if (approvalReaction) {
      return { id: msg.event.eventId, metadata: { openclaw: { approval: approvalReaction, ignored: "approval-reactions-disabled" } } };
    }
    const reactionKey = matrixReactionKey(msg.content);
    if (!reactionKey || !msg.portal.mxid) return null;
    this.upsertPortalBinding(msg.portal);
    const binding = this.#registry.getBindingByRoom(msg.portal.mxid);
    await this.#agent.handleMatrixText({
      eventId: msg.event.eventId,
      matrix: {
        relation: {
          key: reactionKey,
          kind: "reaction",
          targetEventId: msg.targetMessage.id,
          ...streamTargetRelationPatch(binding, msg.targetMessage.id),
        },
        sender: senderUserId(msg.event.sender) ?? "reaction",
      },
      roomId: msg.portal.mxid,
      replyToEventId: msg.targetMessage.id,
      sender: senderUserId(msg.event.sender) ?? "reaction",
      text: `Reacted ${reactionKey} to ${msg.targetMessage.id}`,
    });
    return { id: msg.event.eventId, metadata: { openclaw: { reaction: reactionKey, targetMessageId: msg.targetMessage.id } } };
  }

  async handleMatrixReactionRemove(_ctx: BridgeRequestContext, msg: MatrixReactionRemove): Promise<void> {
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, senderUserId(msg.event.sender))) return;
    const reactionKey = matrixReactionKey(msg.content);
    if (!msg.portal.mxid) return;
    this.upsertPortalBinding(msg.portal);
    const binding = this.#registry.getBindingByRoom(msg.portal.mxid);
    await this.#agent.handleMatrixText({
      eventId: msg.event.eventId,
      matrix: {
        relation: {
          ...(reactionKey ? { key: reactionKey } : {}),
          kind: "reaction_remove",
          targetEventId: msg.targetMessage.id,
          ...(msg.targetReaction.id ? { targetReactionId: msg.targetReaction.id } : {}),
          ...streamTargetRelationPatch(binding, msg.targetMessage.id),
        },
        sender: senderUserId(msg.event.sender) ?? "reaction",
      },
      roomId: msg.portal.mxid,
      replyToEventId: msg.targetMessage.id,
      sender: senderUserId(msg.event.sender) ?? "reaction",
      text: reactionKey
        ? `Removed reaction ${reactionKey} from ${msg.targetMessage.id}`
        : `Removed reaction from ${msg.targetMessage.id}`,
    });
  }

  async handleMatrixRedaction(_ctx: BridgeRequestContext, msg: MatrixRedaction): Promise<void> {
    if (!msg.portal.mxid) return;
    if (!this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
    const binding = this.#registry.getBindingByRoom(msg.portal.mxid);
    await this.#agent.handleMatrixText({
      eventId: msg.eventId,
      matrix: {
        relation: {
          kind: "redaction",
          ...(msg.targetMessage?.id ? { targetEventId: msg.targetMessage.id } : {}),
          ...streamTargetRelationPatch(binding, msg.targetMessage?.id),
        },
        sender: "redaction",
      },
      roomId: msg.portal.mxid,
      ...(msg.targetMessage?.id ? { replyToEventId: msg.targetMessage.id } : {}),
      sender: "redaction",
      text: msg.targetMessage?.id ? `Redacted message ${msg.targetMessage.id}` : "Redacted a Matrix event",
    });
  }

  async handleMatrixReadReceipt(_ctx: BridgeRequestContext, msg: MatrixReadReceipt): Promise<void> {
    if (!msg.portal.mxid) return;
    if (!this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
    const binding = this.#registry.getBindingByRoom(msg.portal.mxid);
    await this.#agent.handleMatrixText({
      eventId: `${msg.targetMessage.id}:read:${msg.userId ?? "unknown"}`,
      matrix: {
        relation: {
          kind: "read_receipt",
          ...(msg.receiptType ? { receiptType: msg.receiptType } : {}),
          targetEventId: msg.targetMessage.id,
          ...streamTargetRelationPatch(binding, msg.targetMessage.id),
        },
        sender: msg.userId ?? "receipt",
      },
      roomId: msg.portal.mxid,
      replyToEventId: msg.targetMessage.id,
      sender: msg.userId ?? "receipt",
      text: `Read receipt for ${msg.targetMessage.id}`,
    });
  }

  async handleMatrixMarkedUnread(_ctx: BridgeRequestContext, msg: MatrixMarkedUnread): Promise<void> {
    if (!msg.portal.mxid) return;
    if (!this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
    const eventId = `${msg.portal.mxid}:marked-unread:${msg.unread ? "1" : "0"}:${Date.now()}`;
    await this.#agent.handleMatrixText({
      eventId,
      matrix: {
        relation: {
          kind: "marked_unread",
          unread: msg.unread,
        },
        sender: msg.userId ?? "marked_unread",
      },
      roomId: msg.portal.mxid,
      sender: msg.userId ?? "marked_unread",
      text: msg.unread ? "Marked room unread" : "Unmarked room unread",
    });
  }

  async handleMatrixTyping(_ctx: BridgeRequestContext, msg: MatrixTyping): Promise<void> {
    if (!msg.portal.mxid) return;
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, msg.userId)) return;
    this.upsertPortalBinding(msg.portal);
  }

  async handleMatrixRoomName(_ctx: BridgeRequestContext, msg: MatrixRoomName): Promise<void> {
    const roomId = msg.portal.mxid;
    const binding = roomId ? this.#registry.getBindingByRoom(roomId) ?? bindingFromPortal(msg.portal, this.#runtime.config) : undefined;
    if (!roomId || !binding || !msg.name) return;
    this.#registry.upsertBinding({ ...binding, label: msg.name, updatedAt: Date.now() });
    await this.#registry.save();
  }

  async handleMatrixRoomTopic(_ctx: BridgeRequestContext, msg: MatrixRoomTopic): Promise<void> {
    if (!msg.portal.mxid || !this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
  }

  async handleMatrixRoomAvatar(_ctx: BridgeRequestContext, msg: MatrixRoomAvatar): Promise<void> {
    if (!msg.portal.mxid || !this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
  }

  async handleMatrixMembership(_ctx: BridgeRequestContext, msg: MatrixMembership): Promise<void> {
    if (!msg.portal.mxid || !this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
  }

  async handleMatrixDeleteChat(_ctx: BridgeRequestContext, msg: MatrixDeleteChat): Promise<void> {
    if (!msg.portal.mxid || !this.isAllowedRoom(msg.portal.mxid)) return;
    this.#registry.removeBindingByRoom(msg.portal.mxid);
    await this.#registry.save();
  }

  async fetchMessages(_ctx: BridgeRequestContext, params: FetchMessagesParams): Promise<FetchMessagesResponse> {
    const binding = bindingFromPortal(params.portal, this.#runtime.config);
    if (!this.isAllowedRoom(binding?.roomId ?? params.portal.mxid)) return { hasMore: false, messages: [] };
    if (!binding) return { hasMore: false, messages: [] };
    const importOptions: { limit?: number; roomId: string } = { roomId: binding.roomId };
    const limit = params.limit ?? params.count;
    if (limit !== undefined) importOptions.limit = limit;
    const sessionOptions: Parameters<typeof buildBackfillImport>[2] = {
      agentId: binding.agentId,
      label: binding.label ?? binding.sessionKey,
      session: { key: binding.sessionKey },
      sessionKey: binding.sessionKey,
      source: binding.owner === "imported" ? "unknown" : "channel",
    };
    if (binding.humanGhostUserId) {
      sessionOptions.human = {
        displayName: binding.humanGhostUserId,
        ghostUserId: binding.humanGhostUserId,
        userId: binding.humanGhostUserId,
      };
    }
    const backfill = await buildBackfillImport(this.#runtime, this.#runtime.config, sessionOptions, importOptions);
    if (backfill.human) this.#registry.upsertUser(backfill.human);
    return {
      hasMore: false,
      messages: backfill.messages.map((message) => ({
        event: createRemoteMessage({
          convert: () => ({
            parts: [{ content: message.content, id: message.id, type: "m.text" }],
          }),
          data: message,
          id: message.id,
          portalKey: params.portal.portalKey,
          sender: {
            isFromMe: message.sender === "agent",
            sender: backfillSenderUserId(this.#runtime.config, binding, message.sender),
          },
          timestamp: message.timestamp ?? new Date(0),
        }),
      })),
    };
  }

  async handleSlashCommand(
    ctx: BridgeRequestContext,
    command: NonNullable<ParsedMatrixTextMessage["command"]>,
    binding: OpenClawSessionBinding | undefined,
    msg: MatrixMessage,
  ): Promise<MatrixMessageResponse> {
    const notice = (text: string, noticeBinding = binding) =>
      commandNotice(ctx, this.#login, msg, text, canonicalPortalKeyForBinding(noticeBinding, this.#login.id) ?? msg.portal.portalKey);
    switch (command.name) {
      case "status":
        return notice(bridgeStatusText(this.#runtime.config, this.#registry.data.bindings.length));
      case "settings":
        return notice(bridgeSettingsText(this.#runtime.config, this.#registry.data.bindings.length));
      case "sessions": {
        const options: Parameters<typeof discoverOneToOneSessions>[1] = {};
        if (this.#runtime.config.importSources !== undefined) options.importSources = this.#runtime.config.importSources;
        const sessions = await discoverOneToOneSessions(this.#runtime, options);
        return notice(sessionsSummaryText(sessions));
      }
      case "backfill":
        const count = await this.backfillCurrentRoom(ctx, binding, msg);
        return notice(`Queued backfill for ${count} message${count === 1 ? "" : "s"}.`);
      case "import": {
        const importOptions: Parameters<typeof backfillAllOpenClawSessions>[0] = {
          bridge: ctx.bridge,
          login: this.#login,
          registry: this.#registry,
          runtime: this.#runtime,
        };
        if (this.#runtime.config.importSources !== undefined) importOptions.importSources = this.#runtime.config.importSources;
        if (this.#runtime.config.backfillLimit !== undefined) importOptions.limit = this.#runtime.config.backfillLimit;
        const result = await backfillAllOpenClawSessions(importOptions);
        return notice(importSummaryText(result));
      }
      case "new": {
        const request = this.resolveNewSessionCommand(command.args, binding);
        if (!request) {
          return notice("Usage: /new [agent-id] [session label]. In an agent DM, /new [session label] is enough.");
        }
        if (!binding && msg.portal.mxid) {
          const created = await this.createBindingForMatrixRoom(msg.portal.mxid, request.label, request.agentId, request.ghostUserId);
          this.registerCanonicalPortalForBinding(ctx, msg.portal, created);
          return notice(`Created a new OpenClaw session in this room: ${created.sessionKey}`, created);
        }
        const session = await this.#runtime.createSession({
          agentId: request.agentId,
          key: newBeeperSessionKey(request.agentId),
          label: request.label,
        });
        const portalOptions: Parameters<typeof ctx.bridge.createPortal>[1] = {
          id: portalIdForSession(session.key),
          metadata: {
            openclaw: stripUndefined({
              agentId: request.agentId,
              ghostUserId: request.ghostUserId,
              sessionKey: session.key,
            }),
          },
          name: request.label,
          roomType: "dm",
        };
        const creationContent = openClawPortalCreationContent(this.#runtime.config);
        if (creationContent) portalOptions.creationContent = creationContent;
        const portal = await ctx.bridge.createPortal(this.#login, portalOptions);
        if (portal.mxid) {
          this.#registry.upsertBinding({
            agentId: request.agentId,
            createdAt: Date.now(),
            ghostUserId: request.ghostUserId,
            id: Buffer.from(portal.mxid).toString("base64url"),
            kind: "session",
            label: request.label,
            owner: "bridge",
            roomId: portal.mxid,
            sessionKey: session.key,
            updatedAt: Date.now(),
          });
        }
        await this.#registry.save();
        return notice(portal.mxid
          ? `Created a new OpenClaw session room: ${portal.mxid}`
          : `Created a new OpenClaw session: ${session.key}`);
      }
      case "approve":
      case "deny": {
        if (!approvalSlashEnabled(this.#runtime.config)) {
          return notice("Approval slash commands are disabled for this bridge.");
        }
        const approvalId = command.args.trim() || approvalIdFromMatrixReply(msg);
        if (!approvalId) return notice(`Usage: /${command.name} <approval-id> or reply to an approval message with /${command.name}`);
        await this.#agent.handleApprovalContent({
          approvalId,
          approved: command.name === "approve",
          approvedAlways: false,
          type: "tool-approval-response",
        }, approvalId);
        return notice(`${command.name === "approve" ? "Approved" : "Denied"} ${approvalId}.`);
      }
      case "agent":
        return notice(binding ? `Agent: ${binding.agentId}` : "This room is not bound to an OpenClaw agent yet.");
      default:
        return notice(`Unknown OpenClaw command: /${command.name}`);
    }
  }

  async backfillCurrentRoom(ctx: BridgeRequestContext, binding: OpenClawSessionBinding | undefined, msg: MatrixMessage): Promise<number> {
    const roomId = msg.portal.mxid;
    if (!binding || !roomId) return 0;
    const importOptions: { limit?: number; roomId: string } = { roomId };
    if (this.#runtime.config.backfillLimit !== undefined) importOptions.limit = this.#runtime.config.backfillLimit;
    const imported = await buildBackfillImport(this.#runtime, this.#runtime.config, {
      agentId: binding.agentId,
      label: binding.label ?? binding.sessionKey,
      session: { key: binding.sessionKey },
      sessionKey: binding.sessionKey,
      source: binding.owner === "imported" ? "unknown" : "channel",
    }, importOptions);
    if (imported.human) this.#registry.upsertUser(imported.human);
    this.#registry.upsertBinding(imported.binding);
    const backfillOptions: { limit?: number } = {};
    if (this.#runtime.config.backfillLimit !== undefined) backfillOptions.limit = this.#runtime.config.backfillLimit;
    await ctx.bridge.backfillPortal(this.#login, msg.portal, backfillOptions);
    await this.#registry.save();
    return imported.messages.length;
  }

  isAllowedMatrixIngress(roomId: string | undefined, sender: string | undefined): boolean {
    if (!this.isAllowedRoom(roomId)) return false;
    if (!this.isAllowedUser(sender)) return false;
    if (sender && this.isBridgeOwnedSender(sender)) return false;
    return true;
  }

  isAllowedRoom(roomId: string | undefined): boolean {
    return !this.#config.allowedRoomIds?.length || Boolean(roomId && this.#config.allowedRoomIds.includes(roomId));
  }

  isAllowedUser(sender: string | undefined): boolean {
    return !this.#config.allowedUserIds?.length || Boolean(sender && this.#config.allowedUserIds.includes(sender));
  }

  isBridgeOwnedSender(sender: string): boolean {
    return sender === serviceBotUserId(this.#config)
      || this.#registry.data.agents.some((contact) => contact.ghostUserId === sender)
      || this.#registry.data.users.some((contact) => contact.ghostUserId === sender);
  }

  logRejectedMatrixIngress(ctx: BridgeRequestContext, kind: string, roomId: string | undefined, sender: string | undefined): void {
    ctx.log?.("warn", "openclaw_matrix_ingress_rejected", {
      allowedRoomCount: this.#config.allowedRoomIds?.length ?? 0,
      allowedUserCount: this.#config.allowedUserIds?.length ?? 0,
      bridgeOwned: sender ? this.isBridgeOwnedSender(sender) : false,
      kind,
      roomId,
      sender,
    });
  }

  private upsertPortalBinding(portal: Portal): void {
    const binding = bindingFromPortal(portal, this.#runtime.config);
    if (binding && !this.#registry.getBindingByRoom(portal.mxid ?? "")) this.#registry.upsertBinding(binding);
  }

  private registerCanonicalPortalForBinding(
    ctx: BridgeRequestContext,
    portal: Portal,
    binding: OpenClawSessionBinding,
  ): Portal {
    const canonical = canonicalPortalForBinding(portal, binding, this.#login.id);
    ctx.bridge?.registerPortal?.(canonical);
    return canonical;
  }

  private resolveNewSessionCommand(
    args: string,
    binding: OpenClawSessionBinding | undefined,
  ): { agentId: string; ghostUserId: string; label: string } | undefined {
    const trimmed = args.trim();
    if (binding) {
      return {
        agentId: binding.agentId,
        ghostUserId: binding.ghostUserId,
        label: trimmed || DEFAULT_NEW_SESSION_LABEL,
      };
    }
    const [agentId, ...labelParts] = trimmed.split(/\s+/u).filter(Boolean);
    const contact = agentId
      ? this.#registry.getAgent(agentId) ?? agentContactFromOpenClawAgent(this.#runtime.config, { id: agentId })
      : this.#registry.getAgent("main") ?? agentContactFromOpenClawAgent(this.#runtime.config, { id: "main" });
    return {
      agentId: contact.agentId,
      ghostUserId: contact.ghostUserId,
      label: labelParts.join(" ") || DEFAULT_NEW_SESSION_LABEL,
    };
  }

  private async createBindingForMatrixRoom(
    roomId: string,
    label: string,
    agentId = "main",
    ghostUserId = (this.#registry.getAgent(agentId) ?? agentContactFromOpenClawAgent(this.#runtime.config, { id: agentId })).ghostUserId,
  ): Promise<OpenClawSessionBinding> {
    const existing = this.#registry.getBindingByRoom(roomId);
    if (existing) return existing;
    const session = await this.#runtime.createSession({
      agentId,
      key: newBeeperSessionKey(agentId),
      label,
    });
    const now = Date.now();
    const binding: OpenClawSessionBinding = {
      agentId,
      createdAt: now,
      ghostUserId,
      id: Buffer.from(roomId).toString("base64url"),
      kind: "session",
      label,
      owner: "bridge",
      roomId,
      sessionKey: session.key,
      updatedAt: now,
    };
    this.#registry.upsertBinding(binding);
    await this.#registry.save();
    return binding;
  }

  private async createSessionPortalForAgent(
    _ctx: BridgeRequestContext,
    contact: OpenClawAgentContact,
    label = contact.displayName,
  ): Promise<Portal> {
    const session = await this.#runtime.createSession({
      agentId: contact.agentId,
      key: newBeeperSessionKey(contact.agentId),
      label,
    });
    return portalForAgentSession(contact, this.#login.id, session.key, label);
  }
}

function newBeeperSessionKey(agentId: string): string {
  return `agent:${agentId}:beeper:${randomUUID()}`;
}

function commandNotice(ctx: BridgeRequestContext, login: UserLogin, msg: MatrixMessage, text: string, portalKey = msg.portal.portalKey): MatrixMessageResponse {
  ctx.queueRemoteEvent(login, createRemoteMessage({
    convert: () => ({
      parts: [{ content: { body: text, msgtype: "m.notice" }, id: "body", type: "m.text" }],
    }),
    data: { text },
    id: `${msg.event.eventId}:openclaw-command`,
    portalKey,
    sender: {
      isFromMe: true,
      sender: "openclawbot",
    },
    timestamp: new Date(),
  }));
  return { pending: false };
}

function canonicalPortalForBinding(portal: Portal, binding: OpenClawSessionBinding, receiver: string): Portal {
  const id = portalIdForSession(binding.sessionKey);
  return {
    ...portal,
    id,
    metadata: {
      ...(recordValue(portal.metadata) ?? {}),
      openclaw: stripUndefined({
        ...(recordValue(recordValue(portal.metadata)?.openclaw) ?? {}),
        agentId: binding.agentId,
        ghostUserId: binding.ghostUserId,
        ...(binding.label ? { label: binding.label } : {}),
        sessionKey: binding.sessionKey,
      }),
    },
    mxid: binding.roomId,
    portalKey: { id, receiver },
    receiver,
    roomType: portal.roomType ?? "dm",
  };
}

function canonicalPortalKeyForBinding(binding: OpenClawSessionBinding | undefined, receiver: string): PortalKey | undefined {
  if (!binding) return undefined;
  return { id: portalIdForSession(binding.sessionKey), receiver };
}

function bridgeStatusText(config: OpenClawBridgeConfig, boundRooms: number): string {
  return [
    "OpenClaw Beeper bridge",
    "Runtime: OpenClaw plugin",
    `Import sources: ${(config.importSources ?? []).join(", ") || "none"}`,
    `Approvals: ${describeApprovalBehavior(config.approvalBehavior)}`,
    `Stream finalization: ${config.streamFinalization ?? "replace"}`,
    `Backfill limit: ${config.backfillLimit ?? "default"}`,
    `Bound rooms: ${boundRooms}`,
  ].join("\n");
}

function bridgeSettingsText(config: OpenClawBridgeConfig, boundRooms: number): string {
  return [
    "OpenClaw Beeper settings",
    `Beeper environment: ${config.beeperEnv ?? "production"}`,
    `Homeserver: ${config.homeserver ?? "not configured"}`,
    `Registration URL: ${config.registrationUrl ?? "not configured"}`,
    "Runtime: OpenClaw plugin",
    `Bridge manager token: ${config.bridgeManagerToken ? "configured" : "not configured"}`,
    `Post bridge state: ${config.bridgeManagerPostState === undefined ? "default" : config.bridgeManagerPostState ? "enabled" : "disabled"}`,
    `Import sources: ${(config.importSources ?? []).join(", ") || "none"}`,
    `Backfill limit: ${config.backfillLimit ?? "default"}`,
    `Contact visibility: ${config.contactVisibility ?? "agents"}`,
    `Stream finalization: ${config.streamFinalization ?? "replace"}`,
    `Approvals: ${describeApprovalBehavior(config.approvalBehavior)}`,
    `Non-federated rooms: ${config.nonFederatedRooms ? "yes" : "no"}`,
    `Allowed rooms: ${config.allowedRoomIds?.length ? config.allowedRoomIds.join(", ") : "all"}`,
    `Allowed users: ${config.allowedUserIds?.length ? config.allowedUserIds.join(", ") : "all"}`,
    `Bound rooms: ${boundRooms}`,
  ].join("\n");
}

function describeApprovalBehavior(behavior: OpenClawBridgeConfig["approvalBehavior"]): string {
  switch (behavior ?? "native") {
    case "native":
      return "native Beeper UI";
    case "disabled":
      return "disabled";
  }
}

function approvalReactionsEnabled(_config: OpenClawBridgeConfig): boolean {
  return false;
}

function approvalSlashEnabled(_config: OpenClawBridgeConfig): boolean {
  return false;
}

function approvalNativeEnabled(config: OpenClawBridgeConfig): boolean {
  return config.approvalBehavior === undefined || config.approvalBehavior === "native";
}

function openClawPortalCreationContent(config: OpenClawBridgeConfig): Record<string, unknown> | undefined {
  return config.nonFederatedRooms ? { "m.federate": false } : undefined;
}

function sessionsSummaryText(sessions: Awaited<ReturnType<typeof discoverOneToOneSessions>>): string {
  if (sessions.length === 0) return "No importable OpenClaw sessions found for the enabled import sources.";
  return sessions.slice(0, 20).map((session) => `${session.label} (${session.source})`).join("\n");
}

function importSummaryText(result: Awaited<ReturnType<typeof backfillAllOpenClawSessions>>): string {
  const imported = result.sessions.length;
  const skipped = result.skipped.length;
  if (imported === 0 && skipped === 0) return "No importable OpenClaw sessions found for the enabled import sources.";
  return [
    `Imported ${imported} OpenClaw session${imported === 1 ? "" : "s"}.`,
    `Skipped ${skipped} already imported or unavailable session${skipped === 1 ? "" : "s"}.`,
  ].join("\n");
}

function streamTargetRelationPatch(
  binding: OpenClawSessionBinding | undefined,
  targetEventId: string | undefined,
): Partial<NonNullable<OpenClawMatrixMessageMetadata["relation"]>> {
  if (!binding?.lastStreamTargetEventId || binding.lastStreamTargetEventId !== targetEventId) return {};
  const patch: Partial<NonNullable<OpenClawMatrixMessageMetadata["relation"]>> = {
    targetSessionKey: binding.sessionKey,
  };
  const targetRunId = binding.lastStreamRunId ?? binding.lastRunId;
  if (targetRunId) patch.targetRunId = targetRunId;
  return patch;
}

function matrixMetadataFromParsed(
  parsed: ParsedMatrixTextMessage,
  sender: string,
  relationPatch: NonNullable<OpenClawMatrixMessageMetadata["relation"]> = {},
): OpenClawMatrixMessageMetadata {
  const metadata: OpenClawMatrixMessageMetadata = { sender };
  if (parsed.attachments.length > 0) metadata.attachments = parsed.attachments as NonNullable<OpenClawMatrixMessageMetadata["attachments"]>;
  if (parsed.formattedBody) metadata.formattedBody = parsed.formattedBody;
  if (parsed.mentions) metadata.mentions = parsed.mentions;
  if (parsed.threadRootEventId) metadata.threadRootEventId = parsed.threadRootEventId;
  if (parsed.replyToEventId || parsed.threadRootEventId || parsed.replyQuote || Object.keys(relationPatch).length > 0) {
    metadata.relation = {
      kind: parsed.threadRootEventId ? "thread" : "reply",
      ...(parsed.replyToEventId ? { replyToEventId: parsed.replyToEventId } : {}),
      ...(parsed.threadRootEventId ? { threadRootEventId: parsed.threadRootEventId } : {}),
      ...(parsed.replyQuote ? { quote: parsed.replyQuote } : {}),
      ...relationPatch,
    };
  }
  return metadata;
}

function portalForAgentSession(
  contact: OpenClawAgentContact,
  receiver: string,
  sessionKey: string,
  label?: string,
): Portal {
  const id = portalIdForSession(sessionKey);
  return {
    id,
    metadata: {
      openclaw: stripUndefined({
        agentId: contact.agentId,
        ghostUserId: contact.ghostUserId,
        ...(label ? { label } : {}),
        sessionKey,
      }),
    },
    portalKey: { id, receiver },
    receiver,
    roomType: "dm",
  };
}

function findAgentContact(contacts: readonly OpenClawAgentContact[], identifier: string): OpenClawAgentContact | undefined {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return undefined;
  return contacts.find((contact) =>
    contact.agentId.toLowerCase() === normalized ||
    contact.ghostUserId.toLowerCase() === normalized ||
    contact.displayName.toLowerCase() === normalized
  );
}

function portalIdForSession(sessionKey: string): string {
  return `session:${Buffer.from(sessionKey).toString("base64url")}`;
}

function contactResponse(contact: OpenClawAgentContact, portal?: Portal): ResolveIdentifierResponse {
  return {
    ghost: {
      displayName: contact.displayName,
      id: contact.agentId,
      metadata: { openclaw: contact },
      mxid: contact.ghostUserId,
    },
    ...(portal ? { portal } : {}),
    userId: contact.ghostUserId,
  };
}

function userContactResponse(contact: OpenClawUserContact): ResolveIdentifierResponse {
  return {
    ghost: {
      displayName: contact.displayName,
      id: contact.userId,
      metadata: { openclaw: contact },
      mxid: contact.ghostUserId,
    },
    userId: contact.ghostUserId,
  };
}

function bindingFromPortal(portal: Portal, config: OpenClawBridgeConfig): OpenClawSessionBinding | undefined {
  const metadata = recordValue(portal.metadata)?.openclaw;
  const openclaw = recordValue(metadata);
  const roomId = portal.mxid;
  const portalId = openClawPortalId(portal);
  const sessionKey = stringValue(openclaw?.sessionKey) ?? sessionKeyFromPortalId(portalId);
  const agentId = stringValue(openclaw?.agentId) ?? agentIdFromSessionKey(sessionKey) ?? agentIdFromPortalId(portalId);
  const ghostUserId = stringValue(openclaw?.ghostUserId) ?? (agentId ? agentGhostUserId(config, agentId) : undefined);
  if (!roomId || !agentId || !sessionKey || !ghostUserId) return undefined;
  const now = Date.now();
  const label = stringValue(openclaw?.label);
  return {
    agentId,
    createdAt: now,
    ghostUserId,
    id: Buffer.from(roomId).toString("base64url"),
    kind: "session",
    ...(label ? { label } : {}),
    owner: openclaw ? "bridge" : "imported",
    roomId,
    sessionKey,
    updatedAt: now,
  };
}

function openClawPortalId(portal: Portal): string {
  return openClawPortalIdFromString(portal.id)
    ?? openClawPortalIdFromString(portal.portalKey.id)
    ?? openClawPortalIdFromRoomId(portal.mxid)
    ?? portal.id;
}

function openClawPortalIdFromString(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.startsWith("session:") || value.startsWith("agent:") ? value : undefined;
}

function openClawPortalIdFromRoomId(roomId: string | undefined): string | undefined {
  if (!roomId?.startsWith("!")) return undefined;
  const serverSeparator = roomId.lastIndexOf(":");
  if (serverSeparator <= 1) return undefined;
  const localpart = roomId.slice(1, serverSeparator);
  const receiverSeparator = localpart.lastIndexOf(".");
  const portalId = receiverSeparator >= 0 ? localpart.slice(0, receiverSeparator) : localpart;
  return openClawPortalIdFromString(portalId);
}

function sessionKeyFromPortalId(portalId: string): string | undefined {
  if (portalId.startsWith("session:")) {
    try {
      return Buffer.from(portalId.slice("session:".length), "base64url").toString("utf8") || undefined;
    } catch {
      return undefined;
    }
  }
  if (portalId.startsWith("agent:")) return portalId;
  return undefined;
}

function agentIdFromPortalId(portalId: string): string | undefined {
  return portalId.startsWith("agent:") ? portalId.slice("agent:".length) || undefined : undefined;
}

function agentIdFromSessionKey(sessionKey: string | undefined): string | undefined {
  if (!sessionKey?.startsWith("agent:")) return undefined;
  const [, agentId] = sessionKey.split(":");
  return agentId || undefined;
}

function backfillSenderUserId(
  config: OpenClawBridgeConfig,
  binding: OpenClawSessionBinding,
  sender: "agent" | "human" | "system"
): string {
  if (sender === "agent") return binding.ghostUserId;
  if (sender === "human") return binding.humanGhostUserId ?? serviceBotUserId(config);
  return serviceBotUserId(config);
}

export function userLoginFromOpenClawConfig(config: OpenClawBridgeConfig): UserLogin {
  return {
    id: "openclaw:plugin",
    metadata: {},
    remoteName: "OpenClaw",
    userId: config.matrixUserId ?? config.serviceBotLocalpart,
  };
}

export function createOpenClawRuntimeFromHost(runtime: OpenClawHostRuntime, config: OpenClawBridgeConfig): OpenClawGatewayRuntime {
  return new OpenClawGatewayRuntime({ config, transport: createOpenClawHostTransport(runtime) });
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function matrixReactionKey(content: unknown): string | undefined {
  const relates = recordValue(recordValue(content)?.["m.relates_to"]);
  return stringValue(relates?.key);
}

function approvalIdFromMatrixReply(msg: MatrixMessage): string | undefined {
  const content = recordValue(msg.content);
  const relates = recordValue(content?.["m.relates_to"]);
  const inReplyTo = recordValue(relates?.["m.in_reply_to"]);
  return stringValue(msg.replyTo?.id)
    ?? stringValue(msg.event.replyTo)
    ?? stringValue(content?.approvalId)
    ?? stringValue(inReplyTo?.event_id)
    ?? stringValue(relates?.event_id);
}

function senderUserId(sender: unknown): string | undefined {
  if (typeof sender === "string") return sender;
  return stringValue(recordValue(sender)?.userId);
}

export { parseMatrixTextMessage, type ParsedMatrixTextMessage } from "./matrix-parser";

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}
