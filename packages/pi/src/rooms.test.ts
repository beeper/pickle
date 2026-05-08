import { resolve } from "node:path";
import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { bindingIdForRoom, createSessionRoom, piGhostUserId, sessionFileForBinding } from "./rooms";
import { projectKeyForCwd } from "./spaces";
import type { PicklePiConfig } from "./types";

describe("room helpers", () => {
  it("derives stable room binding ids and session files from room id and cwd", () => {
    const config = piConfig({ dataDir: "/var/lib/pickle-pi" });
    const cwd = "/Users/alice/work/pickle";
    const roomId = "!room/with+chars:example.com";
    const bindingId = bindingIdForRoom(roomId);

    expect(bindingId).toBe(Buffer.from(roomId).toString("base64url"));
    expect(sessionFileForBinding(config, cwd, bindingId)).toBe(
      resolve(config.dataDir, "sessions", projectKeyForCwd(cwd), `${bindingId}.jsonl`)
    );
  });

  it("creates a session room and returns the derived binding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T10:00:00.000Z"));
    const createRoom = vi.fn(async () => ({ raw: {}, roomId: "!session:example.com" }));
    const client = { appservice: { createRoom } } as unknown as MatrixClient;
    const config = piConfig({
      allowedUserIds: ["@owner:example.com"],
      dataDir: "/tmp/pickle-pi",
      ghostLocalpart: "pickle-pi",
      serviceBotLocalpart: "pickle-service",
    });

    try {
      const binding = await createSessionRoom(client, config, {
        cwd: "/repo",
        domain: "example.com",
        sessionName: "Fix tests",
        spaceId: "!space:example.com",
      });

      expect(createRoom).toHaveBeenCalledWith({
        invite: ["@owner:example.com"],
        isDirect: false,
        name: "Fix tests",
        topic: "cwd: /repo",
        userId: "@pickle-service:example.com",
        visibility: "private",
      });
      expect(binding).toEqual({
        createdAt: Date.parse("2026-05-08T10:00:00.000Z"),
        cwd: "/repo",
        id: bindingIdForRoom("!session:example.com"),
        mode: "headless",
        owner: "appservice",
        piGhostUserId: "@pickle-pi:example.com",
        piSessionFile: resolve("/tmp/pickle-pi", "sessions", projectKeyForCwd("/repo"), `${bindingIdForRoom("!session:example.com")}.jsonl`),
        roomId: "!session:example.com",
        serviceBotUserId: "@pickle-service:example.com",
        sessionName: "Fix tests",
        spaceId: "!space:example.com",
        updatedAt: Date.parse("2026-05-08T10:00:00.000Z"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("derives pi ghost user ids with localhost as the default domain", () => {
    const config = piConfig({ ghostLocalpart: "pickle-pi" });

    expect(piGhostUserId(config)).toBe("@pickle-pi:localhost");
    expect(piGhostUserId(config, "example.com")).toBe("@pickle-pi:example.com");
  });
});

function piConfig(overrides: Partial<PicklePiConfig> = {}): PicklePiConfig {
  return {
    appserviceId: "pickle-pi",
    dataDir: "/data",
    ghostLocalpart: "pi",
    serviceBotLocalpart: "pickle",
    storePath: "/data/store.json",
    ...overrides,
  };
}
