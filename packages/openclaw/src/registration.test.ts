import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "./config";
import {
  createAppserviceRegistration,
  openClawAgentGhostLocalpart,
  openClawAliasLocalpart,
  openClawRoomCreationPreset,
} from "./registration";

describe("OpenClaw appservice registration", () => {
  it("reserves bridge bot and OpenClaw agent namespaces", () => {
    const config = createDefaultConfig({
      appserviceId: "sh-openclaw-device",
      bridgeId: "sh-openclaw-device",
      dataDir: "/tmp/openclaw",
      homeserverDomain: "beeper.local",
    });
    const registration = createAppserviceRegistration(config, { asToken: "as", hsToken: "hs" });
    expect(registration).toMatchObject({
      as_token: "as",
      hs_token: "hs",
      id: "sh-openclaw-device",
      rate_limited: false,
      receive_ephemeral: true,
      sender_localpart: "sh-openclaw-devicebot",
      url: "websocket",
    });
    expect(registration.namespaces.users).toEqual([
      { exclusive: true, regex: "^@sh-openclaw-device_agent_.+:beeper\\.local$" },
      { exclusive: true, regex: "^@sh-openclaw-devicebot:beeper\\.local$" },
    ]);
    expect(registration.namespaces.aliases).toEqual([
      { exclusive: true, regex: "^#sh-openclaw-device_.+:.*$" },
    ]);
  });

  it("derives Matrix-safe localparts and non-federated room presets", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw" });
    expect(openClawAgentGhostLocalpart(config, "Codex/Main Agent")).toBe("sh-openclaw_agent_codex/main_agent");
    expect(openClawAliasLocalpart(config, "session 1")).toBe("sh-openclaw_session_1");
    expect(openClawRoomCreationPreset(config)).toEqual({
      creation_content: { "m.federate": false },
      preset: "private_chat",
    });
  });

  it("uses appservice tokens without Matrix user credentials", () => {
    const config = createDefaultConfig({
      asToken: "as-token",
      dataDir: "/tmp/openclaw",
      hsToken: "hs-token",
    });
    expect(createAppserviceRegistration(config).as_token).toBe("as-token");
    expect(createAppserviceRegistration(config).hs_token).toBe("hs-token");

    const generated = createAppserviceRegistration(createDefaultConfig({
      dataDir: "/tmp/openclaw",
    }));
    expect(generated.as_token).toMatch(/^[a-f0-9]{64}$/u);
  });
});
