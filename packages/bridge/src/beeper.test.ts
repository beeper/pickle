import { describe, expect, it, vi } from "vitest";
import { createBeeperAppServiceInit, createBeeperBridgeManagerClient, fetchBeeperBridges } from "./beeper";

describe("Beeper bridge manager helpers", () => {
  it("fetches bridges from whoami", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      user: {
        bridges: {
          "sh-dummy": { version: "v1" },
        },
      },
      userInfo: { username: "alice" },
    }));

    await expect(fetchBeeperBridges({ baseDomain: "example", fetch: fetch as never, token: "token" })).resolves.toEqual({
      "sh-dummy": { version: "v1" },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe("https://api.example/whoami");
  });

  it("registers and normalizes appservice registrations", async () => {
    const fetch = vi.fn(async (url: URL, init?: RequestInit) => {
      if (String(url) === "https://api.example/whoami") {
        return jsonResponse({
          user: { bridges: {} },
          userInfo: { username: "alice" },
        });
      }
      expect(String(url)).toBe("https://matrix.example/_hungryserv/alice/_matrix/asmux/mxauth/appservice/alice/sh-dummy");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({
        address: "https://bridge.example",
        push: true,
        self_hosted: true,
      });
      return jsonResponse({
        as_token: "as",
        hs_token: "hs",
        id: "sh-dummy",
        namespaces: {
          user_ids: [{ exclusive: true, regex: "@dummy_.*:beeper.local" }],
        },
        rate_limited: false,
        sender_localpart: "dummybot",
        url: "https://bridge.example",
      });
    });

    await expect(createBeeperAppServiceInit({
      address: "https://bridge.example",
      baseDomain: "example",
      bridge: "sh-dummy",
      fetch: fetch as never,
      token: "token",
    })).resolves.toEqual({
      homeserver: "https://matrix.example/_hungryserv/alice",
      homeserverDomain: "beeper.local",
      registration: {
        asToken: "as",
        hsToken: "hs",
        id: "sh-dummy",
        namespaces: {
          users: [{ exclusive: true, regex: "@dummy_.*:beeper.local" }],
        },
        rateLimited: false,
        senderLocalpart: "dummybot",
        url: "https://bridge.example",
      },
    });
  });

  it("can get an existing bridge and appservice through the client", async () => {
    const fetch = vi.fn(async (url: URL) => {
      if (String(url) === "https://api.example/whoami") {
        return jsonResponse({
          user: { bridges: { "sh-dummy": { version: "v1" } } },
          userInfo: { username: "alice" },
        });
      }
      return jsonResponse({
        asToken: "as",
        hsToken: "hs",
        id: "sh-dummy",
        namespaces: { users: [{ exclusive: true, regex: "@dummy_.*:beeper.local" }] },
        senderLocalpart: "dummybot",
        url: "",
      });
    });
    const client = createBeeperBridgeManagerClient({ baseDomain: "example", fetch: fetch as never, token: "token" });

    await expect(client.getBridge("sh-dummy")).resolves.toEqual({ version: "v1" });
    await expect(client.registerAppService({ bridge: "sh-dummy", getOnly: true })).resolves.toMatchObject({
      asToken: "as",
      id: "sh-dummy",
    });
  });
});

function jsonResponse(data: unknown): Response {
  return {
    json: async () => data,
    ok: true,
    status: 200,
    statusText: "OK",
  } as Response;
}
