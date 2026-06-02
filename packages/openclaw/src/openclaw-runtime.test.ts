import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BeeperChannelRuntime, setBeeperChannelRuntimeForHost } from "./beeper-channel-runtime";
import { BeeperTurnStream } from "@beeper/pickle-bridge/beeper-stream";
import { createDefaultConfig } from "./config";
import {
  createOpenClawHostRuntimeAdapter,
  OpenClawPluginRuntimeAdapter,
  type OpenClawGatewayEvent,
  type OpenClawRuntimeRequestSurface,
} from "./openclaw-runtime";

describe("OpenClawPluginRuntimeAdapter", () => {
  it("lists OpenClaw agents as Matrix ghost contacts", async () => {
    const transport = fakeTransport({
      "agents.list": { agents: [{ description: "Code", id: "codex", name: "Codex" }] },
    });
    const runtime = new OpenClawPluginRuntimeAdapter({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw", homeserver: "https://matrix.example" }),
      transport,
    });

    await expect(runtime.listAgentContacts()).resolves.toEqual([
      {
        agentId: "codex",
        description: "Code",
        displayName: "Codex",
        ghostUserId: "@sh-openclaw_agent_codex:matrix.example",
      },
    ]);
    expect(transport.request).toHaveBeenCalledWith("agents.list", {});
  });

  it("creates sessions through OpenClaw RPC and rejects sends without a host channel runtime", async () => {
    const transport = fakeTransport({
      "sessions.create": { key: "agent:codex:main", sessionId: "session_1" },
    });
    const runtime = new OpenClawPluginRuntimeAdapter({
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
    await expect(runtime.sendMessage({ message: "hello", sessionKey: "agent:codex:main", timeoutMs: 1000 }))
      .rejects.toThrow("OpenClaw Beeper turns require OpenClaw channel inbound helpers");
  });

  it("patches session reasoning after create when Beeper needs rich reasoning events", async () => {
    const transport = fakeTransport({
      "sessions.create": { key: "agent:codex:main", sessionId: "session_1" },
      "sessions.patch": { ok: true },
    });
    const runtime = new OpenClawPluginRuntimeAdapter({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport,
    });

    await expect(runtime.createSession({ agentId: "codex", label: "Main", reasoningLevel: "on" })).resolves.toMatchObject({
      agentId: "codex",
      key: "agent:codex:main",
      label: "Main",
    });
    expect(transport.request).toHaveBeenCalledWith("sessions.create", {
      agentId: "codex",
      label: "Main",
    });
    expect(transport.request).toHaveBeenCalledWith("sessions.patch", {
      agentId: "codex",
      key: "agent:codex:main",
      reasoningLevel: "on",
    });
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
    const runtime = new OpenClawPluginRuntimeAdapter({
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
    const transport = createOpenClawHostRuntimeAdapter(host);

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

  it("sends host-backed Beeper turns through channel helpers", async () => {
    const aiRunStreams = createTestBeeperAIRunStreams();
    const request = vi.fn(async () => {
      throw new Error("generic request should not be used");
    });
    let resolveRun: (() => void) | undefined;
    const runDone = new Promise<void>((resolve) => {
      resolveRun = resolve;
    });
    const dispatchReply = vi.fn(async (params: Record<string, unknown>) => {
      const delivery = params.delivery as { deliver?: (payload: unknown, info?: unknown) => Promise<unknown> };
      await delivery.deliver?.("direct final", { kind: "final" });
      resolveRun?.();
    });
    const hostRuntime = {
      request,
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
        session: {
          recordInboundSession: vi.fn(),
          resolveStorePath: () => "/tmp/openclaw",
        },
        inbound: {
          buildContext: vi.fn((params) => params),
          dispatchReply,
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    };
    setBeeperChannelRuntimeForHost(hostRuntime, createTestBeeperChannelRuntime(aiRunStreams));
    const runtime = new OpenClawPluginRuntimeAdapter({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      transport: createOpenClawHostRuntimeAdapter(hostRuntime),
    });

    const sent = await runtime.sendMessage({
      idempotencyKey: "$event",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
      message: "hello",
      sessionKey: "agent:main:beeper:default:direct:!room:example",
    });

    expect(sent.runId).toMatch(/^beeper:/u);
    await runDone;
    expect(request).not.toHaveBeenCalled();
    expect(dispatchReply).toHaveBeenCalledTimes(1);
    expect(aiRunStreams.start).toHaveBeenCalledTimes(1);
    expect(aiRunStreams.finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: sent.runId,
    }));
    setBeeperChannelRuntimeForHost(hostRuntime, undefined);
  });

  it("adapts OpenClaw plugin runtime helpers when no gateway request surface exists", async () => {
    const transport = createOpenClawHostRuntimeAdapter({
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
    const transport = createOpenClawHostRuntimeAdapter({
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

    await expect(transport.sendMessage({
      sessionKey: "agent:main:beeper:room",
      message: "from Beeper",
      idempotencyKey: "$event",
    })).rejects.toThrow("OpenClaw Beeper requires OpenClaw channel inbound helpers");
  });

  it("runs Beeper-originated sends through OpenClaw channel inbound helpers for live AG-UI progress", async () => {
    const aiRunStreams = createTestBeeperAIRunStreams();
    const dispatchReply = vi.fn(async (params: Record<string, unknown>) => {
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
      await delivery.deliver?.({
        parts: [
          { content: "{\"status\":\"completed\",\"query\":\"docs\"}", type: "tool-call" },
          { content: "hello world", type: "text" },
        ],
      });
      return { dispatchResult: { queuedFinal: true } };
    });
    const hostRuntime = {
      channel: {
        reply: {
          dispatchReplyWithBufferedBlockDispatcher: vi.fn(),
        },
        session: {
          recordInboundSession: vi.fn(),
          resolveStorePath: () => "/tmp/sessions.json",
        },
        inbound: {
          buildContext: (params: Record<string, unknown>) => ({
            Body: "from Beeper",
            BodyForAgent: "from Beeper",
            From: "beeper",
            RawBody: "from Beeper",
            SessionKey: (params.route as { routeSessionKey?: string }).routeSessionKey,
            To: "beeper",
          }),
          dispatchReply,
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    };
    setBeeperChannelRuntimeForHost(hostRuntime, createTestBeeperChannelRuntime(aiRunStreams));
    const transport = createOpenClawHostRuntimeAdapter(hostRuntime);

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
    const sent = await transport.sendMessage({
      sessionKey: "agent:main:beeper:room",
      message: "from Beeper",
      idempotencyKey: "$event",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
    });
    observedRunId = (sent as { runId?: string }).runId;
    await done;

    expect(dispatchReply).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "beeper",
      agentId: "main",
      channel: "beeper",
      routeSessionKey: "agent:main:beeper:room",
    }));
    expect((dispatchReply.mock.calls[0]?.[0] as { replyOptions?: Record<string, unknown> } | undefined)?.replyOptions).toMatchObject({
      disableBlockStreaming: false,
      sourceReplyDeliveryMode: "automatic",
    });
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
    expect(aiRunStreams.start).toHaveBeenCalledTimes(1);
    const streamParts = startedAndAppendedParts(aiRunStreams);
    expect(streamParts.map((part) => part.kind)).toEqual(expect.arrayContaining([
      "reasoning",
      "tool_start",
      "tool_result",
      "text",
    ]));
    expect(aiRunStreams.appendEvent.mock.calls.map(([options]) => options.event.type)).toContain("CUSTOM");
    const toolOutput = streamParts.find((part) => part.kind === "tool_result" && part.output === "ok");
    expect(toolOutput).toMatchObject({
      toolCallId: "real-tool-id",
      toolName: "read_file",
    });
    expect(streamParts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "text", text: expect.stringContaining("\"status\":\"completed\"") }),
    ]));
    expect(aiRunStreams.finish).toHaveBeenCalledWith(expect.objectContaining({
      runId: observedRunId,
    }));
    setBeeperChannelRuntimeForHost(hostRuntime, undefined);
  });

  it("preserves supported dummybridge-style tool ids and avoids replaying duplicate text callbacks", async () => {
    const aiRunStreams = createTestBeeperAIRunStreams();
    const dispatchReply = vi.fn(async (params: Record<string, unknown>) => {
      const replyOptions = params.replyOptions as Record<string, (payload?: unknown) => void | Promise<void>>;
      await replyOptions.onPartialReply?.({ text: "hel" });
      await replyOptions.onBlockReplyQueued?.({ text: "hel" });
      await replyOptions.onBlockReply?.({ text: "hello" });
      await replyOptions.onToolStart?.({ args: { path: "a.txt" }, name: "read_file", phase: "start", toolCallId: "tool-a" });
      await replyOptions.onToolStart?.({ args: { path: "b.txt" }, name: "read_file", phase: "start", toolCallId: "tool-b" });
      await replyOptions.onCommandOutput?.({ name: "read_file", output: "chunk-a", phase: "delta", status: "running", toolCallId: "tool-a" });
      await replyOptions.onCommandOutput?.({ name: "read_file", output: "done-a", phase: "end", status: "completed", toolCallId: "tool-a" });
      await replyOptions.onToolStart?.({ args: { query: "docs" }, name: "web_search", phase: "start", toolCallId: "web-1" });
      await replyOptions.onCommandOutput?.({ name: "web_search", phase: "end", queries: ["docs"], query: "docs", status: "completed", toolCallId: "web-1" });
      await replyOptions.onToolStart?.({ args: { query: "blog" }, name: "web_search", phase: "start", toolCallId: "web-2" });
      await replyOptions.onToolResult?.({ output: { queries: ["blog"], query: "blog", state: "complete", status: "completed" }, toolCallId: "web-2", toolName: "web_search" });
      await replyOptions.onToolResult?.({ result: { ok: true }, toolCallId: "tool-b", toolName: "read_file" });
      const delivery = params.delivery as { deliver?: (payload: unknown, info?: unknown) => Promise<unknown> };
      await delivery.deliver?.({ text: "hello world https://example.com/final." }, { kind: "final" });
      return { dispatchResult: { queuedFinal: true } };
    });
    const hostRuntime = {
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
        session: { recordInboundSession: vi.fn(), resolveStorePath: () => "/tmp/sessions.json" },
        inbound: {
          buildContext: (params: Record<string, unknown>) => ({
            Body: "from Beeper",
            BodyForAgent: "from Beeper",
            From: "beeper",
            RawBody: "from Beeper",
            SessionKey: (params.route as { routeSessionKey?: string }).routeSessionKey,
            To: "beeper",
          }),
          dispatchReply,
        },
      },
      config: { current: () => ({ agents: { list: [{ id: "main" }] } }) },
    };
    setBeeperChannelRuntimeForHost(hostRuntime, createTestBeeperChannelRuntime(aiRunStreams));
    const transport = createOpenClawHostRuntimeAdapter(hostRuntime);

    const done = (async () => {
      for await (const event of transport.events()) {
        if (event.event === "run.completed") break;
      }
    })();
    await transport.sendMessage({
      sessionKey: "agent:main:beeper:room",
      message: "from Beeper",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
    });
    await done;

    const parts = startedAndAppendedParts(aiRunStreams);
    expect(parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual([
      "hel",
      "lo",
      " world https://example.com/final.",
    ]);
    expect(parts.filter((part) => part.kind === "tool_start").map((part) => [part.toolCallId, part.toolName])).toEqual([
      ["tool-a", "read_file"],
      ["tool-b", "read_file"],
      ["web-1", "web_search"],
      ["web-2", "web_search"],
    ]);
    expect(parts.filter((part) => part.kind === "tool_result").map((part) => [part.toolCallId, part.output, part.preliminary])).toEqual([
      ["tool-a", "chunk-a", true],
      ["tool-a", "done-a", false],
      ["tool-b", { ok: true }, undefined],
    ]);
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "custom", name: "com.beeper.source", value: expect.objectContaining({ sourceId: "https://example.com/final", title: "example.com", url: "https://example.com/final" }) }),
    ]));
    expect(parts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ output: expect.objectContaining({ query: "docs" }), toolCallId: "web-1", kind: "tool_result" }),
      expect.objectContaining({ output: expect.objectContaining({ query: "blog" }), toolCallId: "web-2", kind: "tool_result" }),
    ]));
    setBeeperChannelRuntimeForHost(hostRuntime, undefined);
  });

  it("streams assistant agent events when reply callbacks only deliver the final block", async () => {
    const aiRunStreams = createTestBeeperAIRunStreams();
    let agentEventListener: ((event: { data?: Record<string, unknown>; runId?: string; sessionKey?: string; stream?: string }) => void) | undefined;
    const dispatchReply = vi.fn(async (params: Record<string, unknown>) => {
      const replyOptions = params.replyOptions as { runId?: string };
      const sessionKey = params.routeSessionKey as string;
      agentEventListener?.({ data: { text: "Working..." }, runId: replyOptions.runId, stream: "assistant" });
      agentEventListener?.({ data: { name: "search", phase: "running", text: "Searching docs", type: "tool.progress" }, runId: replyOptions.runId, stream: "tool.progress" });
      agentEventListener?.({ data: { delta: "hel", text: "hel" }, runId: replyOptions.runId, stream: "assistant" });
      agentEventListener?.({ data: { delta: "lo", text: "hello" }, sessionKey, stream: "assistant" });
      agentEventListener?.({ data: { itemId: "user-message", phase: "start", type: "userMessage" }, runId: replyOptions.runId, stream: "codex_app_server.item" });
      agentEventListener?.({ data: { itemId: "agent-message", phase: "start", type: "agentMessage" }, runId: replyOptions.runId, stream: "codex_app_server.item" });
      agentEventListener?.({ data: { itemId: "codex-tool", phase: "start", type: "tool_call" }, runId: replyOptions.runId, stream: "codex_app_server.item" });
      agentEventListener?.({ data: { itemId: "tool-c", phase: "update", kind: "tool", progressText: "loading", status: "running", name: "search" }, runId: replyOptions.runId, stream: "item" });
      agentEventListener?.({ data: { itemId: "codex-tool", phase: "finished", type: "tool_call" }, runId: replyOptions.runId, stream: "codex_app_server.item" });
      agentEventListener?.({ data: { args: { query: "docs" }, name: "search", phase: "start", toolCallId: "tool-stream" }, runId: replyOptions.runId, stream: "tool" });
      agentEventListener?.({ data: { name: "search", phase: "result", result: "found docs", toolCallId: "tool-stream" }, runId: replyOptions.runId, stream: "tool" });
      agentEventListener?.({
        data: {
          metadata: { source: "codex" },
          description: "Searches OpenClaw docs",
          phase: "start",
          providerExecuted: true,
          startedAtMs: 123,
          title: "Search docs",
          toolCall: { arguments: "{\"query\":\"openclaw\"}", id: "nested-tool", name: "search" },
        },
        runId: replyOptions.runId,
        stream: "tool",
      });
      agentEventListener?.({
        data: {
          call: { id: "nested-tool", name: "search" },
          completedAtMs: 456,
          phase: "result",
          providerExecuted: true,
          result: { items: [{ title: "OpenClaw", url: "https://example.com/openclaw" }] },
        },
        runId: replyOptions.runId,
        stream: "tool",
      });
      agentEventListener?.({ data: { name: "bash", phase: "start", toolCallId: "delta-tool" }, runId: replyOptions.runId, stream: "tool" });
      agentEventListener?.({ data: { delta: "{\"cmd\":\"pwd\"}", name: "bash", phase: "input_delta", toolCallId: "delta-tool" }, runId: replyOptions.runId, stream: "tool" });
      agentEventListener?.({ data: { name: "bash", output: "/tmp/project", phase: "finished", toolCallId: "delta-tool" }, runId: replyOptions.runId, stream: "tool" });
      agentEventListener?.({
        data: {
          name: "bash",
          phase: "finished",
          response: "tool wrapper response",
          result: {
            content: "wrapper content",
            details: {
              aggregated: "stdout\nstderr",
              command: "npm test",
              cwd: "/tmp/project",
              durationMs: 25,
              exitCode: 0,
              status: "completed",
              stderr: "stderr",
              stdout: "stdout",
            },
          },
          title: "Run tests",
          toolCallId: "bash-rich",
        },
        runId: replyOptions.runId,
        stream: "tool",
      });
      agentEventListener?.({ data: { phase: "update", title: "Plan", explanation: "checking docs", steps: ["Search", "Answer"] }, runId: replyOptions.runId, stream: "plan" });
      agentEventListener?.({ data: { itemId: "cmd-1", phase: "delta", title: "Shell", toolCallId: "cmd-1", name: "shell", output: "stdout" }, runId: replyOptions.runId, stream: "command_output" });
      agentEventListener?.({
        data: {
          input: {
            command: "/bin/zsh -lc \"date '+%Y-%m-%d %H:%M:%S %Z'\"",
            cwd: "/Users/batuhan/.openclaw/workspace",
          },
          name: "bash",
          output: { status: "completed" },
          phase: "finished",
          response: "2026-06-02 03:15:00 CEST",
          status: "completed",
          toolCallId: "cmd-date",
        },
        runId: replyOptions.runId,
        stream: "command_output",
      });
      agentEventListener?.({ data: { itemId: "patch-1", phase: "end", title: "Patch", toolCallId: "patch-1", name: "patch", added: [], modified: ["a.ts"], deleted: [], summary: "changed a.ts" }, runId: replyOptions.runId, stream: "patch" });
      agentEventListener?.({ data: { items: [{ title: "Docs", url: "https://example.com" }] }, runId: replyOptions.runId, stream: "source" });
      agentEventListener?.({ data: { filename: "report.txt", id: "file_1" }, runId: replyOptions.runId, stream: "file" });
      agentEventListener?.({ data: { status: "indexed" }, runId: replyOptions.runId, stream: "data" });
      agentEventListener?.({ data: { phase: "retrieval" }, runId: replyOptions.runId, stream: "snapshot" });
      const delivery = params.delivery as { deliver?: (payload: unknown, info?: unknown) => Promise<unknown> };
      await delivery.deliver?.({ text: "hello world" }, { kind: "final" });
      return { dispatchResult: { queuedFinal: true } };
    });
    const hostRuntime = {
      channel: {
        reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
        session: { recordInboundSession: vi.fn(), resolveStorePath: () => "/tmp/sessions.json" },
        inbound: {
          buildContext: (params: Record<string, unknown>) => ({
            Body: "from Beeper",
            BodyForAgent: "from Beeper",
            From: "beeper",
            RawBody: "from Beeper",
            SessionKey: (params.route as { routeSessionKey?: string }).routeSessionKey,
            To: "beeper",
          }),
          dispatchReply,
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
    };
    setBeeperChannelRuntimeForHost(hostRuntime, createTestBeeperChannelRuntime(aiRunStreams));
    const transport = createOpenClawHostRuntimeAdapter(hostRuntime);

    const done = (async () => {
      for await (const event of transport.events()) {
        if (event.event === "run.completed") break;
      }
    })();
    await transport.sendMessage({
      sessionKey: "agent:main:beeper:room",
      message: "from Beeper",
      matrix: { roomId: "!room:example", sender: "@alice:example" },
    });
    await done;

    const parts = startedAndAppendedParts(aiRunStreams);
    expect(parts.filter((part) => part.kind === "text").map((part) => part.text)).toEqual([
      "hel",
      "lo",
      " world",
    ]);
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "tool_result", toolCallId: "codex-tool", toolName: "tool" }),
      expect.objectContaining({ activityType: "tool.progress", content: expect.objectContaining({ label: "search", phase: "running", text: "Searching docs" }), kind: "activity" }),
      expect.objectContaining({ kind: "tool_start", toolCallId: "tool-stream", toolName: "search" }),
      expect.objectContaining({ input: { query: "openclaw" }, kind: "tool_start", metadata: { description: "Searches OpenClaw docs", displayName: "Search docs", source: "codex" }, providerExecuted: true, startedAtMs: 123, title: "Search docs", toolCallId: "nested-tool", toolName: "search" }),
      expect.objectContaining({ completedAtMs: 456, kind: "tool_result", output: { items: [{ title: "OpenClaw", url: "https://example.com/openclaw" }] }, providerExecuted: true, toolCallId: "nested-tool", toolName: "search" }),
      expect.objectContaining({ kind: "custom", name: "com.beeper.source", value: expect.objectContaining({ sourceId: "https://example.com/openclaw", title: "OpenClaw", url: "https://example.com/openclaw" }) }),
      expect.objectContaining({ delta: "{\"cmd\":\"pwd\"}", kind: "tool_input", toolCallId: "delta-tool" }),
      expect.objectContaining({ kind: "tool_result", output: "/tmp/project", toolCallId: "delta-tool", toolName: "bash" }),
      expect.objectContaining({
        command: "npm test",
        details: {
          aggregated: "stdout\nstderr",
          command: "npm test",
          cwd: "/tmp/project",
          durationMs: 25,
          exitCode: 0,
          status: "completed",
          stderr: "stderr",
          stdout: "stdout",
        },
        exitCode: 0,
        kind: "tool_result",
        metadata: { displayName: "Run tests" },
        output: {
          content: "wrapper content",
          details: {
            aggregated: "stdout\nstderr",
            command: "npm test",
            cwd: "/tmp/project",
            durationMs: 25,
            exitCode: 0,
            status: "completed",
            stderr: "stderr",
            stdout: "stdout",
          },
        },
        response: "tool wrapper response",
        result: {
          content: "wrapper content",
          details: {
            aggregated: "stdout\nstderr",
            command: "npm test",
            cwd: "/tmp/project",
            durationMs: 25,
            exitCode: 0,
            status: "completed",
            stderr: "stderr",
            stdout: "stdout",
          },
        },
        status: "completed",
        title: "Run tests",
        toolCallId: "bash-rich",
        toolName: "bash",
      }),
      expect.objectContaining({ kind: "tool_result", output: "loading", preliminary: true, toolCallId: "tool-c", toolName: "search" }),
      expect.objectContaining({ kind: "tool_result", output: "checking docs", preliminary: true, toolCallId: "plan", toolName: "plan" }),
      expect.objectContaining({ kind: "tool_result", output: "stdout", preliminary: true, toolCallId: "cmd-1", toolName: "shell" }),
      expect.objectContaining({
        input: {
          command: "/bin/zsh -lc \"date '+%Y-%m-%d %H:%M:%S %Z'\"",
          cwd: "/Users/batuhan/.openclaw/workspace",
        },
        kind: "tool_result",
        command: "/bin/zsh -lc \"date '+%Y-%m-%d %H:%M:%S %Z'\"",
        cwd: "/Users/batuhan/.openclaw/workspace",
        output: { status: "completed" },
        response: "2026-06-02 03:15:00 CEST",
        status: "completed",
        toolCallId: "cmd-date",
        toolName: "bash",
      }),
      expect.objectContaining({ kind: "tool_result", output: "changed a.ts", toolCallId: "patch-1", toolName: "patch" }),
      expect.objectContaining({ kind: "custom", name: "com.beeper.source", value: expect.objectContaining({ sourceId: "https://example.com", title: "Docs", url: "https://example.com" }) }),
      expect.objectContaining({ kind: "custom", name: "com.beeper.file", value: { id: "file_1", title: "report.txt" } }),
      expect.objectContaining({ kind: "custom", name: "com.beeper.data", value: { name: "openclaw.data", value: { status: "indexed" } } }),
      expect.objectContaining({ kind: "state_snapshot", value: { phase: "retrieval" } }),
    ]));
    expect(parts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ content: { state: "running", text: "Working..." }, kind: "activity" }),
      expect.objectContaining({ toolCallId: "user-message", kind: "tool_start" }),
      expect.objectContaining({ toolCallId: "agent-message", kind: "tool_start" }),
    ]));
    const indexOf = (match: (part: Record<string, unknown>) => boolean) => parts.findIndex((part) => match(part as Record<string, unknown>));
    expect(aiRunStreams.start.mock.invocationCallOrder[0]).toBeLessThan(aiRunStreams.appendPart.mock.invocationCallOrder[0]);
    expect(indexOf((part) => part.kind === "tool_start" && part.toolCallId === "delta-tool")).toBeLessThan(indexOf((part) => part.kind === "tool_input" && part.toolCallId === "delta-tool"));
    expect(indexOf((part) => part.kind === "tool_input" && part.toolCallId === "delta-tool")).toBeLessThan(indexOf((part) => part.kind === "tool_result" && part.toolCallId === "delta-tool"));
    expect(indexOf((part) => part.kind === "tool_result" && part.toolCallId === "nested-tool")).toBeLessThan(indexOf((part) => part.kind === "custom" && part.name === "com.beeper.source" && (part.value as { sourceId?: string })?.sourceId === "https://example.com/openclaw"));
    setBeeperChannelRuntimeForHost(hostRuntime, undefined);
  });

  it("loads plugin runtime history from the OpenClaw session transcript", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "pickle-openclaw-history-"));
    const sessionFile = path.join(tmpDir, "session.jsonl");
    await fs.writeFile(sessionFile, [
      JSON.stringify({ message: { id: "u1", role: "user", content: [{ type: "text", text: "Hi" }] }, timestamp: 10 }),
      JSON.stringify({ message: { id: "a1", role: "assistant", content: [{ type: "text", text: "Hello" }] }, timestamp: 20 }),
    ].join("\n"));
    const transport = createOpenClawHostRuntimeAdapter({
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
    const transport = createOpenClawHostRuntimeAdapter({
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

function fakeTransport(responses: Record<string, unknown>, events: OpenClawGatewayEvent[] = []): OpenClawRuntimeRequestSurface & {
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

function createTestBeeperAIRuns() {
  const snapshot = (runId: string, events: Record<string, unknown>[] = []) => ({
    body: "...",
    events,
    finalAIMessage: {},
    initialAIMessage: {},
    metadata: {},
    messageId: runId,
    runId,
    threadId: runId,
  });
  return {
    appendEvent: vi.fn(async ({ event, runId }: { event: Record<string, unknown>; runId: string }) =>
      snapshot(runId, [event])),
    begin: vi.fn(async ({ runId, threadId }: { runId: string; threadId?: string }) =>
      snapshot(runId, [
        { runId, threadId: threadId ?? runId, type: "RUN_STARTED" },
        { messageId: runId, role: "assistant", type: "TEXT_MESSAGE_START" },
      ])),
    delete: vi.fn(async () => undefined),
    error: vi.fn(async ({ message, runId }: { message?: string; runId: string }) =>
      snapshot(runId, [{ message, runId, type: "RUN_ERROR" }])),
    finish: vi.fn(async ({ finishReason, runId }: { finishReason?: string; runId: string }) =>
      snapshot(runId, [
        { messageId: runId, type: "TEXT_MESSAGE_END" },
        { finishReason: finishReason ?? "stop", runId, threadId: runId, type: "RUN_FINISHED" },
      ])),
  };
}

function createTestBeeperAIRunStreams() {
  const result = (runId: string, events: Record<string, unknown>[] = []) => ({
    body: "...",
    descriptor: { type: "com.beeper.llm" },
    eventId: "$stream-root",
    events,
    finalAIMessage: {},
    initialAIMessage: {},
    messageId: `msg-${runId}`,
    metadata: {},
    raw: {},
    replacementEventId: "$stream-final",
    roomId: "!room:example",
    runId,
    threadId: runId,
  });
  return {
    appendEvent: vi.fn(async ({ event, runId }: { event: Record<string, unknown>; runId: string }) =>
      result(runId, [event])),
    appendPart: vi.fn(async ({ runId }: { runId: string }) =>
      result(runId)),
    error: vi.fn(async ({ message, runId }: { message?: string; runId: string }) =>
      result(runId, [{ message, runId, type: "RUN_ERROR" }])),
    finish: vi.fn(async ({ finishReason, runId }: { finishReason?: string; runId: string }) =>
      result(runId, [{ finishReason: finishReason ?? "stop", runId, threadId: runId, type: "RUN_FINISHED" }])),
    start: vi.fn(async ({ runId }: { runId: string }) =>
      result(runId, [
        { runId, threadId: runId, type: "RUN_STARTED" },
        { messageId: `msg-${runId}`, role: "assistant", type: "TEXT_MESSAGE_START" },
      ])),
  };
}

function createTestBeeperChannelRuntime(aiRunStreams: ReturnType<typeof createTestBeeperAIRunStreams>) {
  const bridge = {
    createBeeperTurnStream: vi.fn((options) => new BeeperTurnStream({
      ...options,
      client: {
        beeper: {
          aiRuns: createTestBeeperAIRuns(),
          aiRunStreams,
        },
      } as never,
    })),
    flushRemoteEvents: vi.fn(async () => undefined),
    getPortalByMXID: vi.fn(() => ({ portalKey: { id: "session:one", receiver: "openclaw:plugin" } })),
    queueRemoteEvent: vi.fn(),
  };
  return new BeeperChannelRuntime({
    bridge: bridge as never,
    getAgents: () => [{
      agentId: "main",
      displayName: "Main",
      ghostUserId: "@sh-openclaw_agent_main:example",
    }],
    getBindingByRoom: (roomId) => roomId === "!room:example"
      ? {
          agentId: "main",
          createdAt: 1,
          ghostUserId: "@sh-openclaw_agent_main:example",
          id: "binding",
          kind: "session",
          owner: "bridge",
          roomId,
          sessionKey: "agent:main:beeper:room",
          updatedAt: 1,
        }
      : undefined,
    getBindingBySessionKey: (sessionKey) => sessionKey === "agent:main:beeper:room"
      ? {
          agentId: "main",
          createdAt: 1,
          ghostUserId: "@sh-openclaw_agent_main:example",
          id: "binding",
          kind: "session",
          owner: "bridge",
          roomId: "!room:example",
          sessionKey,
          updatedAt: 1,
        }
      : undefined,
    login: { id: "openclaw:plugin" },
    userId: "@sh-openclaw-bot:example",
  });
}

function startedAndAppendedParts(aiRunStreams: ReturnType<typeof createTestBeeperAIRunStreams>) {
  const startOptions = aiRunStreams.start.mock.calls[0]?.[0] as { initialParts?: Array<Record<string, unknown>> } | undefined;
  return [
    ...(startOptions?.initialParts ?? []),
    ...aiRunStreams.appendPart.mock.calls.map(([options]) => options),
  ];
}
