import type { CreateNodeBeeperBridgeOptions, PickleBridge } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawBeeperBridge, startOpenClawBeeperBridge } from "./appservice";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClaw Beeper appservice runtime", () => {
  it("creates a Pickle Beeper bridge with the OpenClaw connector defaults", async () => {
    const bridge = fakeBridge();
    const bridgeFactory = vi.fn(async (_options: CreateNodeBeeperBridgeOptions) => bridge);
    const config = createDefaultConfig({
      beeperEnv: "staging",
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

  it("does not run historical imports during bridge startup", async () => {
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
    expect(bridge.createPortal).not.toHaveBeenCalled();
  });
});

function fakeBridge(options: { registry?: OpenClawBridgeRegistry } = {}): PickleBridge {
  return {
    connector: options.registry ? { registry: options.registry } : undefined,
    createPortal: vi.fn(),
    setBridgeState: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as PickleBridge;
}
