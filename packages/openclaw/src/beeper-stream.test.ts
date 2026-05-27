import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { BeeperTurnStreamCoordinator } from "./beeper-stream";

describe("OpenClaw Beeper native stream publisher", () => {
  it("starts one native Beeper stream, publishes AG-UI events, and finalizes replacement content", async () => {
    const { client, finalizeMessage, publishPart, startMessage } = createClient();
    const publisher = new BeeperTurnStreamCoordinator({
      client,
      initialMessageMetadata: { agent_id: "codex" },
      roomId: "!room:example.com",
      turnId: "turn_1",
      userId: "@openclaw_agent_codex:example.com",
    });

    await publisher.publish({ messageId: "turn_1", role: "assistant", type: "TEXT_MESSAGE_START" });
    await publisher.publish({ delta: "hello", messageId: "turn_1", type: "TEXT_MESSAGE_CONTENT" });
    await publisher.finalize();

    expect(startMessage).toHaveBeenCalledWith({
      content: {
        body: "...",
        "com.beeper.ai": {
          id: "turn_1",
          metadata: { agent_id: "codex", turn_id: "turn_1" },
          parts: [],
          role: "assistant",
        },
        "com.beeper.ai.metadata": expect.objectContaining({
          data: { agent_id: "codex" },
          model: "openclaw/plugin",
          protocol: "ag-ui",
          runId: "turn_1",
          schema: "com.beeper.ai.run.v1",
          status: { state: "streaming" },
          threadId: "turn_1",
        }),
        "com.beeper.stream": {
          type: "com.beeper.llm.deltas",
        },
        msgtype: "m.text",
      },
      roomId: "!room:example.com",
      streamType: "com.beeper.llm",
      userId: "@openclaw_agent_codex:example.com",
    });
    expect(publishPart.mock.calls.map(([options]) => options.part.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    expect(finalizeMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "hello",
      content: expect.objectContaining({
        "com.beeper.ai": expect.objectContaining({
          parts: [{ content: "hello", state: "done", type: "text" }],
        }),
        "com.beeper.ai.metadata": expect.objectContaining({
          protocol: "ag-ui",
          runId: "turn_1",
          schema: "com.beeper.ai.run.v1",
          status: expect.objectContaining({
            finishReason: "stop",
            state: "complete",
          }),
        }),
        "com.beeper.stream": {
          type: "com.beeper.llm.deltas",
        },
        body: "hello",
        msgtype: "m.text",
      }),
      eventId: "$target",
      roomId: "!room:example.com",
    }));
  });

  it("always finalizes with a replacement edit that suppresses the streamed event", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperTurnStreamCoordinator({
      client,
      roomId: "!room:example.com",
      turnId: "turn_replace",
      userId: "@bot:example.com",
    });

    await publisher.publish({ delta: "replace me", messageId: "turn_replace", type: "TEXT_MESSAGE_CONTENT" });
    const result = await publisher.finalize({
      terminalPart: { finishReason: "stop", runId: "turn_replace", threadId: "turn_replace", type: "RUN_FINISHED" },
    });

    expect(result).toEqual(expect.objectContaining({ eventId: "$target" }));
    expect(finalizeMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "replace me",
      eventId: "$target",
      roomId: "!room:example.com",
      topLevelContent: { "com.beeper.dont_render_edited": true },
      userId: "@bot:example.com",
    }));
  });

  it("finalizes run errors with a readable fallback body", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperTurnStreamCoordinator({
      client,
      roomId: "!room:example.com",
      turnId: "turn_error",
    });

    await publisher.finalize({
      terminalPart: {
        error: "tool exploded",
        message: "Tool exploded",
        runId: "turn_error",
        type: "RUN_ERROR",
      },
    });

    expect(finalizeMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "Tool exploded",
      content: expect.objectContaining({
        body: "Tool exploded",
      }),
    }));
  });

  it("preserves cancelled runs as abort terminal metadata", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperTurnStreamCoordinator({
      client,
      roomId: "!room:example.com",
      turnId: "turn_abort",
    });

    await publisher.finalize({
      body: "cancelled",
      terminalPart: {
        message: "user stopped it",
        reason: "user stopped it",
        runId: "turn_abort",
        terminalType: "abort",
        type: "RUN_ERROR",
      } as never,
    });

    const aiMessage = finalizeMessage.mock.calls[0]?.[0].content["com.beeper.ai"];
    expect(aiMessage.metadata.beeper_terminal_state).toEqual({
      reason: "user stopped it",
      type: "abort",
    });
  });

  it("accumulates reasoning, tool calls, and approval parts into final Beeper AI content", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperTurnStreamCoordinator({
      client,
      roomId: "!room:example.com",
      turnId: "turn_rich",
    });

    await publisher.publishMany([
      { messageId: "reasoning", type: "REASONING_MESSAGE_START" },
      { delta: "thinking", messageId: "reasoning", type: "REASONING_MESSAGE_CONTENT" },
      { messageId: "reasoning", type: "REASONING_MESSAGE_END" },
      { toolCallId: "tool_1", toolName: "shell", type: "TOOL_CALL_START" },
      { delta: "{\"cmd\":\"date\"}", toolCallId: "tool_1", type: "TOOL_CALL_ARGS" },
      { args: "{\"cmd\":\"date\"}", toolCallId: "tool_1", toolName: "shell", type: "TOOL_CALL_END" },
      { content: "ok", state: "done", toolCallId: "tool_1", toolName: "shell", type: "TOOL_CALL_RESULT" },
      {
        name: "approval-requested",
        type: "CUSTOM",
        value: {
          approval: { id: "approval_1" },
          message: "Run shell?",
          toolCallId: "tool_1",
          toolName: "shell",
        },
      },
      {
        name: "approval-responded",
        type: "CUSTOM",
        value: {
          approval: { approved: true, approvedAlways: true, id: "approval_1" },
          toolCallId: "tool_1",
        },
      },
      { delta: "done", messageId: "turn_rich", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    await publisher.finalize({ terminalPart: { finishReason: "stop", runId: "turn_rich", type: "RUN_FINISHED" } });

    const aiMessage = finalizeMessage.mock.calls[0]?.[0].content["com.beeper.ai"];
    expect(aiMessage.parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "thinking", type: "reasoning" }),
      expect.objectContaining({
        approval: { approved: true, id: "approval_1" },
        arguments: "{\"cmd\":\"date\"}",
        id: "tool_1",
        input: { cmd: "date" },
        name: "shell",
        output: "ok",
        state: "approval-responded",
        toolCallId: "tool_1",
        type: "tool-call",
      }),
      expect.objectContaining({ content: "done", type: "text" }),
    ]));
  });
});

function createClient() {
  const runEvents = new Map<string, Record<string, unknown>[]>();
  const snapshot = (runId: string, events: Record<string, unknown>[] = [], body = "...") => ({
    body,
    events,
    finalAIMessage: {},
    initialAIMessage: {
      id: runId,
      metadata: { turn_id: runId },
      parts: [],
      role: "assistant",
    },
    metadata: {
      messageId: runId,
      model: "openclaw/plugin",
      protocol: "ag-ui",
      runId,
      schema: "com.beeper.ai.run.v1",
      status: { state: "streaming" },
      threadId: runId,
    },
    messageId: runId,
    runId,
    threadId: runId,
  });
  const begin = vi.fn(async (options: { runId?: string }) => {
    const runId = options.runId ?? "run";
    const events = [
      { runId, threadId: runId, type: "RUN_STARTED" },
      { messageId: runId, role: "assistant", type: "TEXT_MESSAGE_START" },
    ];
    runEvents.set(runId, events);
    return snapshot(runId, events);
  });
  const appendEvent = vi.fn(async (options: { event: Record<string, unknown>; runId: string }) => {
    const events = runEvents.get(options.runId) ?? [];
    events.push(options.event);
    runEvents.set(options.runId, events);
    return snapshot(options.runId, [options.event], textFromEvents(events));
  });
  const finish = vi.fn(async (options: { finishReason?: string; runId: string }) => {
    const terminal = {
      finishReason: options.finishReason ?? "stop",
      runId: options.runId,
      threadId: options.runId,
      type: "RUN_FINISHED",
    };
    const events = runEvents.get(options.runId) ?? [];
    events.push(terminal);
    runEvents.set(options.runId, events);
    return snapshot(options.runId, [terminal], textFromEvents(events));
  });
  const error = vi.fn(async (options: { message?: string; runId: string; type?: "error" | "abort" }) => {
    const terminal = {
      message: options.message ?? "Run failed",
      reason: options.message,
      runId: options.runId,
      terminalType: options.type === "abort" ? "abort" : undefined,
      type: "RUN_ERROR",
    };
    const events = runEvents.get(options.runId) ?? [];
    events.push(terminal);
    runEvents.set(options.runId, events);
    return snapshot(options.runId, [terminal], options.message ?? "Run failed");
  });
  const deleteRun = vi.fn(async () => undefined);
  const startMessage = vi.fn(async () => ({
    descriptor: { device_id: "DEVICE", type: "com.beeper.llm", user_id: "@bot:example.com" },
    eventId: "$target",
    roomId: "!room:example.com",
  }));
  const publishPart = vi.fn(async () => undefined);
  const finalizeMessage = vi.fn(async () => ({
    eventId: "$target",
    raw: {},
    replacementEventId: "$edit",
    roomId: "!room:example.com",
  }));
  const client = {
    beeper: {
      aiRuns: {
        appendEvent,
        begin,
        delete: deleteRun,
        error,
        finish,
      },
      streams: {
        finalizeMessage,
        publishPart,
        startMessage,
      },
    },
  } as unknown as MatrixClient;
  return { client, finalizeMessage, publishPart, startMessage };
}

function textFromEvents(events: Record<string, unknown>[]): string {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => (typeof event.delta === "string" ? event.delta : ""))
    .join("") || "...";
}
