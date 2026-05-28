import { describe, expect, it } from "vitest";
import {
  createOpenClawBeeperAppService,
  loginToBeeperForOpenClaw,
  setupOpenClawBeeperBridge,
} from "./beeper-setup";

describe("OpenClaw Beeper setup", () => {
  it("derives a valid self-hosted bridge id from long OpenClaw device ids", async () => {
    const { openClawBeeperBridgeId } = await import("./beeper-setup");
    const bridgeId = openClawBeeperBridgeId("322ff27928aa3d3592836316f21c16fb9e801719d0adb25c3ef3aa40858a8982");

    expect(bridgeId).toBe("sh-openclaw-322ff27928aa3d359283");
    expect(bridgeId).toHaveLength(32);
    expect(bridgeId).toMatch(/^[a-z0-9-]+$/);
  });

  it("logs in with OpenClaw device metadata and returns config credentials", async () => {
    const seen: unknown[] = [];
    const result = await loginToBeeperForOpenClaw({
      email: "batuhan@example.com",
      getLoginCode: () => "123456",
      openClawDeviceId: "OPENCLAW-DEVICE",
      login: async (options) => {
        seen.push(options);
        return {
          accessToken: "mx-token",
          deviceId: "DEV",
          homeserver: "https://matrix.beeper.com",
          userId: "@batuhan:beeper.com",
        };
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        email: "batuhan@example.com",
        initialDeviceDisplayName: "Pickle OpenClaw",
        metadata: {
          bridge: "sh-openclaw-openclaw-device",
          bridgeType: "openclaw",
          openClawDeviceId: "OPENCLAW-DEVICE",
        },
      }),
    ]);
    expect(result.config).toEqual({
      accessToken: "mx-token",
      homeserver: "https://matrix.beeper.com",
      matrixDeviceId: "DEV",
      matrixUserId: "@batuhan:beeper.com",
    });
  });

  it("registers the OpenClaw Beeper appservice with self-hosted defaults", async () => {
    const seen: unknown[] = [];
    const result = await createOpenClawBeeperAppService({
      accessToken: "mx-token",
      matrixDeviceId: "DEV",
      createAppServiceInit: async (options) => {
        seen.push(options);
        return {
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          homeserverDomain: "beeper.local",
          registration: {
            asToken: "as",
            hsToken: "hs",
            id: "appservice-uuid",
            namespaces: { aliases: [], rooms: [], users: [] },
            senderLocalpart: "sh-openclawbot",
            url: "http://127.0.0.1:29391",
          },
        };
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        bridge: "sh-openclaw-dev",
        bridgeType: "openclaw",
        selfHosted: true,
        token: "mx-token",
      }),
    ]);
    expect(result.config).toEqual({
      appserviceId: "appservice-uuid",
      asToken: "as",
      bridgeId: "sh-openclaw-dev",
      homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
      homeserverDomain: "beeper.local",
      hsToken: "hs",
    });
  });

  it("passes a bridge manager token as the Beeper hungry token", async () => {
    const seen: unknown[] = [];
    await createOpenClawBeeperAppService({
      accessToken: "mx-token",
      bridgeManagerToken: "hungry-token",
      matrixDeviceId: "DEV",
      createAppServiceInit: async (options) => {
        seen.push(options);
        return {
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          registration: {
            asToken: "as",
            hsToken: "hs",
            id: "appservice-uuid",
            namespaces: { aliases: [], rooms: [], users: [] },
            senderLocalpart: "sh-openclawbot",
            url: "http://127.0.0.1:29391",
          },
        };
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        hungryToken: "hungry-token",
        token: "mx-token",
      }),
    ]);
  });

  it("combines Beeper login and appservice registration config", async () => {
    const result = await setupOpenClawBeeperBridge({
      email: "batuhan@example.com",
      env: "staging",
      getLoginCode: () => "123456",
      openClawDeviceId: "OPENCLAW-DEVICE",
      login: async () => ({
        accessToken: "mx-token",
        deviceId: "DEV",
        homeserver: "https://matrix.beeper-staging.com",
        userId: "@batuhan:beeper-staging.com",
      }),
      createAppServiceInit: async (options) => {
        expect(options).toMatchObject({
          baseDomain: "beeper-staging.com",
          bridge: "sh-openclaw-openclaw-device",
          token: "mx-token",
        });
        expect(options.homeserver).toBeUndefined();
        return {
          homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
          registration: {
            asToken: "as",
            hsToken: "hs",
            id: "appservice-uuid",
            namespaces: { aliases: [], rooms: [], users: [] },
            senderLocalpart: "sh-openclawbot",
            url: "http://127.0.0.1:29391",
          },
        };
      },
    });

    expect(result.config).toEqual({
      accessToken: "mx-token",
      appserviceId: "appservice-uuid",
      asToken: "as",
      bridgeId: "sh-openclaw-openclaw-device",
      homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@batuhan:beeper-staging.com",
    });
  });
});
