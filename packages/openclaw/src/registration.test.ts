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
      appserviceId: "pickle-openclaw",
      dataDir: "/tmp/openclaw",
      ghostLocalpartPrefix: "oc_agent_",
      senderLocalpart: "ocbot",
      userLocalpartPrefix: "oc_user_",
    });
    const registration = createAppserviceRegistration(config, { asToken: "as", hsToken: "hs" });
    expect(registration).toMatchObject({
      as_token: "as",
      hs_token: "hs",
      id: "pickle-openclaw",
      rate_limited: false,
      receive_ephemeral: true,
      sender_localpart: "ocbot",
      url: "http://127.0.0.1:29391",
    });
    expect(registration.namespaces.users).toEqual([
      { exclusive: true, regex: "^@ocbot:.*$" },
      { exclusive: true, regex: "^@oc_agent_.+:.*$" },
      { exclusive: true, regex: "^@oc_user_.+:.*$" },
    ]);
    expect(registration.namespaces.aliases).toEqual([
      { exclusive: true, regex: "^#pickle-openclaw_.+:.*$" },
    ]);
  });

  it("derives Matrix-safe localparts and non-federated room presets", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw" });
    expect(openClawAgentGhostLocalpart(config, "Codex/Main Agent")).toBe("openclaw_agent_codex/main_agent");
    expect(openClawUserGhostLocalpart(config, "@alice:beeper.local")).toBe("openclaw_user_alice_beeper.local");
    expect(openClawAliasLocalpart(config, "session 1")).toBe("pickle-openclaw_session_1");
    expect(openClawRoomCreationPreset(config)).toEqual({
      creation_content: { "m.federate": false },
      preset: "private_chat",
    });
  });
});
