import type { CreateNodeBeeperBridgeOptions, PickleBridge } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawBeeperBridge, startOpenClawBeeperBridge } from "./appservice";
import { OpenClawPluginRuntimeAdapter, type OpenClawRuntimeRequestSurface } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClaw Beeper appservice runtime", () => {
  it("creates a Pickle Beeper bridge with the OpenClaw connector defaults", async () => {
    const bridge = fakeBridge();
    const bridgeFactory = vi.fn(async (_options: CreateNodeBeeperBridgeOptions) => bridge);
    const config = createDefaultConfig({
      beeperEnv: "staging",
      bridgeManagerToken: "hungry-token",
      dataDir: "/tmp/openclaw",
      asToken: "as-token",
      homeserver: "https://matrix.beeper-staging.com",
      homeserverDomain: "beeper.local",
      hsToken: "hs-token",
      matrixUserId: "@batuhan:beeper-staging.com",
    });

    await expect(createOpenClawBeeperBridge({
      bridgeFactory,
      config,
      dataDir: "/tmp/openclaw-data",
      getOnly: true,
    })).resolves.toBe(bridge);

    expect(bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      address: "websocket",
      baseDomain: "beeper-staging.com",
      bridge: "sh-openclaw",
      bridgeManagerPostState: true,
      bridgeManagerToken: "hungry-token",
      bridgeType: "openclaw",
      connector: expect.objectContaining({
        config,
      }),
      dataDir: "/tmp/openclaw-data",
      getOnly: true,
      homeserverDomain: "beeper.local",
      ownerUserId: "@batuhan:beeper-staging.com",
    }));
  });

  it("starts the created bridge", async () => {
    const bridge = fakeBridge();
    await expect(startOpenClawBeeperBridge({
      bridgeFactory: async () => bridge,
      config: createDefaultConfig({
        asToken: "as-token",
        dataDir: "/tmp/openclaw",
        homeserver: "https://matrix.beeper.com",
        hsToken: "hs-token",
      }),
    })).resolves.toBe(bridge);
    expect(bridge.start).toHaveBeenCalledOnce();
  });

  it("marks the bridge running after the appservice starts", async () => {
    const bridge = fakeBridge();
    const config = createDefaultConfig({
      appserviceId: "sh-openclaw-device",
      asToken: "as-token",
      beeperEnv: "staging",
      bridgeId: "sh-openclaw-device",
      dataDir: "/tmp/openclaw",
      homeserver: "https://matrix.beeper-staging.com",
      hsToken: "hs-token",
      matrixUserId: "@batuhan:beeper-staging.com",
    });

    await expect(startOpenClawBeeperBridge({
      bridgeFactory: async () => bridge,
      config,
    })).resolves.toBe(bridge);

    expect(bridge.start).toHaveBeenCalledOnce();
    expect(bridge.setBridgeState).toHaveBeenCalledWith("running");
  });

  it("starts from persisted appservice config without re-registering", async () => {
    const bridge = fakeBridge();
    const bridgeFactory = vi.fn(async (_options: CreateNodeBeeperBridgeOptions) => bridge);
    const config = createDefaultConfig({
      appserviceId: "sh-openclaw-device",
      asToken: "as-token",
      dataDir: "/tmp/openclaw",
      homeserver: "https://matrix.beeper-staging.com",
      homeserverDomain: "beeper.local",
      hsToken: "hs-token",
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper-staging.com",
    });

    await expect(startOpenClawBeeperBridge({
      bridgeFactory,
      config,
    })).resolves.toBe(bridge);

    expect(bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      matrix: expect.objectContaining({
        appservice: expect.objectContaining({
          homeserver: "https://matrix.beeper-staging.com",
          homeserverDomain: "beeper.local",
          registration: expect.objectContaining({
            asToken: "as-token",
            hsToken: "hs-token",
            id: "sh-openclaw-device",
            senderLocalpart: "sh-openclaw-devicebot",
            url: "websocket",
          }),
        }),
        homeserver: "https://matrix.beeper-staging.com",
      }),
    }));
    expect(bridgeFactory.mock.calls[0]?.[0].matrix).not.toHaveProperty("account");
    expect(bridgeFactory.mock.calls[0]?.[0].matrix).not.toHaveProperty("token");
    expect(bridgeFactory.mock.calls[0]?.[0]).toMatchObject({
      ownerUserId: "@batuhan:beeper-staging.com",
    });
  });

  it("runs startup backfill with the configured import source scope", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-appservice-backfill-test.json");
    const bridge = fakeBridge({ registry });
    bridge.createPortal = vi.fn(async (_login, options) => ({
      id: options.id,
      mxid: "!desktop:example.com",
      portalKey: { id: options.id, receiver: "login" },
      receiver: "login",
    }));
    bridge.backfillPortal = vi.fn(async () => ({ eventIds: [] }));
    const config = createDefaultConfig({
      asToken: "as-token",
      dataDir: "/tmp/openclaw",
      homeserver: "https://matrix.beeper.com",
      hsToken: "hs-token",
      importSources: ["dashboard"],
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper.com",
    });
    const runtime = runtimeWith({
      responses: {
        "chat.history": { messages: [] },
        "sessions.list": {
          sessions: [
            { displayName: "Desktop", key: "agent:codex:desktop", origin: { surface: "mac-app" } },
            { displayName: "Terminal", key: "agent:codex:tui", origin: { surface: "terminal" } },
          ],
        },
      },
    });

    await expect(startOpenClawBeeperBridge({
      backfill: true,
      backfillLimit: 3,
      bridgeFactory: async () => bridge,
      config,
      registry,
      runtimeFactory: () => runtime,
    })).resolves.toBe(bridge);

    expect(bridge.createPortal).toHaveBeenCalledOnce();
    expect(bridge.createPortal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: "session:YWdlbnQ6Y29kZXg6ZGVza3RvcA",
      name: "Desktop",
    }));
    expect(bridge.backfillPortal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      mxid: "!desktop:example.com",
    }), { limit: 3 });
    expect(registry.getBindingBySessionKey("agent:codex:desktop")).toBeDefined();
    expect(registry.getBindingBySessionKey("agent:codex:tui")).toBeUndefined();
  });

  it("wraps the native OpenClaw host runtime for startup backfill", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-appservice-host-runtime-backfill-test.json");
    const bridge = fakeBridge({ registry });
    bridge.createPortal = vi.fn(async (_login, options) => ({
      id: options.id,
      mxid: "!dashboard:example.com",
      portalKey: { id: options.id, receiver: "login" },
      receiver: "login",
    }));
    bridge.backfillPortal = vi.fn(async () => ({ eventIds: [] }));
    const config = createDefaultConfig({
      asToken: "as-token",
      dataDir: "/tmp/openclaw",
      homeserver: "https://matrix.beeper.com",
      hsToken: "hs-token",
      importSources: ["dashboard"],
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper.com",
    });

    await expect(startOpenClawBeeperBridge({
      backfill: true,
      bridgeFactory: async () => bridge,
      config,
      registry,
      runtime: {
        agent: {
          session: {
            listSessionEntries: ({ agentId }: { agentId?: string } = {}) => agentId === "main"
              ? [{
                  entry: {
                    agentId: "main",
                    chatType: "direct",
                    displayName: "Dashboard",
                    origin: { provider: "webchat", surface: "webchat" },
                  },
                  sessionKey: "agent:main:dashboard:one",
                }]
              : [],
          },
        },
      },
    })).resolves.toBe(bridge);

    expect(bridge.createPortal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: "session:YWdlbnQ6bWFpbjpkYXNoYm9hcmQ6b25l",
      name: "Dashboard",
    }));
    expect(registry.getBindingBySessionKey("agent:main:dashboard:one")).toBeDefined();
  });

  it("keeps the bridge running when startup backfill has no direct OpenClaw runtime", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-appservice-no-runtime-test.json");
    const bridge = fakeBridge({ registry });

    await expect(startOpenClawBeeperBridge({
      account: account(),
      backfill: true,
      bridgeFactory: async () => bridge,
      config: createDefaultConfig({
        asToken: "as-token",
        dataDir: "/tmp/openclaw",
        homeserver: "https://matrix.beeper.com",
        hsToken: "hs-token",
        importSources: ["dashboard"],
        matrixDeviceId: "DEVICE",
        matrixUserId: "@batuhan:beeper.com",
      }),
      registry,
    })).resolves.toBe(bridge);

    expect(bridge.start).toHaveBeenCalledOnce();
    expect(bridge.createPortal).not.toHaveBeenCalled();
  });
});

function account() {
  return {
    accessToken: "mx-token",
    deviceId: "DEVICE",
    homeserver: "https://matrix.beeper.com",
    userId: "@batuhan:beeper.com",
  };
}

function fakeBridge(options: { registry?: OpenClawBridgeRegistry } = {}): PickleBridge {
  return {
    connector: options.registry ? { registry: options.registry } : undefined,
    backfillPortal: vi.fn(),
    createPortal: vi.fn(),
    setBridgeState: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as PickleBridge;
}

function runtimeWith(options: {
  responses: Record<string, unknown>;
}): OpenClawPluginRuntimeAdapter & { transport: OpenClawRuntimeRequestSurface & { request: ReturnType<typeof vi.fn> } } {
  const transport = {
    async *events() {},
    request: vi.fn(async (method: string) => options.responses[method]),
  };
  return new OpenClawPluginRuntimeAdapter({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawPluginRuntimeAdapter & { transport: OpenClawRuntimeRequestSurface & { request: ReturnType<typeof vi.fn> } };
}
