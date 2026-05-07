import { createRemoteMessage } from "@beeper/pickle-bridge";
import type {
  BridgeConfigPart,
  BridgeConnector,
  BridgeContext,
  BridgeRequestContext,
  BridgeUser,
  DBMetaTypes,
  FetchMessagesResponse,
  LoginFlow,
  LoginProcess,
  LoginStep,
  MatrixMessage,
  MatrixMessageResponse,
  NetworkAPI,
  NetworkGeneralCapabilities,
  UserLogin,
} from "@beeper/pickle-bridge/types";

export const LOGIN_ID = "dummy-login";
export const PORTAL_ID = "dummy-room";

export interface DummyConnectorOptions {
  senderLocalpart?: string;
  serverName?: string;
}

export function makeGhostMxid(localId: string, serverName: string, senderLocalpart = "dummybridgebot"): string {
  const escaped = localId.toLowerCase().replace(/[^a-z0-9._=-]/g, "_");
  return `@${senderLocalpart}_${escaped}:${serverName}`;
}

export class DummyConnector implements BridgeConnector {
  #options: DummyConnectorOptions;

  constructor(options: DummyConnectorOptions = {}) {
    this.#options = options;
  }

  createLogin(_ctx: BridgeRequestContext, _user: BridgeUser, _flowId: string): LoginProcess {
    return new DummyLoginProcess();
  }

  getBridgeInfoVersion() {
    return { capabilities: 1, info: 1 };
  }

  getCapabilities(): NetworkGeneralCapabilities {
    return {
      native: true,
    };
  }

  getConfig(): BridgeConfigPart {
    return {
      data: {
        description: "A minimal TypeScript Pickle bridge.",
      },
    };
  }

  getDBMetaTypes(): DBMetaTypes {
    return {};
  }

  getLoginFlows(): LoginFlow[] {
    return [{
      description: "Create the built-in dummy login.",
      id: "dummy",
      name: "Dummy",
    }];
  }

  getName() {
    return {
      beeperBridgeType: "dummybridge",
      defaultCommandPrefix: "dummy",
      displayName: "Pickle DummyBridge",
      networkId: "dummybridge",
    };
  }

  init(ctx: BridgeContext): void {
    ctx.log("info", "dummybridge_init", {});
  }

  loadUserLogin(_ctx: BridgeRequestContext, login: UserLogin): NetworkAPI {
    const options: DummyNetworkOptions = { login };
    if (this.#options.senderLocalpart !== undefined) options.senderLocalpart = this.#options.senderLocalpart;
    if (this.#options.serverName !== undefined) options.serverName = this.#options.serverName;
    return new DummyNetworkAPI(options);
  }

  start(ctx: BridgeContext): void {
    ctx.log("info", "dummybridge_start", {});
  }

  stop(): void {}
}

class DummyLoginProcess implements LoginProcess {
  cancel(): void {}

  async start(): Promise<LoginStep> {
    return {
      complete: {
        userLogin: { id: LOGIN_ID },
        userLoginId: LOGIN_ID,
      },
      instructions: "DummyBridge creates a local dummy login without external auth.",
      stepId: "complete",
      type: "complete",
    };
  }
}

interface DummyNetworkOptions {
  login?: UserLogin;
  senderLocalpart?: string;
  serverName?: string;
}

export class DummyNetworkAPI implements NetworkAPI {
  #login: UserLogin;
  #senderLocalpart: string;
  #serverName: string;

  constructor(options: DummyNetworkOptions = {}) {
    this.#login = options.login ?? { id: LOGIN_ID };
    this.#senderLocalpart = options.senderLocalpart ?? "dummybridgebot";
    this.#serverName = options.serverName ?? "example";
  }

  connect(ctx: BridgeRequestContext): void {
    ctx.log("info", "dummy_network_connected", { login: this.#login.id });
  }

  disconnect(): void {}

  async fetchMessages(): Promise<FetchMessagesResponse> {
    return {
      hasMore: false,
      messages: [
        {
          event: this.#remoteMessage({
            body: "DummyBridge historical hello",
            id: "dummy-history-1",
            timestamp: Date.now() - 60_000,
          }),
        },
      ],
    };
  }

  async handleMatrixMessage(ctx: BridgeRequestContext, msg: MatrixMessage): Promise<MatrixMessageResponse> {
    const body = msg.text || stringBody(msg.content?.body) || "non-text Matrix message";
    ctx.queueRemoteEvent(this.#login, this.#remoteMessage({
      body: `dummy echo: ${body}`,
      id: `dummy-echo-${Date.now()}`,
      portalId: msg.portal?.portalKey?.id ?? PORTAL_ID,
    }));
    return {
      pending: false,
      streamOrder: Date.now(),
    };
  }

  #remoteMessage(options: { body: string; id: string; portalId?: string; timestamp?: number }) {
    const portalKey = { id: options.portalId ?? PORTAL_ID, receiver: this.#login.id };
    const sender = makeGhostMxid("alice", this.#serverName, this.#senderLocalpart);
    return createRemoteMessage({
      convert: () => ({
        parts: [{
          content: {
            body: options.body,
            msgtype: "m.text",
          },
          type: "m.room.message",
        }],
      }),
      data: {},
      id: options.id,
      portalKey,
      sender: {
        isFromMe: false,
        sender,
      },
      timestamp: new Date(options.timestamp ?? Date.now()),
    });
  }
}

function stringBody(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
