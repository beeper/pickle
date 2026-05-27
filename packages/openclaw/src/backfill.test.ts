import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { backfillAllOpenClawSessions, buildBackfillImport, discoverOneToOneSessions, isOneToOneSession, shouldImportSession } from "./backfill";
import { createDefaultConfig } from "./config";
import { OpenClawPluginRuntimeAdapter, type OpenClawRuntimeRequestSurface } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClaw backfill", () => {
  it("discovers terminal, mac app, and DM-like sessions while skipping group sessions", async () => {
    const runtime = runtimeWith({
      "sessions.list": {
        sessions: [
          { key: "agent:main:terminal:local", origin: { surface: "terminal" } },
          { key: "agent:main:desktop:abc", origin: { surface: "mac-app" } },
          { chatType: "direct", key: "agent:main:dashboard:web", lastChannel: "webchat", origin: { provider: "webchat", surface: "webchat" } },
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
        label: "agent:main:dashboard:web",
        session: {
          chatType: "direct",
          key: "agent:main:dashboard:web",
          lastChannel: "webchat",
          origin: { provider: "webchat", surface: "webchat" },
        },
        sessionKey: "agent:main:dashboard:web",
        source: "mac-app",
      },
      {
        agentId: "main",
        human: {
          displayName: "user-1",
          ghostUserId: "@sh-openclaw_user_user-1:localhost",
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
          ghostUserId: "@sh-openclaw_user_alice:localhost",
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
          ghostUserId: "@sh-openclaw_agent_main:localhost",
          humanGhostUserId: "@sh-openclaw_user_alice:localhost",
          label: "Terminal",
          owner: "imported",
          roomId: "!room:example.com",
          sessionKey: "agent:main:terminal:local",
        },
        human: {
          displayName: "Alice",
          ghostUserId: "@sh-openclaw_user_alice:localhost",
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
    expect(shouldImportSession({ chatType: "direct", key: "agent:main:dashboard:web", lastChannel: "webchat", origin: { surface: "webchat" } }, ["dashboard"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:whatsapp:alice", lastProvider: "whatsapp" }, ["channels"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:terminal:old", origin: { surface: "terminal" }, updatedAt: null }, ["tui"])).toBe(false);
    expect(shouldImportSession({ key: "agent:main:terminal:old", origin: { surface: "terminal" }, updatedAt: null }, ["archived"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:terminal:old", origin: { surface: "terminal" }, updatedAt: null }, ["tui", "archived"])).toBe(true);
    expect(shouldImportSession({ key: "agent:main:desktop:old", origin: { surface: "mac-app" }, updatedAt: null }, ["dashboard"])).toBe(false);
    expect(shouldImportSession({ key: "agent:main:desktop:abc", origin: { surface: "mac-app" } }, ["tui"])).toBe(false);

    const runtime = runtimeWith({
      "sessions.list": {
        sessions: [
          { key: "agent:main:terminal:local", origin: { surface: "terminal" } },
          { key: "agent:main:terminal:archived", origin: { surface: "terminal" }, updatedAt: null },
          { key: "agent:main:desktop:abc", origin: { surface: "mac-app" } },
          { chatType: "direct", key: "agent:main:dashboard:web", lastChannel: "webchat", origin: { surface: "webchat" } },
          { chatType: "dm", key: "agent:main:whatsapp:user-1", lastProvider: "whatsapp", lastTo: "user-1" },
        ],
      },
    });
    await expect(discoverOneToOneSessions(runtime, { importSources: ["dashboard"] })).resolves.toMatchObject([
      { sessionKey: "agent:main:desktop:abc", source: "mac-app" },
      { sessionKey: "agent:main:dashboard:web", source: "mac-app" },
    ]);
    await expect(discoverOneToOneSessions(runtime, { importSources: ["archived"] })).resolves.toMatchObject([
      { sessionKey: "agent:main:terminal:archived", source: "terminal" },
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
    const dir = await mkdtemp(join(tmpdir(), "openclaw-backfill-test-"));
    const registryPath = join(dir, "registry.json");
    const registry = new OpenClawBridgeRegistry(registryPath);
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
          ghostUserId: "@sh-openclaw_agent_codex:localhost",
          humanGhostUserId: "@sh-openclaw_user_alice:localhost",
          sessionKey: "agent:codex:whatsapp:alice",
          source: "channel",
        },
      },
      name: "Alice",
      roomType: "dm",
    }));
    expect(bridge.backfillPortal).toHaveBeenCalledWith(login, expect.objectContaining({
      mxid: "!room:example.com",
    }), { limit: 25 });
    expect(registry.getUser("alice")?.ghostUserId).toBe("@sh-openclaw_user_alice:localhost");
    expect(registry.getBindingByRoom("!room:example.com")?.humanGhostUserId).toBe("@sh-openclaw_user_alice:localhost");
    const persisted = new OpenClawBridgeRegistry(registryPath);
    await persisted.load();
    expect(persisted.getBindingBySessionKey("agent:codex:whatsapp:alice")).toMatchObject({
      humanGhostUserId: "@sh-openclaw_user_alice:localhost",
      roomId: "!room:example.com",
    });
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
      ghostUserId: "@sh-openclaw_agent_codex:localhost",
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

  it("does not mark a session imported when Matrix backfill fails", async () => {
    const runtime = runtimeWith({
      "chat.history": { messages: [{ content: "hello", id: "m1", role: "user" }] },
      "sessions.list": {
        sessions: [
          { agentId: "codex", chatType: "dm", displayName: "Alice", key: "agent:codex:terminal:alice", origin: { surface: "terminal" } },
        ],
      },
    });
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-backfill-failure-test.json");
    const bridge = {
      backfillPortal: vi.fn(async () => {
        throw new Error("batch send failed");
      }),
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
    })).rejects.toThrow("batch send failed");

    expect(bridge.createPortal).toHaveBeenCalledOnce();
    expect(bridge.backfillPortal).toHaveBeenCalledOnce();
    expect(registry.getBindingBySessionKey("agent:codex:terminal:alice")).toBeUndefined();
  });

  it("always creates non-federated Beeper appservice rooms", async () => {
    const runtime = runtimeWith({
      "chat.history": { messages: [] },
      "sessions.list": {
        sessions: [
          { agentId: "codex", chatType: "dm", displayName: "Alice", key: "agent:codex:terminal:alice", origin: { surface: "terminal" } },
        ],
      },
    });
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

    expect(bridge.createPortal.mock.calls[0]?.[1]).toHaveProperty("creationContent", { "m.federate": false });
  });

  it("creates an initial agent DM when no importable sessions exist", async () => {
    const runtime = runtimeWith({
      "agents.list": { agents: [{ displayName: "Main Agent", id: "main" }] },
      "sessions.list": { sessions: [] },
    });
    const dir = await mkdtemp(join(tmpdir(), "openclaw-backfill-empty-test-"));
    const registry = new OpenClawBridgeRegistry(join(dir, "registry.json"));
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(async () => ({
        id: "agent:main",
        mxid: "!main:example.com",
        portalKey: { id: "agent:main", receiver: "login" },
        receiver: "login",
      })),
    };
    const login = { id: "login", userId: "@owner:example.com" };

    await expect(backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["dashboard", "tui"],
      login,
      registry,
      runtime,
    })).resolves.toMatchObject({
      portals: [{ mxid: "!main:example.com" }],
      sessions: [],
      skipped: [],
    });

    expect(bridge.createPortal).toHaveBeenCalledWith(login, expect.objectContaining({
      id: "agent:main",
      name: "Main Agent",
      roomType: "dm",
    }));
    expect(bridge.backfillPortal).not.toHaveBeenCalled();
    expect(registry.getBindingBySessionKey("agent:main")).toMatchObject({
      agentId: "main",
      owner: "bridge",
      roomId: "!main:example.com",
    });
  });

  it("heals stale registry ghost domains when an initial DM already exists", async () => {
    const runtime = runtimeWith({
      "agents.list": { agents: [{ displayName: "Main Agent", id: "main" }] },
      "sessions.list": { sessions: [] },
    });
    runtime.config.homeserver = "https://matrix.beeper-staging.com/_hungryserv/account";
    runtime.config.homeserverDomain = "beeper.local";
    const dir = await mkdtemp(join(tmpdir(), "openclaw-backfill-heal-test-"));
    const registry = new OpenClawBridgeRegistry(join(dir, "registry.json"));
    registry.upsertAgent({
      agentId: "main",
      displayName: "Main Agent",
      ghostUserId: "@sh-openclaw_agent_main:matrix.beeper-staging.com",
    });
    registry.upsertBinding({
      agentId: "main",
      createdAt: 1,
      ghostUserId: "@sh-openclaw_agent_main:matrix.beeper-staging.com",
      id: "existing",
      kind: "session",
      label: "Main Agent",
      owner: "bridge",
      roomId: "!existing:beeper.local",
      sessionKey: "agent:main",
      updatedAt: 1,
    });
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(async () => ({ id: "agent:main", mxid: "!new:beeper.local", portalKey: { id: "agent:main", receiver: "login" } })),
    };

    await backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["dashboard", "tui"],
      login: { id: "login", userId: "@owner:beeper.local" },
      registry,
      runtime,
    });

    expect(bridge.createPortal).not.toHaveBeenCalled();
    expect(registry.getAgent("main")?.ghostUserId).toBe("@sh-openclaw_agent_main:beeper.local");
    expect(registry.getBindingBySessionKey("agent:main")?.ghostUserId).toBe("@sh-openclaw_agent_main:beeper.local");
  });

  it("rebuilds the registry from an existing bridge portal before creating an initial DM", async () => {
    const runtime = runtimeWith({
      "agents.list": { agents: [{ displayName: "Main Agent", id: "main" }] },
      "sessions.list": { sessions: [] },
    });
    const dir = await mkdtemp(join(tmpdir(), "openclaw-backfill-existing-portal-test-"));
    const registry = new OpenClawBridgeRegistry(join(dir, "registry.json"));
    const existingPortal = {
      id: "agent:main",
      mxid: "!existing:beeper.local",
      portalKey: { id: "agent:main", receiver: "login" },
      receiver: "login",
    };
    const bridge = {
      backfillPortal: vi.fn(async () => ({ eventIds: [] })),
      createPortal: vi.fn(),
      getPortal: vi.fn(() => existingPortal),
    };

    const result = await backfillAllOpenClawSessions({
      bridge: bridge as never,
      importSources: ["dashboard", "tui"],
      login: { id: "login", userId: "@owner:beeper.local" },
      registry,
      runtime,
    });

    expect(result.portals).toEqual([existingPortal]);
    expect(bridge.createPortal).not.toHaveBeenCalled();
    expect(registry.getBindingBySessionKey("agent:main")).toMatchObject({
      agentId: "main",
      roomId: "!existing:beeper.local",
    });
  });
});

function runtimeWith(responses: Record<string, unknown>): OpenClawPluginRuntimeAdapter & {
  transport: OpenClawRuntimeRequestSurface & { request: ReturnType<typeof vi.fn> };
} {
  const transport = {
    async *events() {},
    request: vi.fn(async (method: string) => responses[method]),
  };
  return new OpenClawPluginRuntimeAdapter({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawPluginRuntimeAdapter & { transport: OpenClawRuntimeRequestSurface & { request: ReturnType<typeof vi.fn> } };
}
