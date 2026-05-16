import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { attachRoomToSpace, createProjectSpace, projectKeyForCwd, projectSpaceName, serviceBotUserId } from "./spaces";
import type { PicklePiConfig } from "./types";

describe("space helpers", () => {
  it("derives stable project keys for cwd values", () => {
    const cwd = "/Users/alice/work/pickle";

    expect(projectKeyForCwd(cwd)).toBe(Buffer.from(cwd).toString("base64url"));
    expect(projectKeyForCwd(cwd)).toBe(projectKeyForCwd(cwd));
    expect(projectKeyForCwd(`${cwd}/nested`)).not.toBe(projectKeyForCwd(cwd));
  });

  it("derives readable project space names from cwd values", () => {
    expect(projectSpaceName("/Users/alice/work/pickle")).toBe("Pi: pickle");
    expect(projectSpaceName("/")).toBe("Pi: /");
  });

  it("creates project spaces as private Matrix spaces", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-08T11:00:00.000Z"));
    const createRoom = vi.fn(async () => ({ raw: {}, roomId: "!space:example.com" }));
    const client = { appservice: { createRoom } } as unknown as MatrixClient;
    const config = piConfig({
      allowedUserIds: ["@owner:example.com"],
      serviceBotLocalpart: "pickle-service",
    });

    try {
      const space = await createProjectSpace(client, config, "/repo/pickle");

      expect(createRoom).toHaveBeenCalledWith({
        creationContent: { type: "m.space" },
        invite: ["@owner:example.com"],
        isDirect: false,
        name: "Pi: pickle",
        userId: "@pickle-service:localhost",
        visibility: "private",
      });
      expect(space).toEqual({
        createdAt: Date.parse("2026-05-08T11:00:00.000Z"),
        cwd: "/repo/pickle",
        projectKey: projectKeyForCwd("/repo/pickle"),
        spaceId: "!space:example.com",
        updatedAt: Date.parse("2026-05-08T11:00:00.000Z"),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("attaches a room to a space with Matrix child and parent state events", async () => {
    const sendStateEvent = vi.fn(async () => ({ eventId: "$state" }));
    const client = { rooms: { sendStateEvent } } as unknown as MatrixClient;

    await attachRoomToSpace(client, "!room:example.com", "!space:example.com", ["example.com", "alt.example.com"]);

    expect(sendStateEvent).toHaveBeenNthCalledWith(1, {
      content: { suggested: true, via: ["example.com", "alt.example.com"] },
      eventType: "m.space.child",
      roomId: "!space:example.com",
      stateKey: "!room:example.com",
    });
    expect(sendStateEvent).toHaveBeenNthCalledWith(2, {
      content: { via: ["example.com", "alt.example.com"] },
      eventType: "m.space.parent",
      roomId: "!room:example.com",
      stateKey: "!space:example.com",
    });
  });

  it("derives service bot user ids with localhost as the default domain", () => {
    const config = piConfig({ serviceBotLocalpart: "pickle-service" });

    expect(serviceBotUserId(config)).toBe("@pickle-service:localhost");
    expect(serviceBotUserId(config, "example.com")).toBe("@pickle-service:example.com");
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
