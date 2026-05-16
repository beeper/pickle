import { describe, expect, it } from "vitest";
import {
  OPENCLAW_BRIDGE_COVERAGE,
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

  it("keeps broad feature access routed through generic gateway calls plus wrappers", () => {
    expect(OPENCLAW_BRIDGE_COVERAGE.methodAccess.genericGatewayCall).toBe("OpenClawGatewayRuntime.call");
    expect(OPENCLAW_BRIDGE_COVERAGE.methodAccess.bridgeSpecificWrappers).toEqual(expect.arrayContaining([
      "agents.list",
      "sessions.send",
      "sessions.steer",
      "sessions.abort",
      "chat.history",
      "exec.approval.resolve",
      "tools.invoke",
      "artifacts.download",
    ]));
  });
});
