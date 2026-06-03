import { describe, expect, it } from "vitest";
import { hasAnyBeeperAuth, hasAnyBeeperConfiguredState } from "./auth-presence";

describe("Beeper auth presence metadata probe", () => {
  it("detects configured Beeper accounts", () => {
    const configuredAccount = {
      asToken: "as",
      enabled: true,
      hsToken: "hs",
      bridge: {
        homeserver: "https://matrix.example",
        matrixDeviceId: "DEV",
        matrixUserId: "@alice:beeper.com",
      },
    };

    expect(hasAnyBeeperConfiguredState({
      cfg: {
        channels: {
          beeper: {
            accounts: {
              "@alice:beeper.com": configuredAccount,
            },
          },
        },
      },
    })).toBe(true);
  });

  it("does not treat partial bridge config as persisted auth", () => {
    expect(hasAnyBeeperAuth({
      channels: {
        beeper: {
          accounts: {
            "@alice:beeper.com": {
              enabled: true,
              bridge: {
                homeserver: "https://matrix.example",
                matrixUserId: "@alice:beeper.com",
              },
            },
          },
        },
      },
    })).toBe(false);
  });
});
