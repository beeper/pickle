import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import {
  OpenClawGatewayRuntime,
  createOpenClawHttpTransport,
  createOpenClawWebSocketTransport,
  type OpenClawGatewayEvent,
  type OpenClawTransport,
} from "./openclaw-runtime";

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
    }, { expectFinal: false, timeoutMs: 1000 });
  });

  it("exposes generic OpenClaw gateway feature RPC wrappers", async () => {
    const transport = fakeTransport({
      "artifacts.list": { artifacts: [{ id: "artifact_1" }] },
      "models.list": { models: ["gpt-5.4"] },
      "sessions.abort": { aborted: true },
      "sessions.steer": { runId: "run_steer", sessionKey: "agent:codex:main" },
      "tasks.cancel": { cancelled: true },
      "tasks.list": { tasks: [] },
      "tools.catalog": { tools: [{ name: "exec" }] },
      "tools.effective": { tools: [{ name: "read" }] },
      "tools.invoke": { ok: true },
    });
    const runtime = new OpenClawGatewayRuntime({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport,
    });

    await expect(runtime.listModels()).resolves.toEqual({ models: ["gpt-5.4"] });
    await expect(runtime.listTools()).resolves.toEqual({ tools: [{ name: "exec" }] });
    await expect(runtime.effectiveTools("agent:codex:main")).resolves.toEqual({ tools: [{ name: "read" }] });
    await expect(runtime.invokeTool({ name: "read", sessionKey: "agent:codex:main" })).resolves.toEqual({ ok: true });
    await expect(runtime.listTasks()).resolves.toEqual({ tasks: [] });
    await expect(runtime.cancelTask("task_1", "stale")).resolves.toEqual({ cancelled: true });
    await expect(runtime.listArtifacts({ sessionKey: "agent:codex:main" })).resolves.toEqual({ artifacts: [{ id: "artifact_1" }] });
    await expect(runtime.steerSession({ message: "actually do this", sessionKey: "agent:codex:main" })).resolves.toEqual({
      raw: { runId: "run_steer", sessionKey: "agent:codex:main" },
      runId: "run_steer",
      sessionKey: "agent:codex:main",
    });
    await expect(runtime.abortSession({ runId: "run_steer" })).resolves.toEqual({ aborted: true });
    expect(transport.request).toHaveBeenCalledWith("tasks.cancel", { reason: "stale", taskId: "task_1" }, undefined);
    expect(transport.request).toHaveBeenCalledWith("sessions.abort", { runId: "run_steer" }, undefined);
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

  it("sends OpenClaw requests over the HTTP gateway transport", async () => {
    const requests: Array<{ body: unknown; headers: Headers; url: string }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        url: String(input),
      });
      return new Response(JSON.stringify({ result: { runId: "run_1" } }), { status: 200 });
    });
    const transport = createOpenClawHttpTransport({
      accessToken: "secret",
      fetch: fetchImpl,
      url: "ws://127.0.0.1:29390/openclaw",
    });

    await expect(transport.request("sessions.send", { key: "session", message: "hi" }, { expectFinal: false })).resolves.toEqual({
      runId: "run_1",
    });
    expect(requests).toEqual([
      {
        body: {
          expectFinal: false,
          method: "sessions.send",
          params: { key: "session", message: "hi" },
        },
        headers: expect.any(Headers),
        url: "http://127.0.0.1:29390/openclaw/rpc",
      },
    ]);
    expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
  });

  it("streams OpenClaw gateway events from SSE frames", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode([
          "event: assistant.delta",
          "data: {\"payload\":{\"runId\":\"skip\",\"delta\":\"no\"}}",
          "",
          "event: assistant.delta",
          "data: {\"payload\":{\"runId\":\"run_1\",\"delta\":\"yes\"},\"seq\":2}",
          "",
          "",
        ].join("\n")));
        controller.close();
      },
    });
    const transport = createOpenClawHttpTransport({
      fetch: vi.fn(async () => new Response(stream, { status: 200 })),
      url: "http://gateway",
    });

    const events: OpenClawGatewayEvent[] = [];
    for await (const event of transport.events((candidate) => {
      const payload = candidate.payload as { runId?: string };
      return payload.runId === "run_1";
    })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        event: "assistant.delta",
        payload: { runId: "run_1", delta: "yes" },
        seq: 2,
      },
    ]);
  });

  it("uses OpenClaw gateway WebSocket req/res framing and broadcast events", async () => {
    FakeWebSocket.instances = [];
    const transport = createOpenClawWebSocketTransport({
      accessToken: "secret",
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      url: "ws://gateway",
    });

    const request = transport.request("sessions.send", { key: "session", message: "hi" });
    const socket = FakeWebSocket.instances[0];
    await waitFor(() => socket?.sent.length === 1);
    expect(JSON.parse(socket?.sent[0] ?? "{}")).toMatchObject({
      method: "connect",
      params: {
        auth: { token: "secret" },
        role: "operator",
        scopes: ["operator.read", "operator.write", "operator.approvals"],
      },
      type: "req",
    });
    socket?.receive({ id: JSON.parse(socket.sent[0] ?? "{}").id, ok: true, payload: { ok: true }, type: "res" });
    await waitFor(() => socket?.sent.length === 2);
    const sent = JSON.parse(socket?.sent[1] ?? "{}");
    expect(sent).toMatchObject({
      method: "sessions.send",
      params: { key: "session", message: "hi" },
      type: "req",
    });
    socket?.receive({ id: sent.id, ok: true, payload: { runId: "run_1" }, type: "res" });
    await expect(request).resolves.toEqual({ runId: "run_1" });

    const events: OpenClawGatewayEvent[] = [];
    const iterator = transport.events((event) => {
      const payload = event.payload as { runId?: string };
      return payload.runId === "run_1";
    });
    const next = iterator[Symbol.asyncIterator]().next();
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket?.receive({ event: "session.message", payload: { runId: "skip" }, type: "event" });
    socket?.receive({ event: "session.message", payload: { runId: "run_1" }, seq: 3, type: "event" });
    events.push((await next).value);
    expect(events).toEqual([{ event: "session.message", payload: { runId: "run_1" }, seq: 3 }]);
    transport.close();
  });

  it("accepts gateway WebSocket events with top-level run metadata", async () => {
    FakeWebSocket.instances = [];
    const transport = createOpenClawWebSocketTransport({
      WebSocket: FakeWebSocket as unknown as typeof WebSocket,
      url: "ws://gateway",
    });

    const iterator = transport.events((event) => {
      const payload = event.payload as { runId?: string };
      return payload.runId === "run_top";
    });
    const next = iterator[Symbol.asyncIterator]().next();
    await waitFor(() => (FakeWebSocket.instances[0]?.sent.length ?? 0) === 1);
    const socket = FakeWebSocket.instances[0]!;
    socket?.receive({ id: JSON.parse(socket.sent[0] ?? "{}").id, ok: true, payload: { ok: true }, type: "res" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    socket?.receive({ event: "session.message", runId: "run_skip", type: "event" });
    socket?.receive({ deltaText: "hi", event: "session.message", runId: "run_top", seq: 4, type: "event" });

    await expect(next).resolves.toEqual({
      done: false,
      value: {
        event: "session.message",
        payload: { deltaText: "hi", event: "session.message", runId: "run_top", seq: 4, type: "event" },
        seq: 4,
      },
    });
    transport.close();
  });
});

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  #listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = 1;
      this.#emit("open", {});
    });
  }

  addEventListener(type: string, listener: (event: { data?: string }) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event: { data?: string }) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.#emit("close", {});
  }

  receive(frame: unknown): void {
    this.#emit("message", { data: JSON.stringify(frame) });
  }

  #emit(type: string, event: { data?: string }): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
}

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
