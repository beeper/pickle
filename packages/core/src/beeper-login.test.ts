import { describe, expect, it, vi } from "vitest";
import { createBeeperLogin } from "./beeper-login";

describe("createBeeperLogin", () => {
  it("uses Beeper homeserver and metadata for standard token login", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      access_token: "access",
      device_id: "DEVICE",
      user_id: "@bot:beeper.com",
    }));
    const login = createBeeperLogin({ fetch: fetchImpl as typeof fetch });

    await expect(login.token({ token: "jwt" })).resolves.toEqual({
      accessToken: "access",
      deviceId: "DEVICE",
      homeserver: "https://matrix.beeper.com",
      metadata: { beeper: true },
      userId: "@bot:beeper.com",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://matrix.beeper.com/_matrix/client/v3/login");
  });

  it("requests email registration tokens without fixed OTP assumptions", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      sid: "sid",
      submit_url: "https://matrix.beeper.com/submit",
    }));
    const login = createBeeperLogin({
      fetch: fetchImpl as typeof fetch,
      homeserver: "https://matrix.example.com",
    });

    await expect(login.requestEmailToken({
      clientSecret: "secret",
      email: "bot@example.com",
      nextLink: "https://example.com/next",
      sendAttempt: 1,
    })).resolves.toEqual({
      raw: { sid: "sid", submit_url: "https://matrix.beeper.com/submit" },
      sid: "sid",
      submitUrl: "https://matrix.beeper.com/submit",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://matrix.example.com/_matrix/client/v3/register/email/requestToken");
    expect(await requestBody(fetchImpl)).toEqual({
      client_secret: "secret",
      email: "bot@example.com",
      next_link: "https://example.com/next",
      send_attempt: 1,
    });
  });

  it("registers through Matrix UI auth and returns an account when login is included", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      access_token: "access",
      device_id: "DEVICE",
      user_id: "@bot:beeper.com",
    }));
    const login = createBeeperLogin({ fetch: fetchImpl as typeof fetch });

    await expect(login.register({
      auth: {
        session: "session",
        threepid_creds: { sid: "sid" },
        type: "m.login.email.identity",
      },
      password: "secret",
      username: "bot",
    })).resolves.toMatchObject({
      account: {
        accessToken: "access",
        deviceId: "DEVICE",
        metadata: { beeper: true },
        userId: "@bot:beeper.com",
      },
      accessToken: "access",
      deviceId: "DEVICE",
      userId: "@bot:beeper.com",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://matrix.beeper.com/_matrix/client/v3/register");
  });
});

async function requestBody(fetchImpl: ReturnType<typeof vi.fn>) {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}
