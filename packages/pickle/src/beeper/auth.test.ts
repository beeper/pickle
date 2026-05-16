import { describe, expect, it, vi } from "vitest";
import { createBeeperLogin } from "./auth";

describe("beeper auth", () => {
  it("logs in with email code and exchanges the Beeper JWT for a Matrix account", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const path = new URL(String(url)).pathname;
      if (path === "/user/login") {
        return Response.json({
          expires: "2026-01-01T00:00:00Z",
          request: "request-id",
          type: ["email"],
        });
      }
      if (path === "/user/login/email") {
        return Response.json({});
      }
      if (path === "/user/login/response") {
        return Response.json({ token: "beeper-jwt" });
      }
      if (path === "/_matrix/client/v3/login") {
        return Response.json({
          access_token: "access",
          device_id: "DEVICE",
          user_id: "@bot:beeper-staging.com",
        });
      }
      return Response.json({
        device_id: "DEVICE",
        user_id: "@bot:beeper-staging.com",
      });
    });

    await expect(createBeeperLogin({
      email: "bot@example.com",
      env: "staging",
      fetch: fetchImpl as typeof fetch,
      getLoginCode: () => "123456",
    })).resolves.toMatchObject({
      accessToken: "access",
      deviceId: "DEVICE",
      homeserver: "https://matrix.beeper-staging.com",
      metadata: { beeper: true },
      userId: "@bot:beeper-staging.com",
      whoami: {
        deviceId: "DEVICE",
        userId: "@bot:beeper-staging.com",
      },
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("https://api.beeper-staging.com/user/login");
    expect(await requestBody(fetchImpl, 1)).toEqual({
      appType: "pickle",
      email: "bot@example.com",
      onlyExistingAccounts: true,
      request: "request-id",
    });
    expect(await requestBody(fetchImpl, 2)).toEqual({
      appType: "pickle",
      onlyExistingAccounts: true,
      request: "request-id",
      response: "123456",
    });
    expect(await requestBody(fetchImpl, 3)).toMatchObject({
      token: "beeper-jwt",
      type: "org.matrix.login.jwt",
    });
  });

  it("can request Beeper account creation during email login", async () => {
    const fetchImpl = vi.fn(async (url: URL | string) => {
      const path = new URL(String(url)).pathname;
      if (path === "/user/login") return Response.json({ request: "request-id", type: ["email"] });
      if (path === "/user/login/email") return Response.json({});
      if (path === "/user/login/response") return Response.json({ token: "beeper-jwt" });
      if (path === "/_matrix/client/v3/login") {
        return Response.json({
          access_token: "access",
          device_id: "DEVICE",
          user_id: "@bot:beeper.com",
        });
      }
      return Response.json({ device_id: "DEVICE", user_id: "@bot:beeper.com" });
    });

    await expect(createBeeperLogin({
      email: "bot@example.com",
      fetch: fetchImpl as typeof fetch,
      getLoginCode: () => "123456",
      onlyExistingAccounts: false,
    })).resolves.toMatchObject({
      accessToken: "access",
      userId: "@bot:beeper.com",
    });

    expect(await requestBody(fetchImpl, 1)).toMatchObject({
      onlyExistingAccounts: false,
    });
    expect(await requestBody(fetchImpl, 2)).toMatchObject({
      onlyExistingAccounts: false,
    });
  });
});

async function requestBody(fetchImpl: ReturnType<typeof vi.fn>, index: number) {
  const init = fetchImpl.mock.calls[index]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}
