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
  it("dispatches a Matrix DM through Pickle into OpenClaw and publishes native stream chunks", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-integration-"));
    const config = createDefaultConfig({
      dataDir: dir,
      gatewayUrl: "ws://gateway",
      homeserver: "https://matrix.example",
      matrixUserId: "@openclawbot:example",
    });
    const transport = fakeTransport({
      events: [
        { event: "assistant.delta", payload: { data: { delta: "hi" }, runId: "run_1", type: "assistant.delta" } },
        { event: "run.completed", payload: { runId: "run_1", type: "run.completed" } },
      ],
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
        "sessions.create": { key: "session_1" },
        "sessions.send": { runId: "run_1", sessionKey: "session_1" },
      },
    });
    const streams = { publish: vi.fn(async () => {}) };
    const registry = new OpenClawBridgeRegistry(resolve(dir, "registry.json"));
    const connector = createOpenClawConnector({
      config,
      registry,
      runtimeFactory: () => new OpenClawGatewayRuntime({ config, transport }),
      streams,
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
      matrix: { sender: "@alice:example" },
      message: "hello",
    }, { expectFinal: false });
    expect(streams.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: "!codex:example",
        sessionKey: "session_1",
      }),
      expect.arrayContaining([expect.objectContaining({ type: "TEXT_MESSAGE_CONTENT" })]),
    );
    expect(registry.getBindingByRoom("!codex:example")).toMatchObject({
      lastMatrixEventId: "$hello",
      lastRunId: "run_1",
      sessionKey: "session_1",
    });
  });

  it("dispatches approval reactions through Pickle into OpenClaw approval resolution", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-approval-integration-"));
    const config = createDefaultConfig({
      dataDir: dir,
      gatewayUrl: "ws://gateway",
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
      streams: { publish: vi.fn(async () => {}) },
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

    expect(transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
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
      init: vi.fn(async () => ({ botUserId: "@openclawbot:example", id: "openclaw" })),
      sendMessage: vi.fn(async () => ({ eventId: "$sent", raw: {}, roomId: "!room:example" })),
    },
    beeper: {} as MatrixClient["beeper"],
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
