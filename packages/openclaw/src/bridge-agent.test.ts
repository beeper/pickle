import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { OpenClawMatrixBridgeAgent, type OpenClawBridgeStreamPublisher } from "./bridge-agent";
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
      streams: { publish: vi.fn() },
    });

    await agent.syncAgentContacts();
    expect(registry.getAgent("codex")?.ghostUserId).toBe("@openclaw_agent_codex:localhost");
  });

  it("sends Matrix room text to the bound OpenClaw session and streams run events", async () => {
    const registry = await tempRegistry();
    registry.upsertBinding(testBinding());
    const published: Array<{ binding: OpenClawSessionBinding; chunks: unknown[] }> = [];
    const streams: OpenClawBridgeStreamPublisher = {
      publish(binding, chunks) {
        published.push({ binding, chunks });
      },
    };
    const runtime = runtimeWith({
      events: [
        { event: "assistant.delta", payload: { data: { delta: "hi" }, runId: "run_1", type: "assistant.delta" } },
        { event: "run.completed", payload: { runId: "run_1", type: "run.completed" } },
      ],
      responses: { "sessions.send": { runId: "run_1", sessionKey: "agent:codex:main" } },
    });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime, streams });

    await agent.handleMatrixText({
      eventId: "$event",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      text: "hello",
    });

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$event",
      key: "agent:codex:main",
      message: "hello",
    }, { expectFinal: true });
    expect(registry.getBindingByRoom("!room:example.com")?.lastRunId).toBe("run_1");
    expect(published.flatMap((item) => item.chunks).map((chunk) => (chunk as { type: string }).type)).toEqual([
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
  });

  it("forwards Beeper approval responses back to OpenClaw", async () => {
    const registry = await tempRegistry();
    const runtime = runtimeWith({ responses: { "exec.approval.resolve": { ok: true } } });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime, streams: { publish: vi.fn() } });

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
    request: vi.fn(async (method: string) => options.responses[method]),
  };
  return new OpenClawGatewayRuntime({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } };
}
