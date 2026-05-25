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
    }, { expectFinal: false });
    expect(registry.getBindingByRoom("!room:example.com")?.lastRunId).toBe("run_1");
    expect(published.flatMap((item) => item.chunks).map((chunk) => (chunk as { type: string }).type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
  });

  it("persists the Beeper stream target event id for later relation handling", async () => {
    const registry = await tempRegistry();
    registry.upsertBinding(testBinding());
    const streams: OpenClawBridgeStreamPublisher = {
      publish: vi.fn(async () => ({ targetEventId: "$stream-root" })),
    };
    const agent = new OpenClawMatrixBridgeAgent({
      registry,
      runtime: runtimeWith({
        events: [
          { event: "assistant.delta", payload: { data: { delta: "hi" }, runId: "run_1", type: "assistant.delta" } },
          { event: "run.completed", payload: { runId: "run_1", type: "run.completed" } },
        ],
        responses: { "sessions.send": { runId: "run_1", sessionKey: "agent:codex:main" } },
      }),
      streams,
    });

    await agent.handleMatrixText({
      eventId: "$event",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      text: "hello",
    });

    expect(registry.getBindingByRoom("!room:example.com")).toMatchObject({
      lastMatrixEventId: "$event",
      lastRunId: "run_1",
      lastStreamRunId: "run_1",
      lastStreamTargetEventId: "$stream-root",
    });
  });

  it("does not poison message dedupe when OpenClaw send fails before persistence", async () => {
    const registry = await tempRegistry();
    registry.upsertBinding(testBinding());
    const runtime = runtimeWith({
      responses: {
        "sessions.send": new Error("gateway down"),
      },
    });
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime, streams: { publish: vi.fn() } });

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
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime, streams: { publish: vi.fn() } });

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
      message: "hello",
    }, { expectFinal: false });
    expect(registry.getBindingByRoom("!room:example.com")?.sessionKey).toBe("agent:codex:session_1");
  });

  it("preserves gateway event names when streaming protocol-v4 payload frames", async () => {
    const registry = await tempRegistry();
    const binding = testBinding();
    registry.upsertBinding(binding);
    const published: unknown[] = [];
    const streams: OpenClawBridgeStreamPublisher = {
      publish(_binding, chunks) {
        published.push(...chunks);
      },
    };
    const agent = new OpenClawMatrixBridgeAgent({
      registry,
      runtime: runtimeWith({
        events: [
          { event: "session.operation", payload: { phase: "started", runId: "run_1" } },
          { event: "session.message", payload: { deltaText: "hello", role: "assistant", runId: "run_1" } },
          { event: "session.tool", payload: { input: { cmd: "pwd" }, name: "shell", phase: "started", runId: "run_1", toolCallId: "tool_1" } },
          { event: "exec.approval.requested", payload: { approvalId: "approval_1", message: "Run command?", runId: "run_1", toolCallId: "tool_1" } },
          { event: "session.operation", payload: { phase: "completed", runId: "run_1" } },
        ],
        responses: {},
      }),
      streams,
    });

    await agent.streamRun(binding, "run_1");

    expect(published.map((chunk) => (chunk as { type: string }).type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "CUSTOM",
      "TEXT_MESSAGE_END",
      "RUN_FINISHED",
    ]);
  });

  it("seeds streaming state with the actual OpenClaw run id", async () => {
    const registry = await tempRegistry();
    const binding = testBinding();
    const published: unknown[] = [];
    const agent = new OpenClawMatrixBridgeAgent({
      registry,
      runtime: runtimeWith({
        events: [
          { event: "session.message", payload: { deltaText: "hello", role: "assistant", runId: "run_actual" } },
          { event: "session.operation", payload: { phase: "completed", runId: "run_actual" } },
        ],
        responses: {},
      }),
      streams: {
        publish(_binding, chunks) {
          published.push(...chunks);
        },
      },
    });

    await agent.streamRun(binding, "run_actual");

    expect(published).toEqual([
      expect.objectContaining({ messageId: "run_actual", type: "TEXT_MESSAGE_START" }),
      expect.objectContaining({ messageId: "run_actual", type: "TEXT_MESSAGE_CONTENT" }),
      expect.objectContaining({ messageId: "run_actual", type: "TEXT_MESSAGE_END" }),
      expect.objectContaining({ runId: "run_actual", type: "RUN_FINISHED" }),
    ]);
  });

  it("stops consuming gateway events after a terminal run event", async () => {
    const registry = await tempRegistry();
    const binding = testBinding();
    let consumedAfterTerminal = false;
    const runtime = new OpenClawGatewayRuntime({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport: {
        async *events() {
          yield { event: "run.completed", payload: { runId: "run_1", type: "run.completed" } };
          consumedAfterTerminal = true;
          yield { event: "assistant.delta", payload: { data: { delta: "late" }, runId: "run_1", type: "assistant.delta" } };
        },
        request: vi.fn(),
      },
    });
    const streams: OpenClawBridgeStreamPublisher = {
      publish: vi.fn(),
    };
    const agent = new OpenClawMatrixBridgeAgent({ registry, runtime, streams });

    await agent.streamRun(binding, "run_1");

    expect(consumedAfterTerminal).toBe(false);
    expect(streams.publish).toHaveBeenCalledWith(expect.objectContaining({
      ...binding,
      lastRunId: "run_1",
      lastStreamRunId: "run_1",
    }), expect.arrayContaining([
      expect.objectContaining({ type: "RUN_FINISHED" }),
    ]));
  });

  it("forwards Beeper approval responses back to OpenClaw", async () => {
    const registry = await tempRegistry();
    const runtime = runtimeWith({
      responses: {
        "exec.approval.resolve": { ok: true },
        "plugin.approval.resolve": { ok: true },
      },
    });
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
