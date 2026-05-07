import { describe, expect, it, vi } from "vitest";
import { loginWithMatrixPassword, loginWithMatrixToken, loginWithPassword } from "./auth";

describe("matrix auth", () => {
  it("logs in with token and verifies whoami", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      if (String(url).endsWith("/_matrix/client/v3/login")) {
        return Response.json({
          access_token: "access",
          device_id: "DEVICE",
          user_id: "@bot:example.com",
        });
      }
      return Response.json({
        device_id: "DEVICE",
        user_id: "@bot:example.com",
      });
    });

    await expect(loginWithMatrixToken({
      fetch: fetchImpl as typeof fetch,
      homeserver: "https://matrix.example.com",
      token: "jwt",
      type: "org.matrix.login.jwt",
    })).resolves.toEqual({
      accessToken: "access",
      deviceId: "DEVICE",
      homeserver: "https://matrix.example.com",
      userId: "@bot:example.com",
      whoami: {
        deviceId: "DEVICE",
        userId: "@bot:example.com",
      },
    });

    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe("https://matrix.example.com/_matrix/client/v3/account/whoami");
    expect((fetchImpl.mock.calls[1]?.[1] as RequestInit).headers).toEqual({ authorization: "Bearer access" });
  });

  it("logs in with password", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      if (String(url).endsWith("/_matrix/client/v3/login")) {
        return Response.json({
          access_token: "access",
          device_id: "DEVICE",
          user_id: "@bot:example.com",
        });
      }
      return Response.json({
        device_id: "DEVICE",
        user_id: "@bot:example.com",
      });
    });

    await loginWithMatrixPassword({
      fetch: fetchImpl as typeof fetch,
      homeserver: "https://matrix.example.com",
      password: "secret",
      username: "bot",
    });

    expect(await requestBody(fetchImpl, 0)).toMatchObject({
      identifier: { type: "m.id.user", user: "bot" },
      password: "secret",
      type: "m.login.password",
    });
  });

  it("logs in with password using Beeper defaults", async () => {
    const fetchImpl = passwordFetch("@bot:beeper.com");

    await loginWithPassword({
      fetch: fetchImpl as typeof fetch,
      password: "secret",
      username: "bot",
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://matrix.beeper.com/_matrix/client/v3/login");
  });

  it("lets explicit homeserver override Beeper defaults", async () => {
    const fetchImpl = passwordFetch("@bot:example.com");

    await loginWithPassword({
      fetch: fetchImpl as typeof fetch,
      homeserver: "https://matrix.example.com",
      password: "secret",
      username: "bot",
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://matrix.example.com/_matrix/client/v3/login");
  });
});

function passwordFetch(userId: string) {
  return vi.fn(async (url: URL | string) => {
    if (String(url).endsWith("/_matrix/client/v3/login")) {
      return Response.json({
        access_token: "access",
        device_id: "DEVICE",
        user_id: userId,
      });
    }
    return Response.json({
      device_id: "DEVICE",
      user_id: userId,
    });
  });
}

async function requestBody(fetchImpl: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchImpl.mock.calls[index]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}
