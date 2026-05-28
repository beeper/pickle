import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import {
  agentContactFromOpenClawAgent,
  agentGhostUserId,
  bindingIdForRoom,
  createSessionRoom,
  matrixDomainFromHomeserver,
  serviceBotUserId,
  userContactFromOpenClawSession,
  userGhostUserId,
} from "./rooms";

describe("OpenClaw room and contact helpers", () => {
  it("derives ghost identities for every OpenClaw agent", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw", homeserver: "https://matrix.example.com" });
    expect(matrixDomainFromHomeserver(config.homeserver)).toBe("matrix.example.com");
    expect(agentGhostUserId(config, "Codex Main")).toBe("@sh-openclaw_agent_codex_main:matrix.example.com");
    expect(userGhostUserId(config, "whatsapp:+1 555")).toBe("@sh-openclaw_user_whatsapp_1_555:matrix.example.com");
    expect(serviceBotUserId(config)).toBe("@sh-openclawbot:matrix.example.com");
    expect(agentContactFromOpenClawAgent(config, {
      avatarMxc: "mxc://example/avatar",
      description: "Local code agent",
      id: "codex",
      name: "Codex",
    })).toEqual({
      agentId: "codex",
      avatarMxc: "mxc://example/avatar",
      description: "Local code agent",
      displayName: "Codex",
      ghostUserId: "@sh-openclaw_agent_codex:matrix.example.com",
    });
    expect(userContactFromOpenClawSession(config, {
      displayName: "Alice",
      lastProvider: "whatsapp",
      lastTo: "whatsapp:+1 555",
    })).toEqual({
      displayName: "Alice",
      ghostUserId: "@sh-openclaw_user_whatsapp_1_555:matrix.example.com",
      source: "whatsapp",
      userId: "whatsapp:+1 555",
    });
  });

  it("creates non-federated appservice rooms for OpenClaw sessions", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T12:00:00.000Z"));
    const createRoom = vi.fn(async () => ({ raw: {}, roomId: "!session:example.com" }));
    const client = { appservice: { createRoom } } as unknown as MatrixClient;
    const config = createDefaultConfig({
      allowedUserIds: ["@owner:example.com"],
      dataDir: "/tmp/openclaw",
      homeserver: "https://example.com",
    });

    try {
      const binding = await createSessionRoom(client, config, {
        agent: {
          agentId: "codex",
          displayName: "Codex",
          ghostUserId: "@sh-openclaw_agent_codex:example.com",
        },
        cwd: "/repo",
        label: "Fix tests",
        sessionKey: "agent:codex:main",
        spaceId: "!space:example.com",
      });

      expect(createRoom).toHaveBeenCalledWith({
        creation_content: { "m.federate": false },
        invite: ["@owner:example.com"],
        isDirect: true,
        name: "Fix tests",
        preset: "private_chat",
        topic: "OpenClaw agent: codex\nsession: agent:codex:main\ncwd: /repo",
        userId: "@sh-openclawbot:example.com",
        visibility: "private",
      });
      expect(binding).toEqual({
        agentId: "codex",
        createdAt: Date.parse("2026-05-16T12:00:00.000Z"),
        cwd: "/repo",
        ghostUserId: "@sh-openclaw_agent_codex:example.com",
        id: bindingIdForRoom("!session:example.com"),
        kind: "session",
        label: "Fix tests",
        owner: "bridge",
        roomId: "!session:example.com",
        sessionKey: "agent:codex:main",
        spaceId: "!space:example.com",
        updatedAt: Date.parse("2026-05-16T12:00:00.000Z"),
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
