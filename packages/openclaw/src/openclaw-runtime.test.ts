import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { OpenClawGatewayRuntime, type OpenClawGatewayEvent, type OpenClawTransport } from "./openclaw-runtime";

describe("OpenClawGatewayRuntime", () => {
  it("lists OpenClaw agents as Matrix ghost contacts", async () => {
    const transport = fakeTransport({
      "agents.list": { agents: [{ description: "Code", id: "codex", name: "Codex" }] },
    });
    const runtime = new OpenClawGatewayRuntime({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw", homeserver: "https://matrix.example" }),
      transport,
    });

    await expect(runtime.listAgentContacts()).resolves.toEqual([
      {
        agentId: "codex",
        description: "Code",
        displayName: "Codex",
        ghostUserId: "@openclaw_agent_codex:matrix.example",
      },
    ]);
    expect(transport.request).toHaveBeenCalledWith("agents.list", {});
  });

  it("creates sessions and sends messages through OpenClaw RPC", async () => {
    const transport = fakeTransport({
      "sessions.create": { key: "agent:codex:main", sessionId: "session_1" },
      "sessions.send": { runId: "run_1", sessionKey: "agent:codex:main" },
    });
    const runtime = new OpenClawGatewayRuntime({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport,
    });

    await expect(runtime.createSession({ agentId: "codex", label: "Main" })).resolves.toEqual({
      agentId: "codex",
      key: "agent:codex:main",
      label: "Main",
      raw: { key: "agent:codex:main", sessionId: "session_1" },
      sessionId: "session_1",
    });
    await expect(runtime.sendMessage({ message: "hello", sessionKey: "agent:codex:main", timeoutMs: 1000 })).resolves.toEqual({
      raw: { runId: "run_1", sessionKey: "agent:codex:main" },
      runId: "run_1",
      sessionKey: "agent:codex:main",
    });
    expect(transport.request).toHaveBeenCalledWith("sessions.send", {
      key: "agent:codex:main",
      message: "hello",
      timeoutMs: 1000,
    }, { expectFinal: true, timeoutMs: 1000 });
  });

  it("filters gateway events by run id and resolves approvals", async () => {
    const events: OpenClawGatewayEvent[] = [
      { event: "assistant.delta", payload: { delta: "skip", runId: "run_other" } },
      { event: "assistant.delta", payload: { delta: "use", runId: "run_1" } },
    ];
    const transport = fakeTransport({
      "exec.approval.resolve": { ok: true },
    }, events);
    const runtime = new OpenClawGatewayRuntime({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport,
    });

    const received: OpenClawGatewayEvent[] = [];
    for await (const event of runtime.eventsForRun("run_1")) received.push(event);
    expect(received).toEqual([{ event: "assistant.delta", payload: { delta: "use", runId: "run_1" } }]);
    await expect(runtime.resolveApproval({ approvalId: "approval_1", decision: "approve" })).resolves.toEqual({ ok: true });
    expect(transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
    });
  });
});

function fakeTransport(responses: Record<string, unknown>, events: OpenClawGatewayEvent[] = []): OpenClawTransport & {
  request: ReturnType<typeof vi.fn>;
} {
  return {
    async *events(filter) {
      for (const event of events) {
        if (!filter || filter(event)) yield event;
      }
    },
    request: vi.fn(async (method: string) => responses[method]),
  };
}
