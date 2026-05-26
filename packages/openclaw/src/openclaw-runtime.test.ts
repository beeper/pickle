import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BeeperChannelRuntime, setBeeperChannelRuntime } from "./beeper-channel-runtime";
import { createDefaultConfig } from "./config";
import {
  createOpenClawHostTransport,
  OpenClawGatewayRuntime,
  type OpenClawGatewayEvent,
  type OpenClawTransport,
} from "./openclaw-runtime";

describe("OpenClawGatewayRuntime", () => {
  afterEach(() => {
    setBeeperChannelRuntime(undefined);
  });

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
      "plugin.approval.resolve": { plugin: true },
    }, events);
    const runtime = new OpenClawGatewayRuntime({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport,
    });

    await expect(runtime.resolveApproval({ approvalId: "approval_1", decision: "approve" })).resolves.toEqual({ ok: true });
    expect(transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
    });
    await expect(runtime.resolveApproval({ approvalId: "plugin:approval_2", approvalKind: "plugin", decision: "deny" })).resolves.toEqual({ plugin: true });
    expect(transport.request).toHaveBeenCalledWith("plugin.approval.resolve", {
      approvalId: "plugin:approval_2",
      decision: "deny",
    });
  });

  it("keeps generic host requests and event surface available", async () => {
    const runtimeEvents: OpenClawGatewayEvent[] = [
      { event: "session.message", payload: { runId: "skip" } },
      { event: "session.message", payload: { runId: "run_1" }, seq: 3 },
    ];
    const host = {
      async *events(filter?: (event: OpenClawGatewayEvent) => boolean) {
        for (const event of runtimeEvents) {
          if (!filter || filter(event)) yield event;
        }
      },
      request: vi.fn(async (method: string) => ({ method, runId: "run_1" })),
    };
    const transport = createOpenClawHostTransport(host);

    await expect(transport.request("exec.approval.resolve", { approvalId: "approval_1", decision: "approve" })).resolves.toEqual({
      method: "exec.approval.resolve",
      runId: "run_1",
    });
    expect(host.request).toHaveBeenCalledWith("exec.approval.resolve", { approvalId: "approval_1", decision: "approve" }, undefined);

    const received: OpenClawGatewayEvent[] = [];
    for await (const event of transport.events((candidate) => {
      const payload = candidate.payload as { runId?: string };
      return payload.runId === "run_1";
    })) {
      received.push(event);
    }
    expect(received).toEqual([{ event: "session.message", payload: { runId: "run_1" }, seq: 3 }]);
  });

  it("does not delegate Beeper session sends to a generic host request", async () => {
    const host = {
      request: vi.fn(async (method: string) => ({ method, runId: "host_run" })),
    };
    const transport = createOpenClawHostTransport({
      ...host,
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    });

    await expect(transport.request("sessions.send", { key: "session", message: "hi" })).rejects.toThrow("OpenClaw Beeper requires OpenClaw channel turn helpers");
    expect(host.request).not.toHaveBeenCalled();
  });

  it("adapts OpenClaw plugin runtime helpers when no gateway request surface exists", async () => {
    const transport = createOpenClawHostTransport({
      agent: {
        session: {
          listSessionEntries: () => [
            {
              sessionKey: "agent:main:dashboard:one",
              entry: {
                agentId: "main",
                chatType: "direct",
                label: "One",
                lastChannel: "webchat",
                origin: { provider: "webchat", surface: "webchat" },
                sessionFile: "/tmp/session.jsonl",
                updatedAt: 123,
              },
            },
          ],
        },
      },
      config: {
        current: () => ({
          agents: {
            list: [{ id: "main", name: "Main Agent" }],
          },
        }),
      },
    });

    await expect(transport.request("agents.list", {})).resolves.toEqual({
      agents: [{ id: "main", displayName: "Main Agent" }],
    });
    await expect(transport.request("sessions.list", { includeArchived: true })).resolves.toEqual({
      sessions: [{
        agentId: "main",
        chatType: "direct",
        displayName: "One",
        key: "agent:main:dashboard:one",
        label: "One",
        lastChannel: "webchat",
        lastProvider: "webchat",
        origin: { provider: "webchat", surface: "webchat" },
        provider: "webchat",
        sessionFile: "/tmp/session.jsonl",
        updatedAt: 123,
      }],
    });
    await expect(transport.request("chat.history", { sessionKey: "agent:main:dashboard:one" })).resolves.toEqual({
      messages: [],
    });
  });

  it("rejects Beeper-originated sends when the OpenClaw channel runtime is unavailable", async () => {
    const transport = createOpenClawHostTransport({
      agent: {
        resolveAgentDir: () => "/tmp/agent",
        session: {
          getSessionEntry: () => ({
            sessionFile: "/tmp/session.jsonl",
            sessionId: "session-1",
          }),
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    });

    await expect(transport.request("sessions.send", {
      key: "agent:main:beeper:room",
      message: "from Beeper",
      idempotencyKey: "$event",
    })).rejects.toThrow("OpenClaw Beeper requires OpenClaw channel turn helpers");
  });

  it("runs Beeper-originated sends through OpenClaw channel turn helpers for live AG-UI progress", async () => {
    const beeperStreams = {
      finalizeMessage: vi.fn(async () => ({
        eventId: "$stream-root",
        raw: {},
        replacementEventId: "$stream-final",
        roomId: "!room:example",
      })),
      publishPart: vi.fn(async () => undefined),
      startMessage: vi.fn(async () => ({
        descriptor: { type: "com.beeper.llm" },
        eventId: "$stream-root",
        roomId: "!room:example",
      })),
    };
    setBeeperChannelRuntime(new BeeperChannelRuntime({
      client: {
        beeper: { streams: beeperStreams },
        media: { upload: vi.fn() },
      } as never,
      userId: "@sh-openclaw-bot:example",
    }));
    const runAssembled = vi.fn(async (params: Record<string, unknown>) => {
      const replyOptions = params.replyOptions as Record<string, (payload?: unknown) => void | Promise<void>>;
      await replyOptions.onReasoningStream?.({ text: "checking" });
      await replyOptions.onToolStart?.({ args: { path: "README.md" }, name: "read_file", phase: "start", toolCallId: "real-tool-id" });
      await replyOptions.onCommandOutput?.({ name: "read_file", output: "ok", phase: "end", status: "completed", toolCallId: "real-tool-id" });
      await replyOptions.onApprovalEvent?.({
        approvalId: "approval_1",
        message: "Run command?",
        phase: "requested",
        toolCallId: "tool_1",
      });
      await replyOptions.onPartialReply?.({ text: "hello" });
      const delivery = params.delivery as { deliver?: (payload: unknown) => Promise<unknown> };
      await delivery.deliver?.({ text: "hello world" });
      return { dispatchResult: { queuedFinal: true } };
    });
    const transport = createOpenClawHostTransport({
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
        },
        session: {
          recordInboundSession: vi.fn(),
          resolveStorePath: () => "/tmp/sessions.json",
        },
        turn: {
          buildContext: (params: Record<string, unknown>) => ({
            Body: "from Beeper",
            BodyForAgent: "from Beeper",
            From: "beeper",
            RawBody: "from Beeper",
            SessionKey: (params.route as { routeSessionKey?: string }).routeSessionKey,
            To: "beeper",
          }),
          runAssembled,
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    });

    const received: OpenClawGatewayEvent[] = [];
    let observedRunId: string | undefined;
    const done = (async () => {
      for await (const event of transport.events((candidate) => {
        const payload = candidate.payload as { runId?: string };
        return !observedRunId || payload.runId === observedRunId;
      })) {
        received.push(event);
        if (received.some((event) => event.event === "run.completed")) break;
      }
    })();
    const sent = await transport.request("sessions.send", {
      key: "agent:main:beeper:room",
      message: "from Beeper",
      idempotencyKey: "$event",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
    });
    observedRunId = (sent as { runId?: string }).runId;
    await done;

    expect(runAssembled).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "beeper",
      agentId: "main",
      channel: "beeper",
      routeSessionKey: "agent:main:beeper:room",
    }));
    expect((runAssembled.mock.calls[0]?.[0] as { replyOptions?: Record<string, unknown> } | undefined)?.replyOptions).toMatchObject({
      disableBlockStreaming: false,
      sourceReplyDeliveryMode: "automatic",
    });
    expect(beeperStreams.startMessage.mock.invocationCallOrder[0]).toBeLessThan(runAssembled.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY);
    expect(received).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "thinking.delta" }),
      expect.objectContaining({ event: "tool.call.started" }),
      expect.objectContaining({
        event: "tool.call.completed",
        payload: expect.objectContaining({ output: "ok", toolCallId: "real-tool-id" }),
      }),
      expect.objectContaining({ event: "approval.requested" }),
      expect.objectContaining({
        event: "assistant.delta",
        payload: expect.objectContaining({ delta: "hello" }),
      }),
      expect.objectContaining({
        event: "assistant.delta",
        payload: expect.objectContaining({ delta: " world" }),
      }),
      expect.objectContaining({ event: "run.completed" }),
    ]));
    expect(beeperStreams.startMessage).toHaveBeenCalledTimes(1);
    expect(beeperStreams.publishPart.mock.calls.map(([options]) => options.part.type)).toEqual(expect.arrayContaining([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "REASONING_MESSAGE_CONTENT",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_RESULT",
      "TOOL_CALL_END",
      "CUSTOM",
      "TEXT_MESSAGE_CONTENT",
    ]));
    const toolOutput = beeperStreams.publishPart.mock.calls
      .map(([options]) => options.part)
      .find((part) => part.type === "TOOL_CALL_RESULT" && part.content === "ok");
    expect(toolOutput).toMatchObject({
      state: "complete",
      toolCallId: "real-tool-id",
      toolName: "read_file",
    });
    expect(beeperStreams.finalizeMessage).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$stream-root",
      roomId: "!room:example",
    }));
  });

  it("preserves supported dummybridge-style tool ids and avoids replaying duplicate text callbacks", async () => {
    const beeperStreams = {
      finalizeMessage: vi.fn(async () => ({
        eventId: "$stream-root",
        raw: {},
        replacementEventId: "$stream-final",
        roomId: "!room:example",
      })),
      publishPart: vi.fn(async () => undefined),
      startMessage: vi.fn(async () => ({
        descriptor: { type: "com.beeper.llm" },
        eventId: "$stream-root",
        roomId: "!room:example",
      })),
    };
    setBeeperChannelRuntime(new BeeperChannelRuntime({
      client: {
        beeper: { streams: beeperStreams },
        media: { upload: vi.fn() },
      } as never,
      userId: "@sh-openclaw-bot:example",
    }));
    const runAssembled = vi.fn(async (params: Record<string, unknown>) => {
      const replyOptions = params.replyOptions as Record<string, (payload?: unknown) => void | Promise<void>>;
      await replyOptions.onPartialReply?.({ text: "hel" });
      await replyOptions.onBlockReplyQueued?.({ text: "hel" });
      await replyOptions.onBlockReply?.({ text: "hello" });
      await replyOptions.onToolStart?.({ args: { path: "a.txt" }, name: "read_file", phase: "start", toolCallId: "tool-a" });
      await replyOptions.onToolStart?.({ args: { path: "b.txt" }, name: "read_file", phase: "start", toolCallId: "tool-b" });
      await replyOptions.onCommandOutput?.({ name: "read_file", output: "chunk-a", phase: "delta", status: "running", toolCallId: "tool-a" });
      await replyOptions.onCommandOutput?.({ name: "read_file", output: "done-a", phase: "end", status: "completed", toolCallId: "tool-a" });
      await replyOptions.onToolResult?.({ result: { ok: true }, toolCallId: "tool-b", toolName: "read_file" });
      const delivery = params.delivery as { deliver?: (payload: unknown, info?: unknown) => Promise<unknown> };
      await delivery.deliver?.({ text: "hello world" }, { kind: "final" });
      return { dispatchResult: { queuedFinal: true } };
    });
    const transport = createOpenClawHostTransport({
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
        session: { recordInboundSession: vi.fn(), resolveStorePath: () => "/tmp/sessions.json" },
        turn: {
          buildContext: (params: Record<string, unknown>) => ({
            Body: "from Beeper",
            BodyForAgent: "from Beeper",
            From: "beeper",
            RawBody: "from Beeper",
            SessionKey: (params.route as { routeSessionKey?: string }).routeSessionKey,
            To: "beeper",
          }),
          runAssembled,
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    });

    const done = (async () => {
      for await (const event of transport.events()) {
        if (event.event === "run.completed") break;
      }
    })();
    await transport.request("sessions.send", {
      key: "agent:main:beeper:room",
      message: "from Beeper",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
    });
    await done;

    const parts = beeperStreams.publishPart.mock.calls.map(([options]) => options.part);
    expect(parts.filter((part) => part.type === "TEXT_MESSAGE_CONTENT").map((part) => part.delta)).toEqual([
      "hel",
      "lo",
      " world",
    ]);
    expect(parts.filter((part) => part.type === "TOOL_CALL_START").map((part) => [part.toolCallId, part.toolName])).toEqual([
      ["tool-a", "read_file"],
      ["tool-b", "read_file"],
    ]);
    expect(parts.filter((part) => part.type === "TOOL_CALL_RESULT").map((part) => [part.toolCallId, part.content, part.state])).toEqual([
      ["tool-a", "chunk-a", "streaming"],
      ["tool-a", "done-a", "complete"],
    ]);
    expect(parts.filter((part) => part.type === "TOOL_CALL_END").map((part) => [part.toolCallId, part.toolName])).toEqual([
      ["tool-a", "read_file"],
      ["tool-b", "read_file"],
    ]);
  });

  it("streams assistant agent events when reply callbacks only deliver the final block", async () => {
    const beeperStreams = {
      finalizeMessage: vi.fn(async () => ({
        eventId: "$stream-root",
        raw: {},
        replacementEventId: "$stream-final",
        roomId: "!room:example",
      })),
      publishPart: vi.fn(async () => undefined),
      startMessage: vi.fn(async () => ({
        descriptor: { type: "com.beeper.llm" },
        eventId: "$stream-root",
        roomId: "!room:example",
      })),
    };
    setBeeperChannelRuntime(new BeeperChannelRuntime({
      client: {
        beeper: { streams: beeperStreams },
        media: { upload: vi.fn() },
      } as never,
      userId: "@sh-openclaw-bot:example",
    }));
    let agentEventListener: ((event: { data?: Record<string, unknown>; runId?: string; stream?: string }) => void) | undefined;
    const runAssembled = vi.fn(async (params: Record<string, unknown>) => {
      const replyOptions = params.replyOptions as { runId?: string };
      agentEventListener?.({ data: { delta: "hel", text: "hel" }, runId: replyOptions.runId, stream: "assistant" });
      agentEventListener?.({ data: { delta: "lo", text: "hello" }, runId: replyOptions.runId, stream: "assistant" });
      const delivery = params.delivery as { deliver?: (payload: unknown, info?: unknown) => Promise<unknown> };
      await delivery.deliver?.({ text: "hello world" }, { kind: "final" });
      return { dispatchResult: { queuedFinal: true } };
    });
    const transport = createOpenClawHostTransport({
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
        session: { recordInboundSession: vi.fn(), resolveStorePath: () => "/tmp/sessions.json" },
        turn: {
          buildContext: (params: Record<string, unknown>) => ({
            Body: "from Beeper",
            BodyForAgent: "from Beeper",
            From: "beeper",
            RawBody: "from Beeper",
            SessionKey: (params.route as { routeSessionKey?: string }).routeSessionKey,
            To: "beeper",
          }),
          runAssembled,
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
      events: {
        onAgentEvent: (listener) => {
          agentEventListener = listener;
          return () => {
            agentEventListener = undefined;
          };
        },
      },
    });

    const done = (async () => {
      for await (const event of transport.events()) {
        if (event.event === "run.completed") break;
      }
    })();
    await transport.request("sessions.send", {
      key: "agent:main:beeper:room",
      message: "from Beeper",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
    });
    await done;

    const parts = beeperStreams.publishPart.mock.calls.map(([options]) => options.part);
    expect(parts.filter((part) => part.type === "TEXT_MESSAGE_CONTENT").map((part) => part.delta)).toEqual([
      "hel",
      "lo",
      " world",
    ]);
  });

  it("loads plugin runtime history from the OpenClaw session transcript", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pickle-openclaw-history-"));
    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(sessionFile, [
      JSON.stringify({ message: { id: "u1", role: "user", content: [{ type: "text", text: "Hi" }] }, timestamp: 10 }),
      JSON.stringify({ message: { id: "a1", role: "assistant", content: [{ type: "text", text: "Hello" }] }, timestamp: 20 }),
    ].join("\n"));
    const transport = createOpenClawHostTransport({
      agent: {
        session: {
          getSessionEntry: () => ({
            sessionFile,
            sessionId: "session-1",
          }),
        },
      },
    });

    await expect(transport.request("chat.history", { limit: 2, sessionKey: "agent:main:beeper:room" })).resolves.toEqual({
      messages: [
        { content: "Hi", id: "u1", messageSeq: 1, role: "user", timestamp: 10 },
        { content: "Hello", id: "a1", messageSeq: 2, role: "agent", timestamp: 20 },
      ],
    });
  });

  it("adapts plugin transcript lifecycle updates into runtime events", async () => {
    let listener: ((update: { sessionKey?: string; messageSeq?: number }) => void) | undefined;
    const transport = createOpenClawHostTransport({
      events: {
        onSessionTranscriptUpdate: (next) => {
          listener = next;
          return () => {
            listener = undefined;
          };
        },
      },
    });

    const received: OpenClawGatewayEvent[] = [];
    const done = (async () => {
      for await (const event of transport.events((candidate) => candidate.payload !== undefined)) {
        received.push(event);
        break;
      }
    })();
    listener?.({ messageSeq: 9, sessionKey: "agent:main:dashboard:one" });
    await done;

    expect(received).toEqual([{
      event: "session.transcript.update",
      payload: { messageSeq: 9, sessionKey: "agent:main:dashboard:one" },
      seq: 9,
    }]);
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
