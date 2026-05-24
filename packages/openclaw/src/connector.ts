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
  LoginStep,
  LoadUserLoginContext,
  MatrixEdit,
  MatrixMessage,
  MatrixMessageResponse,
  MatrixReaction,
  MatrixRedaction,
  MessageHandlingNetworkAPI,
  NetworkAPI,
  NetworkGeneralCapabilities,
  Portal,
  ReactionHandlingNetworkAPI,
  type RedactionHandlingNetworkAPI,
  Reaction,
  ResolveIdentifierParams,
  ResolveIdentifierResponse,
  UserLogin,
} from "@beeper/pickle-bridge";
import { buildBackfillImport, discoverOneToOneSessions } from "./backfill";
import { parseApprovalResponseContent } from "./approval";
import { OpenClawBeeperStreamPublisher } from "./beeper-stream";
import { agentPortalSessionKey, OpenClawMatrixBridgeAgent, type OpenClawBridgeStreamPublisher } from "./bridge-agent";
import { createDefaultConfig } from "./config";
import { createOpenClawHttpTransport, createOpenClawWebSocketTransport, OpenClawGatewayRuntime, type OpenClawMatrixMessageMetadata, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";
import { agentContactFromOpenClawAgent, serviceBotUserId } from "./rooms";
import type { OpenClawAgentContact, OpenClawBridgeConfig, OpenClawSessionBinding, OpenClawUserContact } from "./types";

export interface OpenClawConnectorOptions {
  config?: OpenClawBridgeConfig;
  registry?: OpenClawBridgeRegistry;
  runtimeFactory?: (login: UserLogin, config: OpenClawBridgeConfig) => OpenClawGatewayRuntime;
  streams?: OpenClawBridgeStreamPublisher;
  transportFactory?: (login: UserLogin, config: OpenClawBridgeConfig) => OpenClawTransport;
}

export function createOpenClawConnector(options: OpenClawConnectorOptions = {}): OpenClawBridgeConnector {
  return new OpenClawBridgeConnector(options);
}

export class OpenClawBridgeConnector implements BridgeConnector<OpenClawBridgeConfig> {
  readonly config: OpenClawBridgeConfig;
  readonly registry: OpenClawBridgeRegistry;
  #runtimeFactory: (login: UserLogin, config: OpenClawBridgeConfig) => OpenClawGatewayRuntime;
  #streams: OpenClawBridgeStreamPublisher | undefined;

  constructor(options: OpenClawConnectorOptions = {}) {
    this.config = options.config ?? createDefaultConfig();
    this.registry = options.registry ?? new OpenClawBridgeRegistry();
    this.#streams = options.streams;
    this.#runtimeFactory =
      options.runtimeFactory ??
      ((login, config) => new OpenClawGatewayRuntime({
        config,
        transport: options.transportFactory?.(login, config) ?? transportFromLogin(login, config),
      }));
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
    return [
      {
        description: "Connect to an existing OpenClaw gateway by URL and optional bearer token.",
        id: "openclaw.gateway",
        name: "OpenClaw Gateway",
      },
    ];
  }

  async init(ctx: BridgeContext): Promise<void> {
    await this.registry.load();
    const streamOptions: ConstructorParameters<typeof OpenClawBeeperStreamPublisher>[0] = {
      client: ctx.client,
      config: this.config,
    };
    const ownUserId = ctx.bridge.getOwnUserId();
    if (ownUserId) streamOptions.userId = ownUserId;
    this.#streams ??= new OpenClawBeeperStreamPublisher(streamOptions);
  }

  async start(_ctx: BridgeContext): Promise<void> {
    await this.registry.save();
  }

  createLogin(_ctx: LoginCreateContext, user: BridgeUser, flowId: string): LoginProcess {
    if (flowId !== "openclaw.gateway") throw new Error(`Unsupported OpenClaw login flow: ${flowId}`);
    return new OpenClawGatewayLoginProcess(user.id, this.config);
  }

  loadUserLogin(_ctx: LoadUserLoginContext, login: UserLogin): NetworkAPI {
    return new OpenClawNetworkAPI({
      config: this.config,
      login,
      registry: this.registry,
      runtime: this.#runtimeFactory(login, this.config),
      streams: this.#streams ?? { publish: () => undefined },
    });
  }
}

export class OpenClawGatewayLoginProcess implements LoginProcess {
  readonly #defaultConfig: OpenClawBridgeConfig;
  readonly #userId: string;

  constructor(userId: string, defaultConfig: OpenClawBridgeConfig) {
    this.#userId = userId;
    this.#defaultConfig = defaultConfig;
  }

  cancel(): void {}

  async start(): Promise<LoginStep> {
    return {
      instructions: "Enter your OpenClaw gateway URL and optional bearer token.",
      stepId: "openclaw.gateway.credentials",
      type: "user_input",
      userInput: {
        fields: [
          {
            defaultValue: this.#defaultConfig.gatewayUrl ?? "ws://127.0.0.1:29390",
            description: "OpenClaw gateway URL.",
            id: "gateway_url",
            name: "Gateway URL",
            type: "url",
          },
          {
            description: "Optional OpenClaw gateway bearer token.",
            id: "access_token",
            name: "Access token",
            type: "token",
          },
        ],
      },
    };
  }

  async submitUserInput(_ctxOrInput?: BridgeRequestContext | Record<string, string>, maybeInput?: Record<string, string>): Promise<LoginStep> {
    const input = maybeInput ?? (_ctxOrInput as Record<string, string> | undefined) ?? {};
    const gatewayUrl = input.gateway_url || this.#defaultConfig.gatewayUrl || "ws://127.0.0.1:29390";
    const accessToken = input.access_token || this.#defaultConfig.gatewayAccessToken;
    return {
      complete: {
        userLogin: {
          id: `openclaw:${encodeLoginId(gatewayUrl)}`,
          metadata: {
            ...(accessToken ? { gatewayAccessToken: accessToken } : {}),
            gatewayUrl,
          },
          remoteName: "OpenClaw",
          userId: this.#userId,
        },
        userLoginId: `openclaw:${encodeLoginId(gatewayUrl)}`,
      },
      instructions: "OpenClaw gateway configured.",
      stepId: "openclaw.gateway.complete",
      type: "complete",
    };
  }
}

export class OpenClawNetworkAPI implements NetworkAPI, IdentifierResolvingNetworkAPI, ContactListingNetworkAPI, MessageHandlingNetworkAPI, EditHandlingNetworkAPI, ReactionHandlingNetworkAPI, RedactionHandlingNetworkAPI, BackfillingNetworkAPI {
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
    streams: OpenClawBridgeStreamPublisher;
  }) {
    this.#config = options.config;
    this.#login = options.login;
    this.#registry = options.registry;
    this.#runtime = options.runtime;
    this.#agent = new OpenClawMatrixBridgeAgent({
      registry: options.registry,
      runtime: options.runtime,
      streams: options.streams,
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
    const contact = this.#registry.getAgent(params.identifier) ?? agentContactFromOpenClawAgent(this.#runtime.config, { id: params.identifier });
    let portal = params.createDM ? portalForAgent(contact, this.#login.id) : undefined;
    if (portal && params.createDM) {
      const portalOptions: Parameters<typeof ctx.bridge.createPortal>[1] = {
        id: portal.id,
        metadata: portal.metadata,
        name: contact.displayName,
        roomType: "dm",
        sender: contact.agentId,
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
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, msg.sender.userId)) return { pending: false };
    const binding = bindingFromPortal(msg.portal);
    if (binding && !this.#registry.getBindingByRoom(msg.portal.mxid ?? "")) this.#registry.upsertBinding(binding);
    const parsed = parseMatrixTextMessage(msg.text, msg.content, msg);
    if (msg.portal.mxid) {
      if (parsed.command?.name === "stop" || parsed.command?.name === "abort") {
        const currentBinding = this.#registry.getBindingByRoom(msg.portal.mxid) ?? binding;
        const abortOptions: { runId?: string; sessionKey?: string } = {};
        if (currentBinding?.lastRunId) abortOptions.runId = currentBinding.lastRunId;
        if (currentBinding?.sessionKey) abortOptions.sessionKey = currentBinding.sessionKey;
        await this.#runtime.abortSession(abortOptions);
        return { pending: false };
      }
      if (parsed.command) {
        return await this.handleSlashCommand(ctx, parsed.command, binding, msg);
      }
      await this.#agent.handleMatrixText({
        ...(parsed.attachments.length > 0 ? { attachments: parsed.attachments } : {}),
        eventId: msg.event.eventId,
        matrix: matrixMetadataFromParsed(parsed, msg.sender.userId),
        roomId: msg.portal.mxid,
        ...(parsed.replyToEventId ? { replyToEventId: parsed.replyToEventId } : {}),
        sender: msg.sender.userId,
        text: parsed.text,
      });
    }
    return { pending: false };
  }

  async handleMatrixEdit(_ctx: BridgeRequestContext, msg: MatrixEdit): Promise<MatrixMessageResponse> {
    if (!this.isAllowedMatrixIngress(msg.portal.mxid, msg.sender.userId)) return { pending: false };
    this.upsertPortalBinding(msg.portal);
    const parsed = parseMatrixTextMessage(msg.text, msg.content, msg);
    const targetId = msg.targetMessage.id;
    if (msg.portal.mxid) {
      await this.#agent.handleMatrixText({
        ...(parsed.attachments.length > 0 ? { attachments: parsed.attachments } : {}),
        eventId: `${msg.event.eventId}:edit`,
        matrix: matrixMetadataFromParsed(parsed, msg.sender.userId, {
          kind: "edit",
          targetEventId: targetId,
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
    const reactionKey = matrixReactionKey(msg.content);
    if (!reactionKey || !msg.portal.mxid) return null;
    this.upsertPortalBinding(msg.portal);
    await this.#agent.handleMatrixText({
      eventId: msg.event.eventId,
      matrix: {
        relation: {
          key: reactionKey,
          kind: "reaction",
          targetEventId: msg.targetMessage.id,
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

  async handleMatrixRedaction(_ctx: BridgeRequestContext, msg: MatrixRedaction): Promise<void> {
    if (!msg.portal.mxid) return;
    if (!this.isAllowedRoom(msg.portal.mxid)) return;
    this.upsertPortalBinding(msg.portal);
    await this.#agent.handleMatrixText({
      eventId: msg.eventId,
      matrix: {
        relation: {
          kind: "redaction",
          ...(msg.targetMessage?.id ? { targetEventId: msg.targetMessage.id } : {}),
        },
        sender: "redaction",
      },
      roomId: msg.portal.mxid,
      ...(msg.targetMessage?.id ? { replyToEventId: msg.targetMessage.id } : {}),
      sender: "redaction",
      text: msg.targetMessage?.id ? `Redacted message ${msg.targetMessage.id}` : "Redacted a Matrix event",
    });
  }

  async fetchMessages(_ctx: BridgeRequestContext, params: FetchMessagesParams): Promise<FetchMessagesResponse> {
    const binding = bindingFromPortal(params.portal);
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
            isFromMe: false,
            sender: message.sender === "agent" ? binding.agentId : binding.humanGhostUserId ?? `${this.#login.id}:human`,
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
    switch (command.name) {
      case "status":
      case "settings":
        return commandNotice(ctx, this.#login, msg, bridgeStatusText(this.#runtime.config, this.#registry.data.bindings.length));
      case "sessions": {
        const options: Parameters<typeof discoverOneToOneSessions>[1] = {};
        if (this.#runtime.config.importSources !== undefined) options.importSources = this.#runtime.config.importSources;
        const sessions = await discoverOneToOneSessions(this.#runtime, options);
        return commandNotice(ctx, this.#login, msg, sessionsSummaryText(sessions));
      }
      case "backfill":
      case "import": {
        const count = await this.backfillCurrentRoom(binding, msg);
        return commandNotice(ctx, this.#login, msg, `Queued backfill for ${count} message${count === 1 ? "" : "s"}.`);
      }
      case "new": {
        const request = this.resolveNewSessionCommand(command.args, binding);
        if (!request) {
          return commandNotice(ctx, this.#login, msg, "Usage: /new [agent-id] [session label]. In an agent DM, /new [session label] is enough.");
        }
        const session = await this.#runtime.createSession({ agentId: request.agentId, label: request.label });
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
          sender: request.agentId,
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
        return commandNotice(ctx, this.#login, msg, portal.mxid
          ? `Created a new OpenClaw session room: ${portal.mxid}`
          : `Created a new OpenClaw session: ${session.key}`);
      }
      case "approve":
      case "deny": {
        if (!approvalSlashEnabled(this.#runtime.config)) {
          return commandNotice(ctx, this.#login, msg, "Approval slash commands are disabled for this bridge.");
        }
        const approvalId = command.args.trim() || approvalIdFromMatrixReply(msg);
        if (!approvalId) return commandNotice(ctx, this.#login, msg, `Usage: /${command.name} <approval-id> or reply to an approval message with /${command.name}`);
        await this.#agent.handleApprovalContent({
          approvalId,
          approved: command.name === "approve",
          approvedAlways: false,
          type: "tool-approval-response",
        }, approvalId);
        return commandNotice(ctx, this.#login, msg, `${command.name === "approve" ? "Approved" : "Denied"} ${approvalId}.`);
      }
      case "agent":
        return commandNotice(ctx, this.#login, msg, binding ? `Agent: ${binding.agentId}` : "This room is not bound to an OpenClaw agent yet.");
      default:
        return commandNotice(ctx, this.#login, msg, `Unknown OpenClaw command: /${command.name}`);
    }
  }

  async backfillCurrentRoom(binding: OpenClawSessionBinding | undefined, msg: MatrixMessage): Promise<number> {
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
    return sender === this.#config.matrixUserId
      || sender === serviceBotUserId(this.#config)
      || this.#registry.data.agents.some((contact) => contact.ghostUserId === sender)
      || this.#registry.data.users.some((contact) => contact.ghostUserId === sender);
  }

  private upsertPortalBinding(portal: Portal): void {
    const binding = bindingFromPortal(portal);
    if (binding && !this.#registry.getBindingByRoom(portal.mxid ?? "")) this.#registry.upsertBinding(binding);
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
        label: trimmed || binding.label || "Beeper",
      };
    }
    const [agentId, ...labelParts] = trimmed.split(/\s+/u).filter(Boolean);
    if (!agentId) return undefined;
    const contact = this.#registry.getAgent(agentId) ?? agentContactFromOpenClawAgent(this.#runtime.config, { id: agentId });
    return {
      agentId: contact.agentId,
      ghostUserId: contact.ghostUserId,
      label: labelParts.join(" ") || "Beeper",
    };
  }
}

function commandNotice(ctx: BridgeRequestContext, login: UserLogin, msg: MatrixMessage, text: string): MatrixMessageResponse {
  ctx.queueRemoteEvent(login, createRemoteMessage({
    convert: () => ({
      parts: [{ content: { body: text, msgtype: "m.notice" }, id: "body", type: "m.text" }],
    }),
    data: { text },
    id: `${msg.event.eventId}:openclaw-command`,
    portalKey: msg.portal.portalKey,
    sender: {
      isFromMe: true,
      sender: "openclawbot",
    },
    timestamp: new Date(),
  }));
  return { pending: false };
}

function bridgeStatusText(config: OpenClawBridgeConfig, boundRooms: number): string {
  return [
    "OpenClaw Beeper bridge",
    `Gateway: ${config.gatewayUrl ?? "not configured"}`,
    `Import sources: ${(config.importSources ?? []).join(", ") || "none"}`,
    `Approvals: ${config.approvalBehavior ?? "native"}`,
    `Stream finalization: ${config.streamFinalization ?? "replace"}`,
    `Backfill limit: ${config.backfillLimit ?? "default"}`,
    `Bound rooms: ${boundRooms}`,
  ].join("\n");
}

function approvalReactionsEnabled(config: OpenClawBridgeConfig): boolean {
  return config.approvalBehavior === undefined || config.approvalBehavior === "native" || config.approvalBehavior === "reactions";
}

function approvalSlashEnabled(config: OpenClawBridgeConfig): boolean {
  return config.approvalBehavior === undefined || config.approvalBehavior === "native" || config.approvalBehavior === "slash";
}

function openClawPortalCreationContent(config: OpenClawBridgeConfig): Record<string, unknown> | undefined {
  return config.nonFederatedRooms ? { "m.federate": false } : undefined;
}

function sessionsSummaryText(sessions: Awaited<ReturnType<typeof discoverOneToOneSessions>>): string {
  if (sessions.length === 0) return "No importable OpenClaw sessions found for the enabled import sources.";
  return sessions.slice(0, 20).map((session) => `${session.label} (${session.source})`).join("\n");
}

function matrixMetadataFromParsed(
  parsed: ParsedMatrixTextMessage,
  sender: string,
  relationPatch: NonNullable<OpenClawMatrixMessageMetadata["relation"]> = {},
): OpenClawMatrixMessageMetadata {
  const metadata: OpenClawMatrixMessageMetadata = { sender };
  if (parsed.formattedBody) metadata.formattedBody = parsed.formattedBody;
  if (parsed.mentions) metadata.mentions = parsed.mentions;
  if (parsed.threadRootEventId) metadata.threadRootEventId = parsed.threadRootEventId;
  if (parsed.replyToEventId || parsed.threadRootEventId || Object.keys(relationPatch).length > 0) {
    metadata.relation = {
      kind: parsed.threadRootEventId ? "thread" : "reply",
      ...(parsed.replyToEventId ? { replyToEventId: parsed.replyToEventId } : {}),
      ...(parsed.threadRootEventId ? { threadRootEventId: parsed.threadRootEventId } : {}),
      ...relationPatch,
    };
  }
  return metadata;
}

function portalForAgent(contact: OpenClawAgentContact, receiver: string): Portal {
  const id = `agent:${contact.agentId}`;
  return {
    id,
    metadata: {
      openclaw: {
        agentId: contact.agentId,
        ghostUserId: contact.ghostUserId,
        sessionKey: agentPortalSessionKey(contact.agentId),
      },
    },
    portalKey: { id, receiver },
    receiver,
    roomType: "dm",
  };
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

function bindingFromPortal(portal: Portal): OpenClawSessionBinding | undefined {
  const metadata = recordValue(portal.metadata)?.openclaw;
  const openclaw = recordValue(metadata);
  const roomId = portal.mxid;
  const agentId = stringValue(openclaw?.agentId) ?? portal.id.replace(/^agent:/, "");
  const sessionKey = stringValue(openclaw?.sessionKey) ?? portal.id;
  const ghostUserId = stringValue(openclaw?.ghostUserId);
  if (!roomId || !agentId || !sessionKey || !ghostUserId) return undefined;
  const now = Date.now();
  return {
    agentId,
    createdAt: now,
    ghostUserId,
    id: Buffer.from(roomId).toString("base64url"),
    kind: "session",
    owner: "bridge",
    roomId,
    sessionKey,
    updatedAt: now,
  };
}

function transportFromLogin(login: UserLogin, config: OpenClawBridgeConfig): OpenClawTransport {
  const metadata = recordValue(login.metadata);
  const gatewayUrl = stringValue(metadata?.gatewayUrl) ?? config.gatewayUrl;
  if (!gatewayUrl) throw new Error("OpenClaw gateway URL is not configured");
  const options: Parameters<typeof createOpenClawHttpTransport>[0] = { url: gatewayUrl };
  const accessToken = stringValue(metadata?.gatewayAccessToken) ?? stringValue(metadata?.accessToken) ?? config.gatewayAccessToken;
  if (accessToken !== undefined) options.accessToken = accessToken;
  if (gatewayUrl.startsWith("ws://") || gatewayUrl.startsWith("wss://")) {
    return createOpenClawWebSocketTransport(options);
  }
  return createOpenClawHttpTransport(options);
}

export function userLoginFromOpenClawConfig(config: OpenClawBridgeConfig): UserLogin {
  const gatewayUrl = config.gatewayUrl;
  if (!gatewayUrl) throw new Error("OpenClaw gateway URL is not configured");
  return {
    id: `openclaw:${encodeLoginId(gatewayUrl)}`,
    metadata: {
      ...(config.gatewayAccessToken ? { gatewayAccessToken: config.gatewayAccessToken } : {}),
      gatewayUrl,
    },
    remoteName: "OpenClaw",
    userId: config.matrixUserId ?? config.serviceBotLocalpart,
  };
}

export function createOpenClawRuntimeFromLogin(login: UserLogin, config: OpenClawBridgeConfig): OpenClawGatewayRuntime {
  return new OpenClawGatewayRuntime({
    config,
    transport: transportFromLogin(login, config),
  });
}

function encodeLoginId(value: string): string {
  return Buffer.from(value).toString("base64url").slice(0, 32);
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

export interface ParsedMatrixTextMessage {
  attachments: unknown[];
  command?: {
    args: string;
    name: string;
  };
  formattedBody?: string;
  mentions?: { room?: boolean; userIds?: string[] };
  replyToEventId?: string;
  text: string;
  threadRootEventId?: string;
}

export function parseMatrixTextMessage(text: string, content: unknown, msg?: Pick<MatrixMessage, "attachments" | "event" | "replyTo" | "threadRoot">): ParsedMatrixTextMessage {
  const relates = recordValue(recordValue(content)?.["m.relates_to"]);
  const replyToEventId =
    stringValue(msg?.replyTo?.id) ??
    stringValue(msg?.event.replyTo) ??
    stringValue(recordValue(relates?.["m.in_reply_to"])?.event_id) ??
    (relates?.rel_type === "m.thread" ? stringValue(relates.event_id) : undefined);
  const threadRootEventId = stringValue(msg?.threadRoot?.id) ?? stringValue(msg?.event.threadRoot) ?? (relates?.rel_type === "m.thread" ? stringValue(relates.event_id) : undefined);
  const body = stripMatrixReplyFallback(text);
  const command = parseSlashCommand(body);
  const formattedBody = stringValue(recordValue(content)?.formatted_body) ?? stringValue(msg?.event.html);
  const mentions = normalizeMentions(recordValue(content)?.["m.mentions"] ?? msg?.event.mentions);
  const attachments = normalizeMatrixAttachments(msg?.attachments ?? msg?.event.attachments ?? [], content);
  return {
    attachments,
    ...(command ? { command } : {}),
    ...(formattedBody ? { formattedBody } : {}),
    ...(mentions ? { mentions } : {}),
    ...(replyToEventId ? { replyToEventId } : {}),
    text: body,
    ...(threadRootEventId ? { threadRootEventId } : {}),
  };
}

function normalizeMatrixAttachments(attachments: unknown[], content: unknown): unknown[] {
  const normalized: unknown[] = attachments.flatMap((attachment) => {
    const record = recordValue(attachment);
    if (!record) return [];
    return [stripUndefined({
      contentType: record.contentType,
      contentUri: record.contentUri,
      duration: record.duration,
      encryptedFile: record.encryptedFile,
      filename: record.filename,
      height: record.height,
      kind: record.kind,
      size: record.size,
      width: record.width,
    })];
  });
  const contentUri = stringValue(recordValue(content)?.url);
  if (normalized.length === 0 && contentUri) {
    normalized.push(stripUndefined({
      contentUri,
      filename: stringValue(recordValue(content)?.filename) ?? stringValue(recordValue(content)?.body),
      kind: matrixAttachmentKind(stringValue(recordValue(content)?.msgtype)),
    }));
  }
  return normalized;
}

function matrixAttachmentKind(msgtype: string | undefined): string | undefined {
  switch (msgtype) {
    case "m.image":
      return "image";
    case "m.video":
      return "video";
    case "m.audio":
      return "audio";
    case "m.file":
      return "file";
    default:
      return undefined;
  }
}

function normalizeMentions(value: unknown): ParsedMatrixTextMessage["mentions"] | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const mentions: { room?: boolean; userIds?: string[] } = {};
  if (record.room === true) mentions.room = true;
  if (Array.isArray(record.user_ids)) mentions.userIds = record.user_ids.filter((item): item is string => typeof item === "string");
  if (Array.isArray(record.userIds)) mentions.userIds = record.userIds.filter((item): item is string => typeof item === "string");
  return mentions.room || mentions.userIds?.length ? mentions : undefined;
}

function stripMatrixReplyFallback(text: string): string {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  let index = 0;
  while (index < lines.length && lines[index]?.startsWith(">")) index += 1;
  if (index > 0 && lines[index] === "") index += 1;
  return lines.slice(index).join("\n").trim();
}

function parseSlashCommand(text: string): ParsedMatrixTextMessage["command"] | undefined {
  if (!text.startsWith("/") || text.startsWith("//")) return undefined;
  const match = /^\/([A-Za-z][\w-]*)(?:\s+(.*))?$/su.exec(text.trim());
  if (!match) return undefined;
  return {
    args: match[2] ?? "",
    name: match[1]!.toLowerCase(),
  };
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}
