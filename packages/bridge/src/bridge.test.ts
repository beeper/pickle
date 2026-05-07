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
  LoginProcessCookies,
  LoginProcessDisplayAndWait,
  LoginProcessUserInput,
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

  it("binds login process lifecycle calls to the bridge request context", async () => {
    const client = createFakeMatrixClient();
    const connector = createFakeConnector(createFakeNetworkAPI());
    const rawProcess = {
      cancel: vi.fn(),
      start: vi.fn(async () => loginStep("started")),
      submitCookies: vi.fn(async () => loginStep("cookies")),
      submitUserInput: vi.fn(async () => loginStep("input")),
      wait: vi.fn(async () => loginStep("waited")),
    };
    connector.createLogin.mockResolvedValue(rawProcess);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    const process = await bridge.createLogin({ id: "@alice:example" }, "password");
    await expect(process.start()).resolves.toMatchObject({ stepId: "started" });
    await expect((process as LoginProcessUserInput).submitUserInput({ username: "alice" })).resolves.toMatchObject({ stepId: "input" });
    await expect((process as LoginProcessCookies).submitCookies({ session: "cookie" })).resolves.toMatchObject({ stepId: "cookies" });
    await expect((process as LoginProcessDisplayAndWait).wait()).resolves.toMatchObject({ stepId: "waited" });
    await process.cancel();

    expect(connector.createLogin).toHaveBeenCalledWith(bridge.context, { id: "@alice:example" }, "password");
    expect(rawProcess.start).toHaveBeenCalledWith(bridge.context);
    expect(rawProcess.submitUserInput).toHaveBeenCalledWith(bridge.context, { username: "alice" });
    expect(rawProcess.submitCookies).toHaveBeenCalledWith(bridge.context, { session: "cookie" });
    expect(rawProcess.wait).toHaveBeenCalledWith(bridge.context);
    expect(rawProcess.cancel).toHaveBeenCalledWith(bridge.context);
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

  it("initializes appservice and creates/backfills portal rooms", async () => {
    const client = createFakeMatrixClient();
    const connector = createFakeConnector(createFakeNetworkAPI());
    const bridge = new RuntimeBridge({
      appservice: {
        homeserver: "https://matrix.example",
        homeserverDomain: "example",
        registration: {
          asToken: "as",
          hsToken: "hs",
          id: "test",
          namespaces: { users: [{ exclusive: true, regex: "@test_.*:example" }] },
          senderLocalpart: "testbot",
          url: "http://localhost:29300",
        },
      },
      connector,
      matrix: matrixConfig(),
    }, client);

    await bridge.start();
    const portal = await bridge.createPortalRoom({
      name: "Remote room",
      portalKey: { id: "remote-room", receiver: "login:a" },
      userId: "@test_alice:example",
    });
    const backfill = await bridge.backfill({
      events: [{
        content: { body: "old", msgtype: "m.text" },
        sender: "@test_alice:example",
        timestamp: 1,
      }],
      roomId: portal.mxid!,
    });

    expect(client.appservice.init).toHaveBeenCalledOnce();
    expect(client.appservice.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      name: "Remote room",
      userId: "@test_alice:example",
    }));
    expect(client.appservice.batchSend).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "!created:example",
    }));
    expect(backfill.eventIds).toEqual(["$backfilled"]);
  });

  it("fetches backfill through a loaded network API and imports it through appservice", async () => {
    const client = createFakeMatrixClient();
    const network = {
      ...createFakeNetworkAPI(),
      fetchMessages: vi.fn(async () => ({
        hasMore: false,
        messages: [{
          event: createRemoteMessage({
            convert: () => ({
              parts: [{
                content: { body: "historical", msgtype: "m.text" },
                type: "m.room.message",
              }],
            }),
            data: {},
            id: "history-1",
            portalKey: { id: "remote-room", receiver: "login:a" },
            sender: { isFromMe: false, sender: "@dummy_alice:example" },
            timestamp: new Date("2026-01-01T00:00:00.000Z"),
          }),
        }],
      })),
    };
    const connector = createFakeConnector(network);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login: UserLogin = { id: "login:a" };
    const portal = { id: "remote-room", mxid: "!room:example", portalKey: { id: "remote-room", receiver: login.id } };

    await bridge.start();
    const result = await bridge.backfillMessages(login, { portal });

    expect(network.fetchMessages).toHaveBeenCalledWith(expect.objectContaining({ bridge }), { portal });
    expect(client.appservice.batchSend).toHaveBeenCalledWith({
      events: [{
        content: { body: "historical", msgtype: "m.text" },
        sender: "@dummy_alice:example",
        timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
      }],
      roomId: "!room:example",
    });
    expect(result.eventIds).toEqual(["$backfilled"]);
  });

  it("registers ghosts and manages portal metadata/message requests/status", async () => {
    const client = createFakeMatrixClient();
    const connector = createFakeConnector(createFakeNetworkAPI());
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    bridge.registerGhost({ displayName: "Alice", id: "alice", mxid: "@dummy_alice:example" });
    bridge.registerPortal({ id: "remote-room", mxid: "!room:example", portalKey: { id: "remote-room", receiver: "login:a" } });
    const portal = await bridge.setPortalMetadata({ id: "remote-room", receiver: "login:a" }, { unread: true });
    await bridge.setMessageRequest({
      portalKey: { id: "remote-room", receiver: "login:a" },
      requestedBy: "@alice:example",
      status: "pending",
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await bridge.setBridgeStatus({ message: "limited", state: "degraded", updatedAt: new Date("2026-01-01T00:00:00.000Z") });

    expect(bridge.getGhost("alice")?.displayName).toBe("Alice");
    expect(portal.metadata).toEqual({ unread: true });
    await expect(bridge.getMessageRequest({ id: "remote-room", receiver: "login:a" })).resolves.toEqual(expect.objectContaining({
      status: "pending",
    }));
    expect(bridge.getBridgeState()).toBe("degraded");
    expect(bridge.getBridgeStatus()?.message).toBe("limited");

    await expect(bridge.acceptMessageRequest({ id: "remote-room", receiver: "login:a" })).resolves.toEqual(expect.objectContaining({
      status: "accepted",
    }));
  });

  it("wraps user profile and media helpers around the Matrix client", async () => {
    const client = createFakeMatrixClient();
    const connector = createFakeConnector(createFakeNetworkAPI());
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    await expect(bridge.getUserInfo("@alice:example")).resolves.toEqual({
      avatarUrl: "mxc://example/alice",
      displayName: "Alice",
      raw: {},
      userId: "@alice:example",
    });
    await expect(bridge.getOwnProfile()).resolves.toEqual({
      avatarUrl: "mxc://example/me",
      displayName: "Bridge",
    });
    await bridge.setOwnProfile({ avatarUrl: "mxc://example/new", displayName: "New Bridge" });
    await expect(bridge.uploadMedia({ bytes: new Uint8Array([1, 2]), contentType: "text/plain", filename: "a.txt" })).resolves.toEqual({
      contentUri: "mxc://example/media",
      raw: {},
    });
    await expect(bridge.downloadMedia({ contentUri: "mxc://example/media" })).resolves.toEqual({
      body: new Uint8Array([3, 4]),
      bytes: new Uint8Array([3, 4]),
    });
    await expect(bridge.sendMedia({
      bytes: new Uint8Array([5]),
      contentType: "image/png",
      filename: "image.png",
      kind: "image",
      roomId: "!room:example",
    })).resolves.toEqual({ eventId: "$media", raw: {}, roomId: "!room:example" });

    expect(client.users.get).toHaveBeenCalledWith({ userId: "@alice:example" });
    expect(client.users.setOwnDisplayName).toHaveBeenCalledWith({ displayName: "New Bridge" });
    expect(client.users.setOwnAvatarUrl).toHaveBeenCalledWith({ avatarUrl: "mxc://example/new" });
    expect(client.messages.sendMedia).toHaveBeenCalledWith(expect.objectContaining({ filename: "image.png" }));
  });

  it("creates management rooms and dispatches commands with text replies", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = {
      ...createFakeConnector(network),
      handleCommand: vi.fn(async () => ({ handled: true, text: "pong" })),
    };
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    const room = await bridge.createManagementRoom({
      invite: ["@alice:example"],
      name: "Commands",
      topic: "Bridge commands",
    });
    const result = await bridge.dispatchMatrixEvent({
      attachments: [],
      class: "message",
      content: { body: "test ping verbose", msgtype: "m.text" },
      edited: false,
      encrypted: false,
      eventId: "$cmd",
      kind: "message",
      messageType: "m.text",
      raw: {},
      roomId: room.mxid,
      sender: { isMe: false, userId: "@alice:example" },
      text: "test ping verbose",
      type: "m.room.message",
    });

    expect(client.appservice.createRoom).toHaveBeenCalledWith(expect.objectContaining({
      invite: ["@alice:example"],
      isDirect: false,
      name: "Commands",
    }));
    expect(result).toEqual({ dispatched: true, eventId: "$cmd", handlers: 1, kind: "message", roomId: "!created:example" });
    expect(connector.handleCommand).toHaveBeenCalledWith(
      expect.objectContaining({ bridge }),
      expect.objectContaining({
        args: ["verbose"],
        command: "ping",
        prefix: "test",
        room,
      })
    );
    expect(network.handleMatrixMessage).not.toHaveBeenCalled();
    expect(client.raw.request).toHaveBeenCalledWith({
      body: { body: "pong", msgtype: "m.notice" },
      method: "PUT",
      path: expect.stringContaining("/rooms/!created%3Aexample/send/m.room.message/pickle-bridge-"),
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
    getName: () => ({ defaultCommandPrefix: "test", displayName: "Test", networkId: "test" }),
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

function loginStep(stepId: string) {
  return {
    complete: {
      userLoginId: "login:a",
    },
    instructions: stepId,
    stepId,
    type: "complete" as const,
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
    appservice: {
      batchSend: vi.fn(async () => ({ eventIds: ["$backfilled"], raw: {} })),
      createRoom: vi.fn(async () => ({ raw: {}, roomId: "!created:example" })),
      ensureJoined: vi.fn(async () => {}),
      ensureRegistered: vi.fn(async () => {}),
      init: vi.fn(async () => ({ botUserId: "@testbot:example", id: "test" })),
      sendMessage: vi.fn(async () => ({ eventId: "$sent", raw: {}, roomId: "!room:example" })),
    },
    beeper: {} as MatrixClient["beeper"],
    boot: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@bridge:example" })),
    close: vi.fn(async () => {}),
    crypto: {} as MatrixClient["crypto"],
    logout: vi.fn(async () => {}),
    media: {
      download: vi.fn(async () => ({ bytes: new Uint8Array([3, 4]) })),
      downloadEncrypted: vi.fn(async () => ({ bytes: new Uint8Array([3, 4]) })),
      downloadThumbnail: vi.fn(async () => ({ bytes: new Uint8Array([3, 4]) })),
      upload: vi.fn(async () => ({ contentUri: "mxc://example/media", raw: {} })),
      uploadEncrypted: vi.fn(async () => ({ contentUri: "mxc://example/media", file: {} as never, raw: {} })),
    },
    messages: {
      edit: vi.fn(),
      get: vi.fn(),
      list: vi.fn(),
      markRead: vi.fn(),
      redact: vi.fn(),
      send: vi.fn(),
      sendMedia: vi.fn(async (options) => ({ eventId: "$media", raw: {}, roomId: options.roomId })),
    },
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
    users: {
      get: vi.fn(async ({ userId }) => ({ avatarUrl: "mxc://example/alice", displayName: "Alice", raw: {}, userId })),
      getOwnAvatarUrl: vi.fn(async () => ({ avatarUrl: "mxc://example/me" })),
      getOwnDisplayName: vi.fn(async () => ({ displayName: "Bridge", raw: {} })),
      setOwnAvatarUrl: vi.fn(async () => {}),
      setOwnDisplayName: vi.fn(async () => {}),
    },
    whoami: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@bridge:example" })),
  };
}
