import { describe, expect, it } from "vitest";
import { createDefaultConfig } from "./config";
import {
  agentContactFromOpenClawAgent,
  agentGhostUserId,
  matrixDomainFromHomeserver,
  serviceBotUserId,
} from "./rooms";

describe("OpenClaw room and contact helpers", () => {
  it("derives ghost identities for every OpenClaw agent", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw", homeserver: "https://matrix.example.com" });
    expect(matrixDomainFromHomeserver(config.homeserver)).toBe("matrix.example.com");
    expect(agentGhostUserId(config, "Codex Main")).toBe("@sh-openclaw_agent_codex_main:matrix.example.com");
    expect(serviceBotUserId(config)).toBe("@sh-openclawbot:matrix.example.com");
    expect(agentContactFromOpenClawAgent(config, {
      avatarMxc: "mxc://example/avatar",
      description: "Local code agent",
      id: "codex",
      name: "Codex",
    })).toEqual({
      agentId: "codex",
      avatarMxc: "mxc://example/avatar",
      avatarUrl: "mxc://example/avatar",
      description: "Local code agent",
      displayName: "Codex",
      ghostUserId: "@sh-openclaw_agent_codex:matrix.example.com",
    });
  });

});
