import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { BeeperTurnStream, runBeeperTurnStream } from "./beeper-stream";

describe("Beeper AI turn stream publisher", () => {
  it("starts one ai-bridge backed stream and appends canonical AG-UI events", async () => {
    const { appendEvent, client, finish, start } = createClient();
    const publisher = new BeeperTurnStream({
      agentId: "codex",
      agentName: "Codex",
      client,
      initialMessageMetadata: { agent_id: "codex" },
      model: "openclaw/plugin",
      roomId: "!room:example.com",
      turnId: "turn_1",
      userId: "@sh-openclaw_agent_codex:example.com",
    });

    await publisher.publish({ messageId: "provider-msg", role: "assistant", type: "TEXT_MESSAGE_START" });
    await publisher.publish({ delta: "hello", messageId: "provider-msg", type: "TEXT_MESSAGE_CONTENT" });
    const result = await publisher.finalize();

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith({
      agentId: "codex",
      agentName: "Codex",
      data: { agent_id: "codex" },
      model: "openclaw/plugin",
      roomId: "!room:example.com",
      runId: "turn_1",
      streamType: "com.beeper.llm",
      threadId: "turn_1",
      userId: "@sh-openclaw_agent_codex:example.com",
    });
    expect(appendEvent.mock.calls.map(([options]) => options.event)).toEqual([
      { messageId: "msg-turn_1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "hello", messageId: "msg-turn_1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({
      finishReason: "stop",
      runId: "turn_1",
      terminal: expect.objectContaining({ type: "RUN_FINISHED" }),
    }));
    expect(result).toEqual({
      eventId: "$target",
      raw: { logicalEventId: "$target", raw: {}, replacementEventId: "$edit" },
      roomId: "!room:example.com",
    });
  });

  it("does not promote provider message ids into additional Matrix stream messages", async () => {
    const { appendEvent, client, finish, start } = createClient();
    const publisher = new BeeperTurnStream({
      client,
      roomId: "!room:example.com",
      turnId: "turn_multi",
    });

    await publisher.publishMany([
      { messageId: "answer_1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "first", messageId: "answer_1", type: "TEXT_MESSAGE_CONTENT" },
      { messageId: "answer_2", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "second", messageId: "answer_2", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    await publisher.finalize();

    expect(start).toHaveBeenCalledTimes(1);
    expect(appendEvent.mock.calls.map(([options]) => [options.event.type, options.event.messageId, options.event.delta])).toEqual([
      ["TEXT_MESSAGE_START", "msg-turn_multi", undefined],
      ["TEXT_MESSAGE_CONTENT", "msg-turn_multi", "first"],
      ["TEXT_MESSAGE_START", "msg-turn_multi", undefined],
      ["TEXT_MESSAGE_CONTENT", "msg-turn_multi", "second"],
    ]);
    expect(finish).toHaveBeenCalledTimes(1);
  });

  it("keeps tool result message ids separate from the assistant message", async () => {
    const { appendEvent, client } = createClient();
    const publisher = new BeeperTurnStream({
      client,
      roomId: "!room:example.com",
      turnId: "turn_tool",
    });

    await publisher.publish({
      content: "{\"ok\":true}",
      messageId: "tool_1",
      role: "tool",
      state: "complete",
      toolCallId: "tool_1",
      type: "TOOL_CALL_RESULT",
    });

    expect(appendEvent.mock.calls.map(([options]) => options.event)).toEqual([
      {
        content: "{\"ok\":true}",
        messageId: "tool_1",
        role: "tool",
        state: "complete",
        toolCallId: "tool_1",
        type: "TOOL_CALL_RESULT",
      },
    ]);
  });

  it("finalizes run errors through the native stream", async () => {
    const { client, error } = createClient();
    const publisher = new BeeperTurnStream({
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

    expect(error).toHaveBeenCalledWith({
      message: "Tool exploded",
      runId: "turn_error",
      terminal: expect.objectContaining({ message: "Tool exploded", type: "RUN_ERROR" }),
      type: "error",
    });
  });

  it("starts with subscribers, thread root, and ghost sender when provided", async () => {
    const { client, start } = createClient();
    const publisher = new BeeperTurnStream({
      client,
      roomId: "!room:example.com",
      subscribers: [{ deviceId: "DEVICE", userId: "@alice:example.com" }],
      threadRoot: "$root",
      turnId: "turn_subscribed",
      userId: "@agent:example.com",
    });

    await publisher.start();

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      subscribers: [{ deviceId: "DEVICE", userId: "@alice:example.com" }],
      threadRootEventId: "$root",
      userId: "@agent:example.com",
    }));
  });

  it("runs mapped provider events through one finalized turn stream", async () => {
    const { appendEvent, client, finish } = createClient();
    const publisher = new BeeperTurnStream({
      client,
      roomId: "!room:example.com",
      turnId: "turn_runner",
    });

    await expect(runBeeperTurnStream({
      events: ["a", "b"],
      mapEvent: (delta) => ({ delta, type: "TEXT_MESSAGE_CONTENT" }),
      stream: publisher,
    })).resolves.toMatchObject({ eventId: "$target" });

    expect(appendEvent.mock.calls.map(([options]) => options.event)).toEqual([
      { delta: "a", messageId: "msg-turn_runner", type: "TEXT_MESSAGE_CONTENT" },
      { delta: "b", messageId: "msg-turn_runner", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(finish).toHaveBeenCalledOnce();
  });

  it("finalizes mapped provider failures as stream errors before rethrowing", async () => {
    const { client, error, finish } = createClient();
    const publisher = new BeeperTurnStream({
      client,
      roomId: "!room:example.com",
      turnId: "turn_runner_error",
    });

    await expect(runBeeperTurnStream({
      events: ["a"],
      mapEvent: () => {
        throw new Error("provider exploded");
      },
      stream: publisher,
    })).rejects.toThrow("provider exploded");

    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      message: "provider exploded",
      runId: "turn_runner_error",
      terminal: expect.objectContaining({ message: "provider exploded", type: "RUN_ERROR" }),
      type: "error",
    }));
    expect(finish).not.toHaveBeenCalled();
  });
});

function createClient() {
  const result = (runId: string, events: Record<string, unknown>[] = []) => ({
    body: "...",
    descriptor: { device_id: "DEVICE", type: "com.beeper.llm", user_id: "@bot:example.com" },
    eventId: "$target",
    events,
    finalAIMessage: {},
    initialAIMessage: {},
    messageId: `msg-${runId}`,
    metadata: {},
    raw: {},
    replacementEventId: "$edit",
    roomId: "!room:example.com",
    runId,
    threadId: runId,
  });
  const start = vi.fn(async ({ runId }: { runId: string }) =>
    result(runId, [
      { runId, threadId: runId, type: "RUN_STARTED" },
      { messageId: `msg-${runId}`, role: "assistant", type: "TEXT_MESSAGE_START" },
    ]));
  const appendEvent = vi.fn(async ({ event, runId }: { event: Record<string, unknown>; runId: string }) =>
    result(runId, [event]));
  const finish = vi.fn(async ({ finishReason, runId }: { finishReason?: string; runId: string }) =>
    result(runId, [{ finishReason: finishReason ?? "stop", runId, threadId: runId, type: "RUN_FINISHED" }]));
  const error = vi.fn(async ({ message, runId }: { message?: string; runId: string }) =>
    result(runId, [{ message, runId, type: "RUN_ERROR" }]));
  const client = {
    beeper: {
      aiRunStreams: {
        appendEvent,
        error,
        finish,
        start,
      },
    },
  } as unknown as MatrixClient;
  return { appendEvent, client, error, finish, start };
}
