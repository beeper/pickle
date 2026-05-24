import type { CreateNodeBeeperBridgeOptions, PickleBridge } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { accountFromOpenClawConfig, createOpenClawBeeperBridge, startOpenClawBeeperBridge } from "./appservice";

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

  it("recreates the Beeper Matrix account from persisted setup config", () => {
    expect(accountFromOpenClawConfig(createDefaultConfig({
      accessToken: "mx-token",
      dataDir: "/tmp/openclaw",
      gatewayAccessToken: "gateway-token",
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

function fakeBridge(): PickleBridge {
  return {
    start: vi.fn(),
    stop: vi.fn(),
  } as unknown as PickleBridge;
}
