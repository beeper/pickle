import { describe, expect, it, vi } from "vitest";
import { backfillAllOpenClawSessions, buildBackfillImport, discoverOneToOneSessions, isOneToOneSession, shouldImportSession } from "./backfill";
import { createDefaultConfig } from "./config";
import { OpenClawGatewayRuntime, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClaw backfill", () => {
  it("discovers terminal, mac app, and DM-like sessions while skipping group sessions", async () => {
    const runtime = runtimeWith({
      "sessions.list": {
        sessions: [
          { key: "agent:main:terminal:local", origin: { surface: "terminal" } },
          { key: "agent:main:desktop:abc", origin: { surface: "mac-app" } },
          { chatType: "dm", key: "agent:main:whatsapp:user-1", lastTo: "user-1" },
          { chatType: "group", key: "agent:main:whatsapp:group-1", lastTo: "a,b" },
        ],
      },
    });

    await expect(discoverOneToOneSessions(runtime, { importSources: ["dashboard", "tui", "channels"] })).resolves.toEqual([
      {
        agentId: "main",
        label: "agent:main:terminal:local",
        session: { key: "agent:main:terminal:local", origin: { surface: "terminal" } },
        sessionKey: "agent:main:terminal:local",
        source: "terminal",
      },
      {
        agentId: "main",
        label: "agent:main:desktop:abc",
        session: { key: "agent:main:desktop:abc", origin: { surface: "mac-app" } },
        sessionKey: "agent:main:desktop:abc",
        source: "mac-app",
      },
      {
        agentId: "main",
        human: {
          displayName: "user-1",
          ghostUserId: "@openclaw_user_user-1:localhost",
          userId: "user-1",
        },
        label: "agent:main:whatsapp:user-1",
        session: { chatType: "dm", key: "agent:main:whatsapp:user-1", lastTo: "user-1" },
        sessionKey: "agent:main:whatsapp:user-1",
        source: "unknown",
      },
    ]);
  });

  it("builds import bindings and normalized Matrix backfill messages", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T12:00:00.000Z"));
    const runtime = runtimeWith({
      "chat.history": {
        messages: [
          { content: "hello", createdAt: "2026-05-16T11:59:00.000Z", id: "m1", messageSeq: 1, role: "user" },
          { content: [{ text: "hi" }], id: "m2", messageSeq: 2, role: "assistant", timestamp: 1_779_000_000 },
        ],
      },
    });
    try {
      await expect(buildBackfillImport(runtime, createDefaultConfig({ dataDir: "/tmp/openclaw" }), {
        agentId: "main",
        human: {
          displayName: "Alice",
          ghostUserId: "@openclaw_user_alice:localhost",
          userId: "alice",
        },
        label: "Terminal",
        session: { key: "agent:main:terminal:local" },
        sessionKey: "agent:main:terminal:local",
        source: "terminal",
      }, {
        limit: 50,
        roomId: "!room:example.com",
      })).resolves.toMatchObject({
        binding: {
          agentId: "main",
          ghostUserId: "@openclaw_agent_main:localhost",
          humanGhostUserId: "@openclaw_user_alice:localhost",
          label: "Terminal",
          owner: "imported",
          roomId: "!room:example.com",
          sessionKey: "agent:main:terminal:local",
        },
        human: {
          displayName: "Alice",
          ghostUserId: "@openclaw_user_alice:localhost",
          userId: "alice",
        },
        messages: [
          {
            content: {
              body: "hello",
              msgtype: "m.notice",
              "com.beeper.openclaw.backfill": { messageSeq: 1, role: "user" },
            },
            id: "m1",
            role: "user",
            sender: "human",
            seq: 1,
            timestamp: new Date("2026-05-16T11:59:00.000Z"),
          },
          {
            content: {
              body: "hi",
              msgtype: "m.text",
              "com.beeper.openclaw.backfill": { messageSeq: 2, role: "assistant" },
            },
            id: "m2",
            role: "assistant",
            sender: "agent",
            seq: 2,
            timestamp: new Date(1_779_000_000_000),
          },
        ],
        source: "terminal",
      });
      expect(runtime.transport.request).toHaveBeenCalledWith("chat.history", {
        limit: 50,
        sessionKey: "agent:main:terminal:local",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("classifies one-to-one sessions conservatively", () => {
    expect(isOneToOneSession({ chatType: "direct", key: "agent:main:direct:user" })).toBe(true);
    expect(isOneToOneSession({ key: "agent:main:whatsapp:user", lastTo: "user" })).toBe(true);
    expect(isOneToOneSession({ chatType: "group", key: "agent:main:group", lastTo: "a,b" })).toBe(false);
  });

  it("filters backfill sessions by opt-in import source and archived state", async () => {
    expect(shouldImportSession({ key: "agent:main:terminal:local", origin: { surface: "terminal" } }, ["tui"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:desktop:abc", origin: { surface: "mac-app" } }, ["dashboard"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:whatsapp:alice", lastProvider: "whatsapp" }, ["channels"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:terminal:old", origin: { surface: "terminal" }, updatedAt: null }, ["tui"])).toBe(false);
    expect(shouldImportSession({ key: "agent:main:terminal:old", origin: { surface: "terminal" }, updatedAt: null }, ["tui", "archived"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:desktop:abc", origin: { surface: "mac-app" } }, ["tui"])).toBe(false);

    const runtime = runtimeWith({
      "sessions.list": {
        sessions: [
          { key: "agent:main:terminal:local", origin: { surface: "terminal" } },
          { key: "agent:main:desktop:abc", origin: { surface: "mac-app" } },
          { chatType: "dm", key: "agent:main:whatsapp:user-1", lastProvider: "whatsapp", lastTo: "user-1" },
        ],
      },
    });
    await expect(discoverOneToOneSessions(runtime, { importSources: ["dashboard"] })).resolves.toMatchObject([
      { sessionKey: "agent:main:desktop:abc", source: "mac-app" },
    ]);
  });

  it("creates portals and imports every discovered one-to-one session", async () => {
    const runtime = runtimeWith({
      "chat.history": { messages: [{ content: "hello", id: "m1", role: "user" }] },
      "sessions.list": {
        sessions: [
          { agentId: "codex", chatType: "dm", displayName: "Alice", key: "agent:codex:whatsapp:alice", lastProvider: "whatsapp", lastTo: "alice" },
        ],
      },
    });
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-backfill-test.json");
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(async () => ({
        id: "session:created",
        mxid: "!room:example.com",
        portalKey: { id: "session:created", receiver: "login" },
        receiver: "login",
      })),
    };
    const login = { id: "login", userId: "@owner:example.com" };

    await expect(backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["channels"],
      limit: 25,
      login,
      registry,
      runtime,
    })).resolves.toMatchObject({
      portals: [{ mxid: "!room:example.com" }],
      sessions: [{ agentId: "codex", sessionKey: "agent:codex:whatsapp:alice" }],
      skipped: [],
    });

    expect(bridge.createPortal).toHaveBeenCalledWith(login, expect.objectContaining({
      creationContent: { "m.federate": false },
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@openclaw_agent_codex:localhost",
          humanGhostUserId: "@openclaw_user_alice:localhost",
          sessionKey: "agent:codex:whatsapp:alice",
          source: "channel",
        },
      },
      name: "Alice",
      roomType: "dm",
      sender: "codex",
    }));
    expect(bridge.backfillPortal).toHaveBeenCalledWith(login, expect.objectContaining({
      mxid: "!room:example.com",
    }), { limit: 25 });
    expect(registry.getUser("alice")?.ghostUserId).toBe("@openclaw_user_alice:localhost");
    expect(registry.getBindingByRoom("!room:example.com")?.humanGhostUserId).toBe("@openclaw_user_alice:localhost");
  });

  it("skips already-imported sessions instead of creating duplicate portals", async () => {
    const runtime = runtimeWith({
      "sessions.list": {
        sessions: [
          { agentId: "codex", chatType: "dm", displayName: "Alice", key: "agent:codex:terminal:alice", origin: { surface: "terminal" } },
        ],
      },
    });
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-backfill-existing-test.json");
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@openclaw_agent_codex:localhost",
      id: "room:existing",
      kind: "session",
      label: "Alice",
      owner: "imported",
      roomId: "!existing:example.com",
      sessionKey: "agent:codex:terminal:alice",
      updatedAt: 1,
    });
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(async () => ({
        id: "session:created",
        mxid: "!room:example.com",
        portalKey: { id: "session:created", receiver: "login" },
        receiver: "login",
      })),
    };
    const login = { id: "login", userId: "@owner:example.com" };

    await expect(backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["tui"],
      login,
      registry,
      runtime,
    })).resolves.toMatchObject({
      portals: [],
      sessions: [],
      skipped: [{ agentId: "codex", sessionKey: "agent:codex:terminal:alice" }],
    });

    expect(bridge.createPortal).not.toHaveBeenCalled();
    expect(bridge.backfillPortal).not.toHaveBeenCalled();
  });

  it("skips sessions when portal creation does not return a Matrix room", async () => {
    const runtime = runtimeWith({
      "chat.history": { messages: [{ content: "hello", id: "m1", role: "user" }] },
      "sessions.list": {
        sessions: [
          { agentId: "codex", chatType: "dm", displayName: "Alice", key: "agent:codex:terminal:alice", origin: { surface: "terminal" } },
        ],
      },
    });
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-backfill-no-room-test.json");
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(async () => ({
        id: "session:created",
        portalKey: { id: "session:created", receiver: "login" },
        receiver: "login",
      })),
    };
    const login = { id: "login", userId: "@owner:example.com" };

    await expect(backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["tui"],
      login,
      registry,
      runtime,
    })).resolves.toMatchObject({
      portals: [{ id: "session:created" }],
      sessions: [],
      skipped: [{ agentId: "codex", sessionKey: "agent:codex:terminal:alice" }],
    });

    expect(bridge.backfillPortal).not.toHaveBeenCalled();
    expect(runtime.transport.request).not.toHaveBeenCalledWith("chat.history", expect.anything());
    expect(registry.getBindingBySessionKey("agent:codex:terminal:alice")).toBeUndefined();
  });

  it("omits non-federation creation content when federated rooms are enabled", async () => {
    const runtime = runtimeWith({
      "chat.history": { messages: [] },
      "sessions.list": {
        sessions: [
          { agentId: "codex", chatType: "dm", displayName: "Alice", key: "agent:codex:terminal:alice", origin: { surface: "terminal" } },
        ],
      },
    });
    runtime.config.nonFederatedRooms = false;
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-backfill-federated-test.json");
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(async () => ({
        id: "session:created",
        mxid: "!room:example.com",
        portalKey: { id: "session:created", receiver: "login" },
        receiver: "login",
      })),
    };
    const login = { id: "login", userId: "@owner:example.com" };

    await backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["tui"],
      login,
      registry,
      runtime,
    });

    expect(bridge.createPortal.mock.calls[0]?.[1]).not.toHaveProperty("creationContent");
  });
});

function runtimeWith(responses: Record<string, unknown>): OpenClawGatewayRuntime & {
  transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> };
} {
  const transport = {
    async *events() {},
    request: vi.fn(async (method: string) => responses[method]),
  };
  return new OpenClawGatewayRuntime({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } };
}
