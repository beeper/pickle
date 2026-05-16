import type { CreateNodeBeeperBridgeOptions, PickleBridge } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { accountFromOpenClawConfig, createOpenClawBeeperBridge, startOpenClawBeeperBridge } from "./appservice";

describe("OpenClaw Beeper appservice runtime", () => {
  it("creates a Pickle Beeper bridge with the OpenClaw connector defaults", async () => {
    const bridge = fakeBridge();
    const bridgeFactory = vi.fn(async (_options: CreateNodeBeeperBridgeOptions) => bridge);
    const config = createDefaultConfig({
      dataDir: "/tmp/openclaw",
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
      bridge: "openclaw",
      bridgeType: "openclaw",
      connector: expect.objectContaining({
        config,
      }),
      dataDir: "/tmp/openclaw-data",
      getOnly: true,
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
