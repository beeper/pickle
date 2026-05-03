import { describe, expect, it, vi } from "vitest";
import { createMatrixLogin } from "./login";

describe("createMatrixLogin", () => {
  it("returns MatrixAccount from token login", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      access_token: "access",
      device_id: "DEVICE",
      user_id: "@bot:example.com",
    }));
    const login = createMatrixLogin({
      fetch: fetchImpl as typeof fetch,
      homeserver: "https://matrix.example.com",
      initialDeviceDisplayName: "Bot",
      metadata: { label: "cached-beeper-bot" },
    });

    await expect(login.token({ token: "jwt", type: "org.matrix.login.jwt" })).resolves.toEqual({
      accessToken: "access",
      deviceId: "DEVICE",
      homeserver: "https://matrix.example.com",
      metadata: { label: "cached-beeper-bot" },
      userId: "@bot:example.com",
    });
    expect(await requestBody(fetchImpl)).toEqual({
      initial_device_display_name: "Bot",
      token: "jwt",
      type: "org.matrix.login.jwt",
    });
  });

  it("returns MatrixAccount from password login", async () => {
    const fetchImpl = vi.fn(async () => Response.json({
      access_token: "access",
      device_id: "DEVICE",
      user_id: "@bot:example.com",
    }));
    const login = createMatrixLogin({
      fetch: fetchImpl as typeof fetch,
      homeserver: "https://matrix.example.com",
    });

    await expect(login.password({ password: "secret", username: "bot" })).resolves.toMatchObject({
      accessToken: "access",
      deviceId: "DEVICE",
    });
    expect(await requestBody(fetchImpl)).toEqual({
      identifier: { type: "m.id.user", user: "bot" },
      initial_device_display_name: "Matrix",
      password: "secret",
      type: "m.login.password",
    });
  });
});

async function requestBody(fetchImpl: ReturnType<typeof vi.fn>) {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}
