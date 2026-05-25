import type { MatrixClient, MatrixClientEvent, MatrixMessageEvent, MatrixSubscription } from "@beeper/pickle";
import { RuntimeBridge } from "@beeper/pickle-bridge";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawConnector, userLoginFromOpenClawConfig } from "./connector";
import { OpenClawGatewayRuntime, type OpenClawGatewayEvent, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClaw bridge integration", () => {
  it("dispatches a Matrix DM through Pickle into OpenClaw", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-integration-"));
    const config = createDefaultConfig({
      dataDir: dir,
      homeserver: "https://matrix.example",
      matrixUserId: "@openclawbot:example",
    });
    const transport = fakeTransport({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
        "sessions.create": { key: "session_1" },
        "sessions.send": { runId: "run_1", sessionKey: "session_1" },
      },
    });
    const registry = new OpenClawBridgeRegistry(resolve(dir, "registry.json"));
    const connector = createOpenClawConnector({
      config,
      registry,
      runtimeFactory: () => new OpenClawGatewayRuntime({ config, transport }),
    });
    const client = createFakeMatrixClient();
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login = userLoginFromOpenClawConfig(config);

    await bridge.start();
    await bridge.loadUserLogin(login);
    bridge.registerPortal({
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@openclaw_agent_codex:matrix.example",
          sessionKey: "agent:codex",
        },
      },
      mxid: "!codex:example",
      portalKey: { id: "agent:codex", receiver: login.id },
      receiver: login.id,
    });

    await expect(bridge.dispatchMatrixEvent(messageEvent({
      body: "hello",
      eventId: "$hello",
      roomId: "!codex:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({
      dispatched: true,
      handlers: 1,
      roomId: "!codex:example",
    });

    expect(transport.request).toHaveBeenCalledWith("sessions.create", {
      agentId: "codex",
    });
    expect(transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$hello",
      key: "session_1",
      matrix: { roomId: "!codex:example", sender: "@alice:example" },
      message: "hello",
    }, { expectFinal: false });
    expect(registry.getBindingByRoom("!codex:example")).toMatchObject({
      lastMatrixEventId: "$hello",
      lastRunId: "run_1",
      sessionKey: "session_1",
    });
  });

  it("ignores approval reactions instead of using fallback approval resolution", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-approval-integration-"));
    const config = createDefaultConfig({
      dataDir: dir,
      homeserver: "https://matrix.example",
      matrixUserId: "@openclawbot:example",
    });
    const transport = fakeTransport({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
        "exec.approval.resolve": { ok: true },
      },
    });
    const registry = new OpenClawBridgeRegistry(resolve(dir, "registry.json"));
    const connector = createOpenClawConnector({
      config,
      registry,
      runtimeFactory: () => new OpenClawGatewayRuntime({ config, transport }),
    });
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, createFakeMatrixClient());
    const login = userLoginFromOpenClawConfig(config);

    await bridge.start();
    await bridge.loadUserLogin(login);
    bridge.registerPortal({
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@openclaw_agent_codex:matrix.example",
          sessionKey: "agent:codex",
        },
      },
      mxid: "!codex:example",
      portalKey: { id: "agent:codex", receiver: login.id },
      receiver: login.id,
    });

    await expect(bridge.dispatchMatrixEvent(reactionEvent({
      eventId: "$approve-reaction",
      key: "approval.allow_once",
      relatesTo: "approval_1",
      roomId: "!codex:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({
      dispatched: true,
      handlers: 1,
      kind: "reaction",
      roomId: "!codex:example",
    });

    expect(transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
    });
  });

  it("dispatches Matrix edits, emoji reactions, and redactions while ignoring receipt-only state as agent turns", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-relations-integration-"));
    const config = createDefaultConfig({
      dataDir: dir,
      homeserver: "https://matrix.example",
      matrixUserId: "@openclawbot:example",
    });
    const transport = fakeTransport({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
        "sessions.send": { runId: "run_relation", sessionKey: "agent:codex:session_1" },
      },
    });
    const registry = new OpenClawBridgeRegistry(resolve(dir, "registry.json"));
    const connector = createOpenClawConnector({
      config,
      registry,
      runtimeFactory: () => new OpenClawGatewayRuntime({ config, transport }),
    });
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, createFakeMatrixClient());
    const login = userLoginFromOpenClawConfig(config);

    await bridge.start();
    await bridge.loadUserLogin(login);
    bridge.registerPortal({
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@openclaw_agent_codex:matrix.example",
          sessionKey: "agent:codex:session_1",
        },
      },
      mxid: "!codex:example",
      portalKey: { id: "agent:codex", receiver: login.id },
      receiver: login.id,
    });

    await expect(bridge.dispatchMatrixEvent(editEvent({
      body: "corrected",
      eventId: "$edit",
      replaces: "$old",
      roomId: "!codex:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({ dispatched: true, handlers: 1, roomId: "!codex:example" });
    await expect(bridge.dispatchMatrixEvent(reactionEvent({
      eventId: "$react",
      key: "👍",
      relatesTo: "$old",
      roomId: "!codex:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({ dispatched: true, handlers: 1, kind: "reaction" });
    await expect(bridge.dispatchMatrixEvent(redactionEvent({
      eventId: "$redact",
      redacts: "$old",
      roomId: "!codex:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({ dispatched: true, handlers: 1, kind: "redaction" });
    await expect(bridge.dispatchMatrixEvent(receiptEvent({
      eventId: "$old",
      roomId: "!codex:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({ dispatched: true, handlers: 1, kind: "receipt" });
    await expect(bridge.dispatchMatrixEvent(markedUnreadEvent({
      roomId: "!codex:example",
      sender: "@alice:example",
      unread: true,
    }))).resolves.toMatchObject({ dispatched: true, handlers: 1, kind: "accountData" });

    expect(transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$edit:edit",
      matrix: expect.objectContaining({
        relation: expect.objectContaining({ kind: "edit", targetEventId: "$old" }),
      }),
      message: "corrected",
      replyTo: { eventId: "$old", roomId: "!codex:example" },
    }), { expectFinal: false });
    expect(transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$react",
      matrix: expect.objectContaining({
        relation: expect.objectContaining({ key: "👍", kind: "reaction", targetEventId: "$old" }),
      }),
      message: "Reacted 👍 to $old",
      replyTo: { eventId: "$old", roomId: "!codex:example" },
    }), { expectFinal: false });
    expect(transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$redact",
      matrix: expect.objectContaining({
        relation: expect.objectContaining({ kind: "redaction", targetEventId: "$old" }),
      }),
      message: "Redacted message $old",
      replyTo: { eventId: "$old", roomId: "!codex:example" },
    }), { expectFinal: false });
    const sessionSendPayloads = transport.request.mock.calls
      .filter(([method]) => method === "sessions.send")
      .map(([, payload]) => payload);
    expect(sessionSendPayloads).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ message: "Read receipt for $old" }),
      expect.objectContaining({ message: "Marked room unread" }),
    ]));
  });

  it("smokes contact DM creation, Matrix ingress, approval, and backfill with local fakes", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-local-smoke-"));
    const config = createDefaultConfig({
      accessToken: "mx-token",
      dataDir: dir,
      homeserver: "https://matrix.example",
      importSources: ["dashboard"],
      matrixDeviceId: "DEVICE",
      matrixUserId: "@openclawbot:example",
    });
    const transport = fakeTransport({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
        "chat.history": { messages: [{ content: "older desktop turn", id: "m1", role: "user" }] },
        "exec.approval.resolve": { ok: true },
        "sessions.create": { key: "session_1" },
        "sessions.list": { sessions: [{ displayName: "Desktop chat", key: "agent:codex:desktop", origin: { surface: "mac-app" } }] },
        "sessions.send": { runId: "run_1", sessionKey: "session_1" },
      },
    });
    const registry = new OpenClawBridgeRegistry(resolve(dir, "registry.json"));
    const client = createFakeMatrixClient();
    const connector = createOpenClawConnector({
      config,
      registry,
      runtimeFactory: () => new OpenClawGatewayRuntime({ config, transport }),
    });
    const bridge = new RuntimeBridge({ connector, matrix: matrixConfig() }, client);
    const login = userLoginFromOpenClawConfig(config);

    await bridge.start();
    await bridge.loadUserLogin(login);

    await expect(bridge.resolveIdentifier(login, {
      createDM: false,
      identifier: "codex",
      type: "username",
    })).resolves.toMatchObject({
      ghost: {
        displayName: "Codex",
        mxid: "@openclaw_agent_codex:matrix.example",
      },
    });

    const resolved = await bridge.resolveIdentifier(login, {
      createDM: true,
      identifier: "codex",
      type: "username",
    });
    expect(resolved.portal).toMatchObject({
      id: "session:c2Vzc2lvbl8x",
      mxid: "!created:example",
      portalKey: { id: "session:c2Vzc2lvbl8x", receiver: login.id },
    });
    expect(client.appservice.createPortalRoom).toHaveBeenCalledWith(expect.objectContaining({
      creationContent: { "m.federate": false },
      isDirect: true,
      name: "Codex",
      portalKey: { id: "session:c2Vzc2lvbl8x", receiver: login.id },
      roomType: "dm",
    }));

    await expect(bridge.dispatchMatrixEvent(messageEvent({
      body: "hello",
      eventId: "$hello",
      roomId: "!created:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({
      dispatched: true,
      handlers: 1,
      roomId: "!created:example",
    });

    await expect(bridge.dispatchMatrixEvent(reactionEvent({
      eventId: "$approve",
      key: "approval.allow_once",
      relatesTo: "approval_1",
      roomId: "!created:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({ dispatched: true, kind: "reaction" });
    expect(transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
    });

    await expect(bridge.dispatchMatrixEvent(messageEvent({
      body: "/import",
      eventId: "$import",
      roomId: "!created:example",
      sender: "@alice:example",
    }))).resolves.toMatchObject({ dispatched: true });
    expect(client.appservice.batchSend).toHaveBeenCalledWith(expect.objectContaining({
      events: expect.any(Array),
      roomId: "!created:example",
    }));
    expect(registry.getBindingBySessionKey("agent:codex:desktop")).toMatchObject({
      label: "Desktop chat",
      owner: "imported",
      roomId: "!created:example",
    });
  });
});

function fakeTransport(options: {
  events?: OpenClawGatewayEvent[];
  responses: Record<string, unknown>;
}): OpenClawTransport & { request: ReturnType<typeof vi.fn> } {
  return {
    async *events(filter?: (event: OpenClawGatewayEvent) => boolean) {
      for (const event of options.events ?? []) {
        if (!filter || filter(event)) yield event;
      }
    },
    request: vi.fn(async (method: string) => options.responses[method]),
  };
}

function matrixConfig() {
  return {
    account: {
      accessToken: "matrix-token",
      deviceId: "DEVICE",
      homeserver: "https://matrix.example",
      userId: "@openclawbot:example",
    },
    store: {} as never,
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

function editEvent(options: { body: string; eventId: string; replaces: string; roomId: string; sender: string }): MatrixMessageEvent {
  return {
    attachments: [],
    class: "message",
    content: {
      body: `* ${options.body}`,
      "m.new_content": { body: options.body, msgtype: "m.text" },
      "m.relates_to": { event_id: options.replaces, rel_type: "m.replace" },
      msgtype: "m.text",
    },
    edited: true,
    encrypted: false,
    eventId: options.eventId,
    kind: "message",
    messageType: "m.text",
    raw: {},
    replaces: options.replaces,
    roomId: options.roomId,
    sender: { isMe: false, userId: options.sender },
    text: options.body,
    type: "m.room.message",
  };
}

function reactionEvent(options: { eventId: string; key: string; relatesTo: string; roomId: string; sender: string }): MatrixClientEvent {
  return {
    added: true,
    class: "message",
    content: {
      "m.relates_to": {
        event_id: options.relatesTo,
        key: options.key,
        rel_type: "m.annotation",
      },
    },
    eventId: options.eventId,
    key: options.key,
    kind: "reaction",
    raw: {},
    relatesTo: options.relatesTo,
    roomId: options.roomId,
    sender: { isMe: false, userId: options.sender },
    type: "m.reaction",
  };
}

function redactionEvent(options: { eventId: string; redacts: string; roomId: string; sender: string }): MatrixClientEvent {
  return {
    class: "unknown",
    content: {},
    eventId: options.eventId,
    kind: "redaction",
    raw: { redacts: options.redacts },
    roomId: options.roomId,
    sender: { isMe: false, userId: options.sender },
    type: "m.room.redaction",
  } as MatrixClientEvent;
}

function receiptEvent(options: { eventId: string; roomId: string; sender: string }): MatrixClientEvent {
  return {
    class: "ephemeral",
    content: {
      [options.eventId]: {
        "m.read": {
          [options.sender]: { ts: 1 },
        },
      },
    },
    kind: "receipt",
    raw: {},
    roomId: options.roomId,
    type: "m.receipt",
  } as MatrixClientEvent;
}

function markedUnreadEvent(options: { roomId: string; sender: string; unread: boolean }): MatrixClientEvent {
  return {
    class: "accountData",
    content: { unread: options.unread },
    kind: "accountData",
    raw: {},
    roomId: options.roomId,
    sender: { isMe: false, userId: options.sender },
    type: "m.marked_unread",
  } as MatrixClientEvent;
}

function createFakeMatrixClient(): MatrixClient & { subscription: MatrixSubscription & { stop: ReturnType<typeof vi.fn> } } {
  const subscription = {
    catchUp: vi.fn(async () => {}),
    done: Promise.resolve(),
    stop: vi.fn(async () => {}),
  };
  const beeperStreams = {
    finalizeMessage: vi.fn(async () => ({
      eventId: "$stream-root",
      raw: {},
      replacementEventId: "$stream-final",
      roomId: "!created:example",
    })),
    publishPart: vi.fn(async () => ({})),
    startMessage: vi.fn(async () => ({
      descriptor: { type: "com.beeper.llm" },
      eventId: "$stream-root",
      roomId: "!created:example",
    })),
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
      init: vi.fn(async () => ({ botUserId: "@openclawbot:example", id: "openclaw" })),
      sendMessage: vi.fn(async () => ({ eventId: "$sent", raw: {}, roomId: "!room:example" })),
    },
    beeper: { streams: beeperStreams } as unknown as MatrixClient["beeper"],
    boot: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@openclawbot:example" })),
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
    users: {
      get: vi.fn(async ({ userId }) => ({ raw: {}, userId })),
      getOwnAvatarUrl: vi.fn(async () => ({})),
      getOwnDisplayName: vi.fn(async () => ({ raw: {} })),
      setOwnAvatarUrl: vi.fn(async () => {}),
      setOwnDisplayName: vi.fn(async () => {}),
    },
    whoami: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@openclawbot:example" })),
  };
}
