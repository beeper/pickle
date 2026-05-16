import { describe, expect, it } from "vitest";
import {
  createOpenClawBeeperAppService,
  loginToBeeperForOpenClaw,
  setupOpenClawBeeperBridge,
} from "./beeper-setup";

describe("OpenClaw Beeper setup", () => {
  it("logs in with OpenClaw device metadata and returns config credentials", async () => {
    const seen: unknown[] = [];
    const result = await loginToBeeperForOpenClaw({
      email: "batuhan@example.com",
      getLoginCode: () => "123456",
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
        metadata: { bridge: "openclaw" },
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
      createAppServiceInit: async (options) => {
        seen.push(options);
        return {
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          homeserverDomain: "beeper.local",
          registration: {
            asToken: "as",
            hsToken: "hs",
            id: "openclaw",
            namespaces: { aliases: [], rooms: [], users: [] },
            senderLocalpart: "openclawbot",
            url: "http://127.0.0.1:29391",
          },
        };
      },
    });

    expect(seen).toEqual([
      expect.objectContaining({
        address: "http://127.0.0.1:29391",
        bridge: "openclaw",
        bridgeType: "openclaw",
        selfHosted: true,
        token: "mx-token",
      }),
    ]);
    expect(result.config).toEqual({
      appserviceId: "openclaw",
      homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
      hsToken: "hs",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });

  it("combines Beeper login and appservice registration config", async () => {
    const result = await setupOpenClawBeeperBridge({
      email: "batuhan@example.com",
      env: "staging",
      getLoginCode: () => "123456",
      login: async () => ({
        accessToken: "mx-token",
        deviceId: "DEV",
        homeserver: "https://matrix.beeper-staging.com",
        userId: "@batuhan:beeper-staging.com",
      }),
      createAppServiceInit: async (options) => {
        expect(options).toMatchObject({
          baseDomain: "beeper-staging.com",
          homeserver: "https://matrix.beeper-staging.com",
          token: "mx-token",
        });
        return {
          homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
          registration: {
            asToken: "as",
            hsToken: "hs",
            id: "openclaw",
            namespaces: { aliases: [], rooms: [], users: [] },
            senderLocalpart: "openclawbot",
            url: "http://127.0.0.1:29391",
          },
        };
      },
    });

    expect(result.config).toEqual({
      accessToken: "mx-token",
      appserviceId: "openclaw",
      homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@batuhan:beeper-staging.com",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });
});
