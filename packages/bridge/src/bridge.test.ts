import type { MatrixClient, MatrixClientEvent, MatrixSubscription } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { RuntimeBridge } from "./bridge";
import { createRemoteMessage } from "./events";
import type {
  BridgeConnector,
  BridgeContext,
  BridgeMatrixConfig,
  MatrixMessage,
  NetworkAPI,
  UserLogin,
} from "./types";

describe("RuntimeBridge", () => {
  it("boots, initializes connector, subscribes, and stops cleanly", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = createFakeConnector(network);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    expect(client.boot).toHaveBeenCalledOnce();
    expect(connector.init).toHaveBeenCalledOnce();
    expect(connector.start).toHaveBeenCalledOnce();
    expect(client.subscribe).toHaveBeenCalledWith(
      { kind: ["message", "reaction", "redaction", "typing"] },
      expect.any(Function),
      { live: true }
    );

    await bridge.stop();
    expect(client.close).toHaveBeenCalledOnce();
    expect(client.subscription.stop).toHaveBeenCalledOnce();
    expect(connector.stop).toHaveBeenCalledOnce();
  });

  it("loads and connects a user login once", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = createFakeConnector(network);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login: UserLogin = { id: "login:a" };

    await bridge.start();
    await expect(bridge.loadUserLogin(login)).resolves.toBe(network);
    await expect(bridge.loadUserLogin(login)).resolves.toBe(network);

    expect(connector.loadUserLogin).toHaveBeenCalledOnce();
    expect(network.connect).toHaveBeenCalledOnce();
    expect(login.client).toBe(network);
  });

  it("dispatches Matrix messages to loaded network clients", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = createFakeConnector(network);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login: UserLogin = { id: "login:a" };

    await bridge.start();
    await bridge.loadUserLogin(login);
    bridge.registerPortal({ id: "remote-room", mxid: "!room:example", portalKey: { id: "remote-room", receiver: login.id } });

    const result = await bridge.dispatchMatrixEvent({
      attachments: [],
      class: "message",
      content: { body: "hello", msgtype: "m.text" },
      edited: false,
      encrypted: false,
      eventId: "$event",
      kind: "message",
      messageType: "m.text",
      raw: {},
      roomId: "!room:example",
      sender: { isMe: false, userId: "@alice:example" },
      text: "hello",
      type: "m.room.message",
    });

    expect(result).toEqual({ dispatched: true, eventId: "$event", handlers: 1, kind: "message", roomId: "!room:example" });
    const message = network.handleMatrixMessage.mock.calls[0]?.[1] as MatrixMessage;
    expect(message.portal.portalKey).toEqual({ id: "remote-room", receiver: login.id });
    expect(message.text).toBe("hello");
  });

  it("ignores Matrix messages from the bridge user", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = createFakeConnector(network);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    await bridge.loadUserLogin({ id: "login:a" });
    const result = await bridge.dispatchMatrixEvent({
      attachments: [],
      class: "message",
      content: { body: "mine", msgtype: "m.text" },
      edited: false,
      encrypted: false,
      eventId: "$event",
      kind: "message",
      messageType: "m.text",
      raw: {},
      roomId: "!room:example",
      sender: { isMe: false, userId: "@bridge:example" },
      text: "mine",
      type: "m.room.message",
    });

    expect(result.dispatched).toBe(false);
    expect(network.handleMatrixMessage).not.toHaveBeenCalled();
  });

  it("sends queued remote messages to registered Matrix portals", async () => {
    const client = createFakeMatrixClient();
    const connector = createFakeConnector(createFakeNetworkAPI());
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login: UserLogin = { id: "login:a" };

    await bridge.start();
    bridge.registerPortal({ id: "remote-room", mxid: "!room:example", portalKey: { id: "remote-room", receiver: login.id } });
    bridge.queueRemoteEvent(login, createRemoteMessage({
      convert: () => ({
        parts: [{
          content: { body: "hello from remote", msgtype: "m.text" },
          type: "m.room.message",
        }],
      }),
      data: {},
      id: "remote-message",
      portalKey: { id: "remote-room", receiver: login.id },
      sender: { isFromMe: false, sender: "remote-user" },
    }));
    await bridge.flushRemoteEvents();

    expect(client.raw.request).toHaveBeenCalledWith({
      body: { body: "hello from remote", msgtype: "m.text" },
      method: "PUT",
      path: expect.stringContaining("/rooms/!room%3Aexample/send/m.room.message/pickle-bridge-"),
    });
  });
});

function matrixConfig(): BridgeMatrixConfig {
  return {
    homeserver: "https://matrix.example",
    store: {
      delete: async () => {},
      get: async () => null,
      list: async () => [],
      set: async () => {},
    },
    token: "token",
    wasmModule: {} as WebAssembly.Module,
  };
}

function createFakeConnector(network: FakeNetworkAPI): BridgeConnector & {
  init: ReturnType<typeof vi.fn>;
  loadUserLogin: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  return {
    createLogin: vi.fn(async () => ({ cancel: vi.fn(), start: vi.fn() })),
    getBridgeInfoVersion: () => ({ capabilities: 1, info: 1 }),
    getCapabilities: () => ({}),
    getConfig: () => ({}),
    getDBMetaTypes: () => ({}),
    getLoginFlows: () => [],
    getName: () => ({ displayName: "Test", networkId: "test" }),
    init: vi.fn((_ctx: BridgeContext) => {}),
    loadUserLogin: vi.fn(async () => network),
    start: vi.fn(),
    stop: vi.fn(),
  };
}

type FakeNetworkAPI = NetworkAPI & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  handleMatrixMessage: ReturnType<typeof vi.fn>;
};

function createFakeNetworkAPI(): FakeNetworkAPI {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    handleMatrixMessage: vi.fn(),
  };
}

function createFakeMatrixClient(): MatrixClient & { subscription: MatrixSubscription & { stop: ReturnType<typeof vi.fn> } } {
  const subscription = {
    catchUp: vi.fn(async () => {}),
    done: Promise.resolve(),
    stop: vi.fn(async () => {}),
  };
  return {
    accountData: {} as MatrixClient["accountData"],
    beeper: {} as MatrixClient["beeper"],
    boot: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@bridge:example" })),
    close: vi.fn(async () => {}),
    crypto: {} as MatrixClient["crypto"],
    logout: vi.fn(async () => {}),
    media: {} as MatrixClient["media"],
    messages: {} as MatrixClient["messages"],
    raw: {
      request: vi.fn(async () => ({ body: { event_id: "$sent" }, raw: { event_id: "$sent" }, status: 200 })),
    } as unknown as MatrixClient["raw"],
    reactions: {} as MatrixClient["reactions"],
    receipts: {} as MatrixClient["receipts"],
    rooms: {} as MatrixClient["rooms"],
    streams: {} as MatrixClient["streams"],
    subscribe: vi.fn(async (_filter, _handler: (event: MatrixClientEvent) => void | Promise<void>) => subscription),
    subscription,
    sync: {} as MatrixClient["sync"],
    toDevice: {} as MatrixClient["toDevice"],
    typing: {} as MatrixClient["typing"],
    users: {} as MatrixClient["users"],
    whoami: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@bridge:example" })),
  };
}
