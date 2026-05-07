import { createRemoteMessage } from "@beeper/pickle-bridge";
import type {
  BridgeConfigPart,
  BridgeContext,
  BridgeRequestContext,
  BridgeUser,
  CommandHandlingBridgeConnector,
  DBMetaTypes,
  FetchMessagesResponse,
  LoginFlow,
  LoginProcessCookies,
  LoginProcessDisplayAndWait,
  LoginProcessUserInput,
  LoginProcess,
  LoginStep,
  MatrixMessage,
  MatrixMessageResponse,
  MatrixCommand,
  MatrixCommandResponse,
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

export class DummyConnector implements CommandHandlingBridgeConnector {
  #options: DummyConnectorOptions;
  #roomCounter = 0;

  constructor(options: DummyConnectorOptions = {}) {
    this.#options = options;
  }

  createLogin(_ctx: BridgeRequestContext, _user: BridgeUser, flowId: string): LoginProcess {
    return new DummyLoginProcess(flowId);
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
    return [
      {
        description: "Create the built-in dummy login.",
        id: "dummy",
        name: "Dummy",
      },
      {
        description: "Create a dummy login from username and password fields.",
        id: "password",
        name: "Password",
      },
      {
        description: "Create a dummy login from browser cookies.",
        id: "cookies",
        name: "Cookies",
      },
      {
        description: "Create a dummy login from browser local storage.",
        id: "local_storage",
        name: "Local storage",
      },
      {
        description: "Create a dummy login after displaying a code and waiting.",
        id: "display_and_wait",
        name: "Display and wait",
      },
    ];
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

  async handleCommand(ctx: BridgeRequestContext, command: MatrixCommand): Promise<MatrixCommandResponse> {
    switch (command.command) {
      case "help":
        return reply([
          "DummyBridge commands:",
          "dummy help",
          "dummy create-room [name]",
          "dummy message [text]",
          "dummy messages [count]",
          "dummy ghost [id]",
          "dummy kick-me",
          "dummy file",
          "dummy media",
          "dummy cat",
          "dummy avatar [id]",
        ].join("\n"));
      case "create-room": {
        const name = command.args.join(" ") || "Pickle DummyBridge";
        const portalId = `dummy-room-${++this.#roomCounter}`;
        const login = { id: LOGIN_ID };
        const ghostMxid = makeGhostMxid("alice", this.#options.serverName ?? "example", this.#options.senderLocalpart);
        const portal = await ctx.bridge.createPortalRoom({
          invite: [command.sender.userId],
          name,
          portalKey: { id: portalId, receiver: login.id },
          topic: "Created from the DummyBridge management room.",
          userId: ghostMxid,
        });
        return reply(`created ${portal.mxid} for ${portalId}`);
      }
      case "message": {
        const text = command.args.join(" ") || "hello from DummyBridge";
        ctx.queueRemoteEvent({ id: LOGIN_ID }, this.#remoteMessage({
          body: text,
          id: `dummy-command-${Date.now()}`,
          portalId: PORTAL_ID,
        }));
        return reply(`queued message: ${text}`);
      }
      case "messages": {
        const count = Math.max(1, Math.min(Number(command.args[0] ?? 3) || 3, 10));
        for (let index = 0; index < count; index += 1) {
          ctx.queueRemoteEvent({ id: LOGIN_ID }, this.#remoteMessage({
            body: `dummy message ${index + 1}/${count}`,
            id: `dummy-command-${Date.now()}-${index}`,
            portalId: PORTAL_ID,
          }));
        }
        return reply(`queued ${count} messages`);
      }
      case "ghost": {
        const localId = command.args[0] ?? "alice";
        return reply(makeGhostMxid(localId, this.#options.serverName ?? "example", this.#options.senderLocalpart));
      }
      case "kick-me":
        await ctx.client.raw.request({
          body: { reason: "DummyBridge kick-me command", user_id: command.sender.userId },
          method: "POST",
          path: `/_matrix/client/v3/rooms/${encodeURIComponent(command.room.mxid)}/kick`,
        });
        return { handled: true };
      case "file":
      case "media":
        return reply("media upload/download is stubbed in the TypeScript dummybridge");
      case "cat":
        return reply("=^._.^=");
      case "avatar":
        return reply(makeGhostMxid(command.args[0] ?? "alice", this.#options.serverName ?? "example", this.#options.senderLocalpart));
      default:
        return reply(`unknown command: ${command.command}`);
    }
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

  #remoteMessage(options: { body: string; id: string; portalId?: string; timestamp?: number }) {
    const messageOptions: Parameters<typeof remoteMessage>[0] = {
      ...options,
    };
    if (this.#options.senderLocalpart !== undefined) messageOptions.senderLocalpart = this.#options.senderLocalpart;
    if (this.#options.serverName !== undefined) messageOptions.serverName = this.#options.serverName;
    return remoteMessage(messageOptions);
  }
}

function reply(text: string): MatrixCommandResponse {
  return { handled: true, text };
}

class DummyLoginProcess implements LoginProcess, LoginProcessUserInput, LoginProcessCookies, LoginProcessDisplayAndWait {
  #cancelled = false;
  #flowId: string;

  constructor(flowId: string) {
    this.#flowId = flowId;
  }

  cancel(): void {
    this.#cancelled = true;
  }

  async start(): Promise<LoginStep> {
    this.#throwIfCancelled();
    if (this.#flowId === "password") {
      return {
        instructions: "Enter any username and password to create a dummy login.",
        stepId: "password",
        type: "user_input",
        userInput: {
          fields: [
            {
              description: "Dummy username",
              id: "username",
              name: "Username",
              type: "username",
            },
            {
              description: "Dummy password",
              id: "password",
              name: "Password",
              type: "password",
            },
          ],
        },
      };
    }
    if (this.#flowId === "cookies" || this.#flowId === "local_storage") {
      const sourceType = this.#flowId === "cookies" ? "cookie" : "local_storage";
      return {
        cookies: {
          fields: [{
            id: "dummy_session",
            required: true,
            sources: [{
              cookieDomain: ".example.invalid",
              name: "dummy_session",
              type: sourceType,
            }],
          }],
          url: "https://example.invalid/login",
        },
        instructions: `Open the dummy login page and provide the dummy_session ${sourceType}.`,
        stepId: this.#flowId,
        type: "cookies",
      };
    }
    if (this.#flowId === "display_and_wait") {
      return {
        displayAndWait: {
          data: "DUMMY-CODE",
          type: "code",
        },
        instructions: "Use the displayed dummy code, then wait for completion.",
        stepId: "display_and_wait",
        type: "display_and_wait",
      };
    }
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

  submitUserInput(input: Record<string, string>): Promise<LoginStep>;
  submitUserInput(ctx: BridgeRequestContext | undefined, input: Record<string, string>): Promise<LoginStep>;
  async submitUserInput(ctxOrInput: BridgeRequestContext | Record<string, string> | undefined, input?: Record<string, string>): Promise<LoginStep> {
    this.#throwIfCancelled();
    const values = input ?? ctxOrInput as Record<string, string>;
    return this.#complete(values.username ? `${LOGIN_ID}:${values.username}` : LOGIN_ID);
  }

  submitCookies(cookies: Record<string, string>): Promise<LoginStep>;
  submitCookies(ctx: BridgeRequestContext | undefined, cookies: Record<string, string>): Promise<LoginStep>;
  async submitCookies(ctxOrCookies: BridgeRequestContext | Record<string, string> | undefined, cookies?: Record<string, string>): Promise<LoginStep> {
    this.#throwIfCancelled();
    const values = cookies ?? ctxOrCookies as Record<string, string>;
    return this.#complete(values.dummy_session ? `${LOGIN_ID}:${values.dummy_session}` : LOGIN_ID);
  }

  async wait(): Promise<LoginStep> {
    this.#throwIfCancelled();
    return this.#complete(`${LOGIN_ID}:display`);
  }

  #complete(userLoginId: string): LoginStep {
    return {
      complete: {
        userLogin: { id: userLoginId },
        userLoginId,
      },
      instructions: "DummyBridge login complete.",
      stepId: "complete",
      type: "complete",
    };
  }

  #throwIfCancelled(): void {
    if (this.#cancelled) {
      throw new Error("Login process cancelled");
    }
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
    return remoteMessage({
      ...options,
      loginId: this.#login.id,
      senderLocalpart: this.#senderLocalpart,
      serverName: this.#serverName,
    });
  }
}

function remoteMessage(options: { body: string; id: string; loginId?: string; portalId?: string; senderLocalpart?: string; serverName?: string; timestamp?: number }) {
  const portalKey = { id: options.portalId ?? PORTAL_ID, receiver: options.loginId ?? LOGIN_ID };
  const sender = makeGhostMxid("alice", options.serverName ?? "example", options.senderLocalpart);
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

function stringBody(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
