import { describe, expect, it } from "vitest";
import {
  OPENCLAW_BRIDGE_COVERAGE,
  OPENCLAW_GATEWAY_COMMON_METHODS,
  OPENCLAW_GATEWAY_EVENT_FAMILIES,
  OPENCLAW_GATEWAY_METHOD_FAMILIES,
} from "./protocol-coverage";

describe("OpenClaw gateway protocol coverage manifest", () => {
  it("tracks all upstream gateway method families", () => {
    expect(OPENCLAW_GATEWAY_METHOD_FAMILIES).toEqual([
      "system",
      "models",
      "usage",
      "channels",
      "messaging",
      "talk",
      "secrets",
      "config",
      "update",
      "wizard",
      "agents",
      "tasks",
      "artifacts",
      "environments",
      "sessions",
      "device-pairing",
      "node-pairing",
      "approvals",
      "automation",
      "skills",
      "tools",
    ]);
  });

  it("declares stream, approval, and operational event handling buckets", () => {
    const coveredEvents = new Set([
      ...OPENCLAW_BRIDGE_COVERAGE.eventFamilies.stream,
      ...OPENCLAW_BRIDGE_COVERAGE.eventFamilies.approval,
      ...OPENCLAW_BRIDGE_COVERAGE.eventFamilies.ignoredOperational,
    ]);
    expect(OPENCLAW_GATEWAY_EVENT_FAMILIES.every((family) => coveredEvents.has(family))).toBe(true);
  });

  it("keeps broad feature access routed through plugin runtime surfaces", () => {
    expect(OPENCLAW_BRIDGE_COVERAGE.methodAccess.beeperTurnDispatch).toBe("runtime.channel.turn.runAssembled");
    expect(OPENCLAW_BRIDGE_COVERAGE.methodAccess.managementSurface).toBe("OpenClaw in-process plugin runtime");
    expect(OPENCLAW_BRIDGE_COVERAGE.methodAccess.pluginRuntimeAdapters).toEqual(expect.arrayContaining([
      "agents.list",
      "sessions.list",
      "sessions.create",
      "chat.history",
      "exec.approval.resolve",
      "plugin.approval.resolve",
    ]));
    expect(OPENCLAW_GATEWAY_COMMON_METHODS).toEqual(expect.arrayContaining([
      "talk.session.create",
      "config.schema.lookup",
      "agents.files.set",
      "sessions.messages.subscribe",
      "device.token.rotate",
      "node.pending.enqueue",
      "plugin.approval.resolve",
      "skills.install",
      "tools.invoke",
    ]));
    expect(new Set(OPENCLAW_GATEWAY_COMMON_METHODS).size).toBe(OPENCLAW_GATEWAY_COMMON_METHODS.length);
  });
});
