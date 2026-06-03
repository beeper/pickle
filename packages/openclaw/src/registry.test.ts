import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClawBridgeRegistry", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { force: true, recursive: true })));
  });

  it("persists agent contacts, session bindings, and dedupe keys", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-"));
    cleanup.push(dir);
    const path = resolve(dir, "registry.json");
    const registry = new OpenClawBridgeRegistry(path);
    await registry.load();
    registry.upsertAgent({
      agentId: "codex",
      displayName: "Codex",
      ghostUserId: "@sh-openclaw_agent_codex:example.com",
    });
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@sh-openclaw_agent_codex:example.com",
      id: "binding",
      roomId: "!room:example.com",
      sessionKey: "agent:codex:main",
      updatedAt: 1,
    });
    registry.markDedupe("$event");
    await registry.save();

    const loaded = new OpenClawBridgeRegistry(path);
    await loaded.load();
    expect(loaded.getAgent("codex")?.displayName).toBe("Codex");
    expect(loaded.getBindingByRoom("!room:example.com")?.sessionKey).toBe("agent:codex:main");
    expect(loaded.getBindingBySessionKey("agent:codex:main")?.id).toBe("binding");
    expect(loaded.getBindingsByAgent("codex")).toHaveLength(1);
    expect(loaded.hasDedupe("$event")).toBe(true);
  });
});
