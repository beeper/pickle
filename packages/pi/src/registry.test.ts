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

  it("indexes child and subagent bindings without a Desktop-specific store", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-pi-"));
    const registry = new PicklePiRegistry(resolve(dir, "registry.json"));
    await registry.load();
    registry.upsertBinding({
      createdAt: 1,
      cwd: "/repo",
      id: "parent",
      mode: "headless",
      owner: "appservice",
      piGhostUserId: "@pi:example.com",
      piSessionFile: "/sessions/parent.jsonl",
      roomId: "!parent:example.com",
      updatedAt: 1,
    });
    registry.upsertBinding({
      createdAt: 2,
      cwd: "/repo",
      fork: { createdAt: 2, forkedFromBindingId: "parent", forkedFromEntryId: "entry_1", reason: "fork" },
      id: "child",
      mode: "headless",
      owner: "appservice",
      piGhostUserId: "@pi:example.com",
      piSessionFile: "/sessions/child.jsonl",
      roomId: "!child:example.com",
      updatedAt: 2,
    });
    registry.upsertBinding({
      createdAt: 3,
      cwd: "/repo",
      id: "subagent",
      kind: "subagent",
      mode: "headless",
      owner: "appservice",
      piGhostUserId: "@pi:example.com",
      piSessionFile: "/sessions/subagent.jsonl",
      roomId: "!subagent:example.com",
      subagent: { id: "subagent_1", parentBindingId: "parent" },
      updatedAt: 3,
    });

    expect(registry.getBindingById("parent")?.roomId).toBe("!parent:example.com");
    expect(registry.getBindingsByCwd("/repo")).toHaveLength(3);
    expect(registry.getChildBindings("parent").map((binding) => binding.id)).toEqual(["child", "subagent"]);
    expect(registry.getSubagentBindings("parent").map((binding) => binding.id)).toEqual(["subagent"]);
    expect(registry.setActiveLeaf("parent", "leaf_2", 4)?.activeLeafId).toBe("leaf_2");
  });
});
