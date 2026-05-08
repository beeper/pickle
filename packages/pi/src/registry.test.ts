import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PicklePiRegistry } from "./registry";

describe("PicklePiRegistry", () => {
  it("persists bindings, project spaces, and dedupe state", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-pi-"));
    const path = resolve(dir, "registry.json");
    const registry = new PicklePiRegistry(path);
    await registry.load();
    registry.upsertBinding({
      createdAt: 1,
      cwd: "/repo",
      id: "binding",
      mode: "headless",
      owner: "appservice",
      piGhostUserId: "@pi:example.com",
      piSessionFile: "/sessions/a.jsonl",
      roomId: "!room:example.com",
      updatedAt: 1,
    });
    registry.upsertProjectSpace({ createdAt: 1, cwd: "/repo", projectKey: "repo", spaceId: "!space:example.com", updatedAt: 1 });
    registry.markDedupe("$event");
    await registry.save();

    const loaded = new PicklePiRegistry(path);
    await loaded.load();
    expect(loaded.getBindingByRoom("!room:example.com")?.piSessionFile).toBe("/sessions/a.jsonl");
    expect(loaded.getProjectSpace("repo")?.spaceId).toBe("!space:example.com");
    expect(loaded.hasDedupe("$event")).toBe(true);
  });
});
