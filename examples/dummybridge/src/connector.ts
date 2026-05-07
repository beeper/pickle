import { createRemoteMessage } from "@beeper/pickle-bridge/events";
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
export const DUMMY_CHAT_IDS = ["dummy-chat-alice", "dummy-chat-bob", "dummy-chat-carol"] as const;

export class DummyConnector implements CommandHandlingBridgeConnector {
  #roomCounter = 0;

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
        const portal = await ctx.bridge.createPortal(login, {
          id: portalId,
          invite: [command.sender.userId],
          name,
          sender: "alice",
          topic: "Created from the DummyBridge management room.",
        });
        return reply(`created ${portal.mxid} for ${portalId}`);
      }
      case "message": {
        const text = command.args.join(" ") || "hello from DummyBridge";
        ctx.queue({ id: LOGIN_ID }).message({
          id: `dummy-command-${Date.now()}`,
          portal: PORTAL_ID,
          sender: "alice",
          text,
        });
        return reply(`queued message: ${text}`);
      }
      case "messages": {
        const count = Math.max(1, Math.min(Number(command.args[0] ?? 3) || 3, 10));
        for (let index = 0; index < count; index += 1) {
          ctx.queue({ id: LOGIN_ID }).message({
            id: `dummy-command-${Date.now()}-${index}`,
            portal: PORTAL_ID,
            sender: "alice",
            text: `dummy message ${index + 1}/${count}`,
          });
        }
        return reply(`queued ${count} messages`);
      }
      case "ghost": {
        const localId = command.args[0] ?? "alice";
        return reply(ctx.bridge.ghostUserId(localId));
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
        return reply(ctx.bridge.ghostUserId(command.args[0] ?? "alice"));
      default:
        return reply(`unknown command: ${command.command}`);
    }
  }

  loadUserLogin(ctx: BridgeRequestContext, login: UserLogin): NetworkAPI {
    return new DummyNetworkAPI({ ghostUserId: (localId) => ctx.bridge.ghostUserId(localId), login });
  }

  start(ctx: BridgeContext): void {
    ctx.log("info", "dummybridge_start", {});
  }

  stop(): void {}

  #remoteMessage(ctx: BridgeRequestContext, options: { body: string; id: string; portalId?: string; timestamp?: number }) {
    return remoteMessage({
      ...options,
      ghostUserId: (localId) => ctx.bridge.ghostUserId(localId),
    });
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
  ghostUserId(localId: string): string;
  login?: UserLogin;
}

export class DummyNetworkAPI implements NetworkAPI {
  #ghostUserId: (localId: string) => string;
  #login: UserLogin;

  constructor(options: DummyNetworkOptions) {
    this.#ghostUserId = options.ghostUserId;
    this.#login = options.login ?? { id: LOGIN_ID };
  }

  connect(ctx: BridgeRequestContext): void {
    ctx.log("info", "dummy_network_connected", { login: this.#login.id });
  }

  disconnect(): void {}

  async fetchMessages(): Promise<FetchMessagesResponse> {
    return {
      hasMore: false,
      messages: Array.from({ length: 5 }, (_, index) => ({
        event: this.#remoteMessage({
          body: `DummyBridge historical message ${index + 1}`,
          id: `dummy-history-${index + 1}`,
          timestamp: Date.now() - (5 - index) * 60_000,
        }),
      })),
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
      ghostUserId: this.#ghostUserId,
      loginId: this.#login.id,
    });
  }
}

function remoteMessage(options: { body: string; ghostUserId(localId: string): string; id: string; loginId?: string; portalId?: string; timestamp?: number }) {
  const portalKey = { id: options.portalId ?? PORTAL_ID, receiver: options.loginId ?? LOGIN_ID };
  return createRemoteMessage({
    convert: () => textMessage(options.body),
    data: {},
    id: options.id,
    portalKey,
    sender: {
      isFromMe: false,
      sender: options.ghostUserId("alice"),
    },
    timestamp: new Date(options.timestamp ?? Date.now()),
  });
}

function textMessage(body: string) {
  return {
    parts: [{
      content: {
        body,
        msgtype: "m.text",
      },
      type: "m.room.message",
    }],
  };
}

function stringBody(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
