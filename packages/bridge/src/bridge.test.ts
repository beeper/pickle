import type { MatrixClient, MatrixClientEvent, MatrixMessageEvent, MatrixSubscription } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { RuntimeBridge } from "./bridge";
import { createRemoteMessage } from "./events";
import type { BridgeDataStore } from "./store";
import type {
  BridgeConnector,
  BridgeContext,
  BridgeMatrixConfig,
  BackfillQueueResult,
  BackfillQueueTask,
  FetchMessagesParams,
  FetchMessagesResponse,
  MatrixMessage,
  MessageCheckpoint,
  MessageCheckpoints,
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
      { kind: ["message", "reaction", "redaction", "typing", "toDevice"] },
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

  it("auto-loads persisted user logins on startup", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = createFakeConnector(network);
    const dataStore = createFakeBridgeDataStore([{ id: "login:a", remoteName: "Alice", userId: "@alice:example" }]);
    const bridge = new RuntimeBridge({ connector, dataStore, matrix: matrixConfig() }, client);

    await bridge.start();

    expect(dataStore.listUserLogins).toHaveBeenCalledOnce();
    expect(connector.loadUserLogin).toHaveBeenCalledWith(bridge.context, expect.objectContaining({ id: "login:a" }));
    expect(network.connect).toHaveBeenCalledWith(expect.objectContaining({
      login: expect.objectContaining({ id: "login:a" }),
    }));
  });

  it("persists bridgev2 lifecycle payloads and per-login state", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = createFakeConnector(network);
    const dataStore = createFakeBridgeDataStore();
    const bridge = new RuntimeBridge({ connector, dataStore, matrix: matrixConfig() }, client);

    await bridge.start();
    await bridge.loadUserLogin({ id: "login:a", remoteName: "Alice", userId: "@alice:example" });

    expect(dataStore.setBridgeStatus).toHaveBeenLastCalledWith(expect.objectContaining({
      bridgeState: expect.objectContaining({
        source: "bridge",
        state_event: "RUNNING",
        timestamp: expect.any(Number),
        ttl: 21600,
      }),
      logins: {
        "login:a": expect.objectContaining({
          remote_id: "login:a",
          remote_name: "Alice",
          state_event: "CONNECTED",
          user_id: "@alice:example",
        }),
      },
      state: "running",
    }));
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
      info: { name: "Remote room" },
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
    expect(client.appservice.createPortalRoom).toHaveBeenCalledWith(expect.objectContaining({
      bridge: expect.objectContaining({ networkId: "test" }),
      name: "Remote room",
      userId: "@test_alice:example",
    }));
    expect(client.appservice.batchSend).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "!created:example",
    }));
    expect(backfill.eventIds).toEqual(["$backfilled"]);
  });

  it("adds Beeper room metadata and autojoin members for Beeper bridges", async () => {
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
      beeper: {
        bridge: "test",
        ownerUserId: "@alice:example",
      },
      connector,
      matrix: matrixConfig(),
    }, client);

    await bridge.start();
    await bridge.createManagementRoom({
      name: "Test management",
    });
    await bridge.createPortalRoom({
      info: { name: "Remote room" },
      portalKey: { id: "remote-room", receiver: "login:a" },
      userId: "@test_bob:example",
    });

    expect(client.appservice.createManagementRoom).toHaveBeenCalledWith(expect.objectContaining({
      autoJoinInvites: true,
      initialMembers: ["@alice:example"],
      invite: ["@alice:example"],
    }));
    expect(client.appservice.createPortalRoom).toHaveBeenCalledWith(expect.objectContaining({
      autoJoinInvites: true,
      bridge: expect.objectContaining({ displayName: "Test", networkId: "test" }),
      bridgeName: "test",
      initialMembers: ["@alice:example"],
      invite: ["@alice:example"],
      name: "Remote room",
      portalKey: { id: "remote-room", receiver: "login:a" },
      userId: "@test_bob:example",
    }));
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

  it("forwards bridgev2-style backfill pagination params to the loaded network API", async () => {
    const client = createFakeMatrixClient();
    const network = {
      ...createFakeNetworkAPI(),
      fetchMessages: vi.fn(async (_ctx, params: FetchMessagesParams): Promise<FetchMessagesResponse> => ({
        cursor: "next-cursor",
        forward: params.forward,
        hasMore: true,
        markRead: true,
        messages: [],
        progress: {
          approximate: 0.5,
          remainingCount: 10,
          totalCount: 20,
        },
      })),
    };
    const connector = createFakeConnector(network);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login: UserLogin = { id: "login:a" };
    const portal = { id: "remote-room", mxid: "!room:example", portalKey: { id: "remote-room", receiver: login.id } };
    const task: BackfillQueueTask = {
      batchCount: 2,
      cursor: "prev-cursor",
      pending: true,
      portalKey: portal.portalKey,
      userLoginId: login.id,
    };

    await bridge.start();
    await bridge.backfillMessages(login, {
      count: 25,
      cursor: "prev-cursor",
      forward: true,
      portal,
      task,
      threadRoot: "thread-root",
    });

    expect(network.fetchMessages).toHaveBeenCalledWith(expect.objectContaining({ bridge }), {
      count: 25,
      cursor: "prev-cursor",
      forward: true,
      portal,
      task,
      threadRoot: "thread-root",
    });
    expect(client.appservice.batchSend).toHaveBeenCalledWith({ events: [], roomId: "!room:example" });
  });

  it("defines bridgev2-style backfill queue results and message checkpoint envelopes", () => {
    const task = {
      batchCount: 3,
      bridgeId: "dummy",
      completedAt: new Date("2026-01-01T00:10:00.000Z"),
      cursor: "cursor",
      dispatchedAt: new Date("2026-01-01T00:00:00.000Z"),
      done: false,
      nextDispatchAt: new Date("2026-01-01T00:11:00.000Z"),
      oldestMessageId: "message-oldest",
      pending: true,
      portalKey: { id: "remote-room", receiver: "login:a" },
      userLoginId: "login:a",
    } satisfies BackfillQueueTask;
    const result = {
      cursor: "next-cursor",
      forward: false,
      hasMore: true,
      markRead: true,
      pending: true,
      progress: {
        approximate: 0.25,
        remainingCount: 75,
        totalCount: 100,
      },
      queued: true,
      task,
    } satisfies BackfillQueueResult;
    const checkpoint = {
      eventId: "$event",
      eventType: "m.room.message",
      reportedBy: "BRIDGE",
      retryNum: 0,
      roomId: "!room:example",
      status: "SUCCESS",
      step: "REMOTE",
      timestamp: Date.parse("2026-01-01T00:00:00.000Z"),
    } satisfies MessageCheckpoint;
    const envelope = {
      checkpoints: [checkpoint],
    } satisfies MessageCheckpoints;

    expect(result).toMatchObject({
      cursor: "next-cursor",
      markRead: true,
      pending: true,
      progress: { approximate: 0.25 },
      queued: true,
    });
    expect(envelope.checkpoints).toEqual([checkpoint]);
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

    expect(client.appservice.createManagementRoom).toHaveBeenCalledWith(expect.objectContaining({
      invite: ["@alice:example"],
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

  it("sends management command replies through the appservice bot when registered", async () => {
    const client = createFakeMatrixClient();
    const connector = {
      ...createFakeConnector(createFakeNetworkAPI()),
      handleCommand: vi.fn(async () => ({ handled: true, text: "pong" })),
    };
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
    await bridge.dispatchMatrixEvent({
      attachments: [],
      class: "message",
      content: { body: "test ping", msgtype: "m.text" },
      edited: false,
      encrypted: false,
      eventId: "$cmd",
      kind: "message",
      messageType: "m.text",
      raw: {},
      roomId: "!management:example",
      sender: { isMe: false, userId: "@bridge:example" },
      text: "test ping",
      type: "m.room.message",
    });

    expect(client.appservice.sendMessage).toHaveBeenCalledWith({
      content: { body: "pong", msgtype: "m.notice" },
      roomId: "!management:example",
      userId: "@testbot:example",
    });
    expect(client.raw.request).not.toHaveBeenCalledWith(expect.objectContaining({
      path: expect.stringContaining("/rooms/!management%3Aexample/send/m.room.message/"),
    }));
  });

  it("handles built-in commands before connector command fallback", async () => {
    const client = createFakeMatrixClient();
    const connector = {
      ...createFakeConnector(createFakeNetworkAPI()),
      handleCommand: vi.fn(async () => ({ handled: true, text: "connector help" })),
    };
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    bridge.registerManagementRoom({ mxid: "!management:example" });
    const result = await bridge.dispatchMatrixEvent(messageEvent({
      body: "help",
      eventId: "$help",
      roomId: "!management:example",
      sender: "@alice:example",
    }));

    expect(result).toEqual({ dispatched: true, eventId: "$help", handlers: 1, kind: "message", roomId: "!management:example" });
    expect(connector.handleCommand).not.toHaveBeenCalled();
    expect(client.raw.request).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ body: expect.stringContaining("Available commands:") }),
    }));
  });

  it("requires the command prefix outside management rooms and owner implicit management", async () => {
    const client = createFakeMatrixClient();
    const connector = {
      ...createFakeConnector(createFakeNetworkAPI()),
      handleCommand: vi.fn(async () => ({ handled: true, text: "pong" })),
    };
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
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "test help",
      eventId: "$prefixed",
      roomId: "!ordinary:example",
      sender: "@alice:example",
    }));
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "help",
      eventId: "$unprefixed",
      roomId: "!ordinary:example",
      sender: "@alice:example",
    }));
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "help",
      eventId: "$owner",
      roomId: "!owner-dm:example",
      sender: "@bridge:example",
    }));

    expect(connector.handleCommand).not.toHaveBeenCalled();
    expect(client.appservice.sendMessage).toHaveBeenCalledTimes(2);
    expect(client.appservice.sendMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      content: expect.objectContaining({ body: expect.stringContaining("Available commands:") }),
    }));
    expect(client.appservice.sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      content: expect.objectContaining({ body: expect.stringContaining("Available commands:") }),
    }));
  });

  it("does not treat persisted portal rooms as implicit management rooms", async () => {
    const client = createFakeMatrixClient();
    const dataStore = createFakeBridgeDataStore();
    const portal = { id: "remote-room", mxid: "!portal:example", portalKey: { id: "remote-room", receiver: "login:a" } };
    dataStore.listPortals.mockResolvedValue([portal]);
    dataStore.listUserLogins.mockResolvedValue([{ id: "login:a", userId: "@bridge:example" }]);
    const network = {
      ...createFakeNetworkAPI(),
      handleMatrixMessage: vi.fn(async () => ({ handled: true })),
    };
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
      connector: createFakeConnector(network),
      dataStore,
      matrix: matrixConfig(),
    }, client);

    await bridge.start();
    const result = await bridge.dispatchMatrixEvent(messageEvent({
      body: "help",
      eventId: "$portal-help",
      roomId: "!portal:example",
      sender: "@bridge:example",
    }));

    expect(result).toEqual({ dispatched: true, eventId: "$portal-help", handlers: 1, kind: "message", roomId: "!portal:example" });
    expect(network.handleMatrixMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ portal })
    );
    expect(client.raw.request).not.toHaveBeenCalled();
  });

  it("promotes and persists management rooms through the built-in command", async () => {
    const client = createFakeMatrixClient();
    const connector = createFakeConnector(createFakeNetworkAPI());
    const dataStore = {
      ...createFakeDataStore(),
      setManagementRoom: vi.fn(async () => {}),
    };
    const bridge = new RuntimeBridge({ connector, dataStore, matrix: matrixConfig() }, client);

    await bridge.start();
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "test set-management-room",
      eventId: "$set",
      roomId: "!ordinary:example",
      sender: "@alice:example",
    }));
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "help",
      eventId: "$help",
      roomId: "!ordinary:example",
      sender: "@alice:example",
    }));

    expect(dataStore.setManagementRoom).toHaveBeenCalledWith({ mxid: "!ordinary:example" });
    expect(client.raw.request).toHaveBeenCalledTimes(2);
    expect(client.raw.request).toHaveBeenNthCalledWith(2, expect.objectContaining({
      body: expect.objectContaining({ body: expect.stringContaining("Available commands:") }),
    }));
  });

  it("handles login lifecycle built-ins", async () => {
    const client = createFakeMatrixClient();
    const network = createFakeNetworkAPI();
    const connector = {
      ...createFakeConnector(network),
      getLoginFlows: () => [{ description: "Password login", id: "password", name: "Password" }],
    };
    const pendingProcess = {
      cancel: vi.fn(async () => {}),
      start: vi.fn(async () => ({ instructions: "Scan the code", stepId: "qr", type: "display_and_wait" as const })),
    };
    const completeProcess = {
      cancel: vi.fn(async () => {}),
      start: vi.fn(async () => loginStep("completed")),
    };
    connector.createLogin
      .mockResolvedValueOnce(pendingProcess)
      .mockResolvedValueOnce(completeProcess);
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);

    await bridge.start();
    bridge.registerManagementRoom({ mxid: "!management:example" });
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "login password",
      eventId: "$login-pending",
      roomId: "!management:example",
      sender: "@alice:example",
    }));
    const startedBody = commandReplyBody(client, 0);
    const pendingLoginId = /Login started: (login-\S+)/.exec(startedBody)?.[1];
    expect(pendingLoginId).toBeTruthy();

    await bridge.dispatchMatrixEvent(messageEvent({
      body: `cancel-login ${pendingLoginId}`,
      eventId: "$cancel",
      roomId: "!management:example",
      sender: "@alice:example",
    }));
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "login password",
      eventId: "$login-complete",
      roomId: "!management:example",
      sender: "@alice:example",
    }));
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "list-logins",
      eventId: "$list",
      roomId: "!management:example",
      sender: "@alice:example",
    }));
    await bridge.dispatchMatrixEvent(messageEvent({
      body: "logout login:a",
      eventId: "$logout",
      roomId: "!management:example",
      sender: "@alice:example",
    }));

    expect(pendingProcess.cancel).toHaveBeenCalledOnce();
    expect(connector.loadUserLogin).toHaveBeenCalledWith(expect.objectContaining({ bridge }), expect.objectContaining({ id: "login:a" }));
    expect(commandReplyBody(client, 3)).toContain("login:a");
    expect(network.disconnect).toHaveBeenCalledOnce();
    expect(commandReplyBody(client, 4)).toBe("Logged out: login:a");
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

function createFakeBridgeDataStore(logins: UserLogin[] = []): BridgeDataStore & {
  listUserLogins: ReturnType<typeof vi.fn>;
  setBridgeStatus: ReturnType<typeof vi.fn>;
} {
  return {
    deletePortal: vi.fn(async () => {}),
    getAccount: vi.fn(async () => null),
    getBridgeState: vi.fn(async () => null),
    getBridgeStatus: vi.fn(async () => null),
    getGhost: vi.fn(async () => null),
    getMessage: vi.fn(async () => null),
    getMessageRequest: vi.fn(async () => null),
    getPortal: vi.fn(async () => null),
    getPortalByMXID: vi.fn(async () => null),
    getUserLogin: vi.fn(async (id: string) => logins.find((login) => login.id === id) ?? null),
    listGhosts: vi.fn(async () => []),
    listPortals: vi.fn(async () => []),
    listUserLogins: vi.fn(async () => logins),
    setAccount: vi.fn(async () => {}),
    setBridgeState: vi.fn(async () => {}),
    setBridgeStatus: vi.fn(async () => {}),
    setGhost: vi.fn(async () => {}),
    setManagementRoom: vi.fn(async () => {}),
    setMessage: vi.fn(async () => {}),
    setMessageRequest: vi.fn(async () => {}),
    setPortal: vi.fn(async () => {}),
    setUserLogin: vi.fn(async () => {}),
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

function messageEvent(options: { body: string; eventId: string; roomId: string; sender: string }): MatrixMessageEvent {
  return {
    attachments: [],
    class: "message",
    content: { body: options.body, msgtype: "m.text" },
    edited: false,
    encrypted: false,
    eventId: options.eventId,
    kind: "message",
    messageType: "m.text",
    raw: {},
    roomId: options.roomId,
    sender: { isMe: false, userId: options.sender },
    text: options.body,
    type: "m.room.message",
  };
}

function commandReplyBody(client: ReturnType<typeof createFakeMatrixClient>, index: number): string {
  return (client.raw.request as ReturnType<typeof vi.fn>).mock.calls[index]?.[0]?.body?.body;
}

function createFakeDataStore() {
  return {
    deletePortal: vi.fn(async () => {}),
    getAccount: vi.fn(async () => null),
    getBridgeState: vi.fn(async () => null),
    getBridgeStatus: vi.fn(async () => null),
    getGhost: vi.fn(async () => null),
    getMessage: vi.fn(async () => null),
    getMessageRequest: vi.fn(async () => null),
    getPortal: vi.fn(async () => null),
    getPortalByMXID: vi.fn(async () => null),
    getUserLogin: vi.fn(async () => null),
    listGhosts: vi.fn(async () => []),
    listPortals: vi.fn(async () => []),
    listUserLogins: vi.fn(async () => []),
    setAccount: vi.fn(async () => {}),
    setBridgeState: vi.fn(async () => {}),
    setBridgeStatus: vi.fn(async () => {}),
    setGhost: vi.fn(async () => {}),
    setManagementRoom: vi.fn(async () => {}),
    setMessage: vi.fn(async () => {}),
    setMessageRequest: vi.fn(async () => {}),
    setPortal: vi.fn(async () => {}),
    setUserLogin: vi.fn(async () => {}),
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
      createManagementRoom: vi.fn(async () => ({ raw: {}, roomId: "!created:example" })),
      createPortalRoom: vi.fn(async () => ({ raw: {}, roomId: "!created:example" })),
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
