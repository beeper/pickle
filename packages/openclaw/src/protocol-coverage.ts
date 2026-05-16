export const OPENCLAW_GATEWAY_METHOD_FAMILIES = [
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
] as const;

export const OPENCLAW_GATEWAY_EVENT_FAMILIES = [
  "chat",
  "session.message",
  "session.operation",
  "session.tool",
  "sessions.changed",
  "presence",
  "tick",
  "health",
  "heartbeat",
  "cron",
  "shutdown",
  "node.pair.requested",
  "node.pair.resolved",
  "node.invoke.request",
  "device.pair.requested",
  "device.pair.resolved",
  "voicewake.changed",
  "exec.approval.requested",
  "exec.approval.resolved",
  "plugin.approval.requested",
  "plugin.approval.resolved",
] as const;

export const OPENCLAW_BRIDGE_COVERAGE = {
  eventFamilies: {
    approval: ["exec.approval.requested", "exec.approval.resolved", "plugin.approval.requested", "plugin.approval.resolved"],
    ignoredOperational: ["sessions.changed", "presence", "tick", "health", "heartbeat", "cron", "shutdown", "node.pair.requested", "node.pair.resolved", "node.invoke.request", "device.pair.requested", "device.pair.resolved", "voicewake.changed"],
    stream: ["chat", "session.message", "session.operation", "session.tool"],
  },
  methodAccess: {
    bridgeSpecificWrappers: ["agents.list", "sessions.list", "sessions.create", "sessions.send", "sessions.steer", "sessions.abort", "chat.history", "exec.approval.resolve", "models.list", "tools.catalog", "tools.effective", "tools.invoke", "tasks.list", "tasks.get", "tasks.cancel", "artifacts.list", "artifacts.get", "artifacts.download"],
    genericGatewayCall: "OpenClawGatewayRuntime.call",
    snapshotProbe: ["health", "status", "models.list", "channels.status", "sessions.list", "commands.list", "tools.catalog", "skills.status", "tasks.list", "usage.status", "artifacts.list", "cron.list", "agents.list", "config.get"],
  },
  source: ".upstream/openclaw/docs/gateway/protocol.md",
} as const;

export type OpenClawGatewayMethodFamily = typeof OPENCLAW_GATEWAY_METHOD_FAMILIES[number];
export type OpenClawGatewayEventFamily = typeof OPENCLAW_GATEWAY_EVENT_FAMILIES[number];
