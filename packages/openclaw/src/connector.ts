import {
  createRemoteMessage,
  type BackfillingNetworkAPI,
  BridgeConnector,
  BridgeContext,
  BridgeRequestContext,
  BridgeUser,
  ConnectContext,
  FetchMessagesParams,
  FetchMessagesResponse,
  IdentifierResolvingNetworkAPI,
  LoginCreateContext,
  LoginFlow,
  LoginProcess,
  LoginStep,
  LoadUserLoginContext,
  MatrixMessage,
  MatrixMessageResponse,
  MatrixReaction,
  MessageHandlingNetworkAPI,
  NetworkAPI,
  NetworkGeneralCapabilities,
  Portal,
  ReactionHandlingNetworkAPI,
  Reaction,
  ResolveIdentifierParams,
  ResolveIdentifierResponse,
  UserLogin,
} from "@beeper/pickle-bridge";
import { buildBackfillImport } from "./backfill";
import { parseApprovalResponseContent } from "./approval";
import { OpenClawMatrixBridgeAgent, type OpenClawBridgeStreamPublisher } from "./bridge-agent";
import { createDefaultConfig } from "./config";
import { createOpenClawHttpTransport, OpenClawGatewayRuntime, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";
import { agentContactFromOpenClawAgent } from "./rooms";
import type { OpenClawAgentContact, OpenClawBridgeConfig, OpenClawSessionBinding } from "./types";

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
  #streams: OpenClawBridgeStreamPublisher;

  constructor(options: OpenClawConnectorOptions = {}) {
    this.config = options.config ?? createDefaultConfig();
    this.registry = options.registry ?? new OpenClawBridgeRegistry();
    this.#streams = options.streams ?? { publish: () => undefined };
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

  async init(_ctx: BridgeContext): Promise<void> {
    await this.registry.load();
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
      streams: this.#streams,
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
    const accessToken = input.access_token || this.#defaultConfig.accessToken;
    return {
      complete: {
        userLogin: {
          id: `openclaw:${encodeLoginId(gatewayUrl)}`,
          metadata: {
            ...(accessToken ? { accessToken } : {}),
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

export class OpenClawNetworkAPI implements NetworkAPI, IdentifierResolvingNetworkAPI, MessageHandlingNetworkAPI, ReactionHandlingNetworkAPI, BackfillingNetworkAPI {
  readonly #agent: OpenClawMatrixBridgeAgent;
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
    for (const contact of this.#registry.data.agents) {
      ctx.bridge.registerGhost({
        displayName: contact.displayName,
        id: contact.agentId,
        metadata: { openclaw: contact },
        mxid: contact.ghostUserId,
      });
    }
  }

  async disconnect(): Promise<void> {
    await this.#runtime.close();
  }

  async resolveIdentifier(_ctx: BridgeRequestContext, params: ResolveIdentifierParams): Promise<ResolveIdentifierResponse> {
    const contact = this.#registry.getAgent(params.identifier) ?? agentContactFromOpenClawAgent(this.#runtime.config, { id: params.identifier });
    const portal = params.createDM ? portalForAgent(contact, this.#login.id) : undefined;
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

  async handleMatrixMessage(_ctx: BridgeRequestContext, msg: MatrixMessage): Promise<MatrixMessageResponse> {
    const binding = bindingFromPortal(msg.portal);
    if (binding && !this.#registry.getBindingByRoom(msg.portal.mxid ?? "")) this.#registry.upsertBinding(binding);
    if (msg.portal.mxid) {
      await this.#agent.handleMatrixText({
        eventId: msg.event.eventId,
        roomId: msg.portal.mxid,
        sender: msg.sender.userId,
        text: msg.text,
      });
    }
    return { pending: false };
  }

  async handleMatrixReaction(_ctx: BridgeRequestContext, msg: MatrixReaction): Promise<Reaction | null> {
    const approval = parseApprovalResponseContent(msg.content);
    if (!approval) return null;
    await this.#agent.handleApprovalContent(msg.content, approval.approvalId ?? msg.targetMessage.id);
    return { id: msg.event.eventId, metadata: { openclaw: { approval } } };
  }

  async fetchMessages(_ctx: BridgeRequestContext, params: FetchMessagesParams): Promise<FetchMessagesResponse> {
    const binding = bindingFromPortal(params.portal);
    if (!binding) return { hasMore: false, messages: [] };
    const importOptions: { limit?: number; roomId: string } = { roomId: binding.roomId };
    const limit = params.limit ?? params.count;
    if (limit !== undefined) importOptions.limit = limit;
    const backfill = await buildBackfillImport(this.#runtime, this.#runtime.config, {
      agentId: binding.agentId,
      label: binding.label ?? binding.sessionKey,
      session: { key: binding.sessionKey },
      sessionKey: binding.sessionKey,
      source: binding.owner === "imported" ? "unknown" : "channel",
    }, importOptions);
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
            isFromMe: message.sender !== "agent",
            sender: message.sender === "agent" ? binding.agentId : `${this.#login.id}:human`,
          },
          timestamp: new Date(0),
        }),
      })),
    };
  }
}

function portalForAgent(contact: OpenClawAgentContact, receiver: string): Portal {
  const id = `agent:${contact.agentId}`;
  return {
    id,
    metadata: {
      openclaw: {
        agentId: contact.agentId,
        ghostUserId: contact.ghostUserId,
        sessionKey: id,
      },
    },
    portalKey: { id, receiver },
    receiver,
    roomType: "dm",
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
  const accessToken = stringValue(metadata?.accessToken) ?? config.accessToken;
  if (accessToken !== undefined) options.accessToken = accessToken;
  return createOpenClawHttpTransport(options);
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
