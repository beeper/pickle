import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { OpenClawMatrixBridgeAgent } from "./bridge-agent";
import { OpenClawGatewayRuntime, type OpenClawGatewayEvent, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";
import type { OpenClawSessionBinding } from "./types";

describe("OpenClawMatrixBridgeAgent", () => {
  it("syncs OpenClaw agents into bridge contacts", async () => {
    const registry = await tempRegistry();
    const agent = new OpenClawMatrixBridgeAgent({
      registry,
      runtime: runtimeWith({
        responses: { "agents.list": { agents: [{ id: "codex", name: "Codex" }] } },
      }),
    });

    await agent.syncAgentContacts();
    expect(registry.getAgent("codex")?.ghostUserId).toBe("@openclaw_agent_codex:localhost");
  });

  it("sends Matrix room text to the bound OpenClaw session", async () => {
    const registry = await tempRegistry();
    registry.upsertBinding(testBinding());
    const runtime = runtimeWith({
      responses: { "sessions.send": { runId: "run_1", sessionKey: "agent:codex:main" } },
    });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime });

    await agent.handleMatrixText({
      eventId: "$event",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      text: "hello",
    });

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$event",
      key: "agent:codex:main",
      matrix: { roomId: "!room:example.com" },
      message: "hello",
    }, { expectFinal: false });
    expect(registry.getBindingByRoom("!room:example.com")?.lastRunId).toBe("run_1");
  });

  it("does not poison message dedupe when OpenClaw send fails before persistence", async () => {
    const registry = await tempRegistry();
    registry.upsertBinding(testBinding());
    const runtime = runtimeWith({
      responses: {
        "sessions.send": new Error("gateway down"),
      },
    });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime });

    await expect(agent.handleMatrixText({
      eventId: "$retryable",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      text: "hello",
    })).rejects.toThrow("gateway down");

    expect(registry.hasDedupe("$retryable")).toBe(false);

    runtime.transport.request.mockImplementation(async (method: string) => {
      if (method === "sessions.send") return { runId: "run_retry", sessionKey: "agent:codex:main" };
      return undefined;
    });

    await agent.handleMatrixText({
      eventId: "$retryable",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      text: "hello",
    });

    expect(registry.hasDedupe("$retryable")).toBe(true);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$retryable",
      key: "agent:codex:main",
      matrix: { roomId: "!room:example.com" },
      message: "hello",
    }, { expectFinal: false });
  });

  it("creates an OpenClaw session before sending the first message in an agent contact DM", async () => {
    const registry = await tempRegistry();
    registry.upsertBinding({
      ...testBinding(),
      sessionKey: "agent:codex",
    });
    const runtime = runtimeWith({
      events: [
        { event: "run.completed", payload: { runId: "run_1", type: "run.completed" } },
      ],
      responses: {
        "sessions.create": { key: "agent:codex:session_1", sessionId: "session_1" },
        "sessions.send": { runId: "run_1", sessionKey: "agent:codex:session_1" },
      },
    });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime });

    await agent.handleMatrixText({
      eventId: "$event",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      text: "hello",
    });

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", {
      agentId: "codex",
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$event",
      key: "agent:codex:session_1",
      matrix: { roomId: "!room:example.com" },
      message: "hello",
    }, { expectFinal: false });
    expect(registry.getBindingByRoom("!room:example.com")?.sessionKey).toBe("agent:codex:session_1");
  });

  it("forwards Beeper approval responses back to OpenClaw", async () => {
    const registry = await tempRegistry();
    const runtime = runtimeWith({
      responses: {
        "exec.approval.resolve": { ok: true },
        "plugin.approval.resolve": { ok: true },
      },
    });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime });

    await expect(agent.handleApprovalContent({
      approvalId: "approval_1",
      approved: true,
      toolCallId: "call_1",
      type: "tool-approval-response",
    })).resolves.toEqual({
      approvalId: "approval_1",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
      toolCallId: "call_1",
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
      toolCallId: "call_1",
    });

    await expect(agent.handleApprovalContent({
      approvalId: "plugin:approval_2",
      approved: false,
      type: "tool-approval-response",
    })).resolves.toEqual({
      approvalId: "plugin:approval_2",
      approvalKind: "plugin",
      approved: false,
      approvedAlways: false,
      decision: "deny",
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("plugin.approval.resolve", {
      approvalId: "plugin:approval_2",
      decision: "deny",
    });
  });
});

async function tempRegistry(): Promise<OpenClawBridgeRegistry> {
  const dir = await mkdtemp(resolve(tmpdir(), "pickle-openclaw-agent-"));
  const registry = new OpenClawBridgeRegistry(resolve(dir, "registry.json"));
  await registry.load();
  return registry;
}

function testBinding(): OpenClawSessionBinding {
  return {
    agentId: "codex",
    createdAt: 1,
    ghostUserId: "@openclaw_agent_codex:example.com",
    id: "binding",
    kind: "session",
    owner: "bridge",
    roomId: "!room:example.com",
    sessionKey: "agent:codex:main",
    updatedAt: 1,
  };
}

function runtimeWith(options: {
  events?: OpenClawGatewayEvent[];
  responses: Record<string, unknown>;
}): OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } } {
  const transport = {
    async *events(filter?: (event: OpenClawGatewayEvent) => boolean) {
      for (const event of options.events ?? []) {
        if (!filter || filter(event)) yield event;
      }
    },
    request: vi.fn(async (method: string) => {
      const response = options.responses[method];
      if (response instanceof Error) throw response;
      return response;
    }),
  };
  return new OpenClawGatewayRuntime({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } };
}
