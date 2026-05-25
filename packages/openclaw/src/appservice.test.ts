import type { CreateNodeBeeperBridgeOptions, PickleBridge } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { accountFromOpenClawConfig, createOpenClawBeeperBridge, startOpenClawBeeperBridge } from "./appservice";
import { OpenClawGatewayRuntime, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClaw Beeper appservice runtime", () => {
  it("creates a Pickle Beeper bridge with the OpenClaw connector defaults", async () => {
    const bridge = fakeBridge();
    const bridgeFactory = vi.fn(async (_options: CreateNodeBeeperBridgeOptions) => bridge);
    const config = createDefaultConfig({
      beeperEnv: "staging",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry-token",
      dataDir: "/tmp/openclaw",
      homeserverDomain: "beeper.local",
      registrationUrl: "http://127.0.0.1:29391",
    });

    await expect(createOpenClawBeeperBridge({
      account: account(),
      bridgeFactory,
      config,
      dataDir: "/tmp/openclaw-data",
      getOnly: true,
    })).resolves.toBe(bridge);

    expect(bridgeFactory).toHaveBeenCalledWith(expect.objectContaining({
      account: account(),
      address: "http://127.0.0.1:29391",
      baseDomain: "beeper-staging.com",
      bridge: "openclaw",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry-token",
      bridgeType: "openclaw",
      connector: expect.objectContaining({
        config,
      }),
      dataDir: "/tmp/openclaw-data",
      getOnly: true,
      homeserverDomain: "beeper.local",
    }));
  });

  it("starts the created bridge", async () => {
    const bridge = fakeBridge();
    await expect(startOpenClawBeeperBridge({
      account: account(),
      bridgeFactory: async () => bridge,
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    })).resolves.toBe(bridge);
    expect(bridge.start).toHaveBeenCalledOnce();
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
      accessToken: "mx-token",
      dataDir: "/tmp/openclaw",
      gatewayUrl: "ws://gateway",
      homeserver: "https://matrix.beeper.com",
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
      account: account(),
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

  it("recreates the Beeper Matrix account from persisted setup config", () => {
    expect(accountFromOpenClawConfig(createDefaultConfig({
      accessToken: "mx-token",
      dataDir: "/tmp/openclaw",
      homeserver: "https://matrix.beeper.com",
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper.com",
    }))).toEqual(account());
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
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as PickleBridge;
}

function runtimeWith(options: {
  responses: Record<string, unknown>;
}): OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } } {
  const transport = {
    async *events() {},
    request: vi.fn(async (method: string) => options.responses[method]),
  };
  return new OpenClawGatewayRuntime({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } };
}
