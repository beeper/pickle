import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "./config";
import {
  createAppserviceRegistration,
  openClawAgentGhostLocalpart,
  openClawAliasLocalpart,
  openClawRoomCreationPreset,
  openClawUserGhostLocalpart,
} from "./registration";

describe("OpenClaw appservice registration", () => {
  it("reserves bridge bot, OpenClaw agent, and human ghost namespaces", () => {
    const config = createDefaultConfig({
      appserviceId: "sh-openclaw-device",
      dataDir: "/tmp/openclaw",
      ghostLocalpartPrefix: "oc_agent_",
      homeserverDomain: "beeper.local",
      senderLocalpart: "ocbot",
      userLocalpartPrefix: "oc_user_",
    });
    const registration = createAppserviceRegistration(config, { asToken: "as", hsToken: "hs" });
    expect(registration).toMatchObject({
      as_token: "as",
      hs_token: "hs",
      id: "sh-openclaw-device",
      rate_limited: false,
      receive_ephemeral: true,
      sender_localpart: "ocbot",
      url: "websocket",
    });
    expect(registration.namespaces.users).toEqual([
      { exclusive: true, regex: "^@oc_agent_.+:beeper\\.local$" },
      { exclusive: true, regex: "^@oc_user_.+:beeper\\.local$" },
      { exclusive: true, regex: "^@ocbot:beeper\\.local$" },
    ]);
    expect(registration.namespaces.aliases).toEqual([
      { exclusive: true, regex: "^#sh-openclaw-device_.+:.*$" },
    ]);
  });

  it("derives Matrix-safe localparts and non-federated room presets", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw" });
    expect(openClawAgentGhostLocalpart(config, "Codex/Main Agent")).toBe("openclaw_agent_codex/main_agent");
    expect(openClawUserGhostLocalpart(config, "@alice:beeper.local")).toBe("openclaw_user_alice_beeper.local");
    expect(openClawAliasLocalpart(config, "session 1")).toBe("sh-openclaw_session_1");
    expect(openClawRoomCreationPreset(config)).toEqual({
      creation_content: { "m.federate": false },
      preset: "private_chat",
    });
  });

  it("keeps appservice tokens independent from the Beeper Matrix access token", () => {
    const config = createDefaultConfig({
      accessToken: "mx-token",
      asToken: "as-token",
      dataDir: "/tmp/openclaw",
      hsToken: "hs-token",
    });
    expect(createAppserviceRegistration(config).as_token).toBe("as-token");
    expect(createAppserviceRegistration(config).hs_token).toBe("hs-token");

    const generated = createAppserviceRegistration(createDefaultConfig({
      accessToken: "mx-token",
      dataDir: "/tmp/openclaw",
    }));
    expect(generated.as_token).not.toBe("mx-token");
    expect(generated.as_token).toMatch(/^[a-f0-9]{64}$/u);
  });
});
