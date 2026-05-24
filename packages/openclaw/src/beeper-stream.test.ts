import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { BeeperStreamPublisher, OpenClawBeeperStreamPublisher } from "./beeper-stream";
import type { OpenClawSessionBinding } from "./types";

describe("OpenClaw Beeper native stream publisher", () => {
  it("starts one native Beeper stream, publishes AG-UI events, and finalizes replacement content", async () => {
    const { client, finalizeMessage, publishPart, startMessage } = createClient();
    const publisher = new BeeperStreamPublisher({
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
        msgtype: "m.text",
      },
      roomId: "!room:example.com",
      streamType: "com.beeper.llm",
      userId: "@openclaw_agent_codex:example.com",
    });
    expect(publishPart.mock.calls.map(([options]) => options.part.type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    expect(finalizeMessage).toHaveBeenCalledWith(expect.objectContaining({
      body: "hello",
      content: expect.objectContaining({
        "com.beeper.ai": expect.objectContaining({
          parts: [{ state: "done", text: "hello", type: "text" }],
        }),
        body: "hello",
        msgtype: "m.text",
      }),
      eventId: "$target",
      roomId: "!room:example.com",
    }));
  });

  it("keeps one room/run publisher open until a terminal event arrives", async () => {
    const { client, finalizeMessage, publishPart, startMessage } = createClient();
    const publisher = new OpenClawBeeperStreamPublisher({ client, userId: "@bot:example.com" });
    const binding = sessionBinding();

    await publisher.publish(binding, [
      { runId: "turn_2", threadId: "turn_2", type: "RUN_STARTED" },
      { messageId: "turn_2", role: "assistant", type: "TEXT_MESSAGE_START" },
    ]);
    await publisher.publish(binding, [
      { delta: "hi", messageId: "turn_2", type: "TEXT_MESSAGE_CONTENT" },
      { finishReason: "stop", runId: "turn_2", threadId: "turn_2", type: "RUN_FINISHED" },
    ]);

    expect(startMessage).toHaveBeenCalledTimes(1);
    expect(publishPart.mock.calls.map(([options]) => options.part.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    expect(finalizeMessage).toHaveBeenCalledTimes(1);
  });

  it("honors native-only stream finalization without sending a replacement edit", async () => {
    const { client, finalizeMessage, publishPart, startMessage } = createClient();
    const publisher = new OpenClawBeeperStreamPublisher({
      client,
      config: { streamFinalization: "native-only" },
      userId: "@bot:example.com",
    });

    await publisher.publish(sessionBinding(), [
      { runId: "turn_3", threadId: "turn_3", type: "RUN_STARTED" },
      { delta: "native", messageId: "turn_3", type: "TEXT_MESSAGE_CONTENT" },
      { finishReason: "stop", runId: "turn_3", threadId: "turn_3", type: "RUN_FINISHED" },
    ]);

    expect(startMessage).toHaveBeenCalledTimes(1);
    expect(publishPart.mock.calls.map(([options]) => options.part.type)).toEqual([
      "RUN_STARTED",
      "TEXT_MESSAGE_CONTENT",
      "RUN_FINISHED",
    ]);
    expect(finalizeMessage).not.toHaveBeenCalled();
  });

  it("drops a terminal run publisher even when Beeper finalization fails", async () => {
    const { client, finalizeMessage, startMessage } = createClient();
    finalizeMessage.mockRejectedValueOnce(new Error("finalize failed"));
    const publisher = new OpenClawBeeperStreamPublisher({ client, userId: "@bot:example.com" });
    const binding = sessionBinding();

    await expect(publisher.publish(binding, [
      { delta: "first", messageId: "turn_4", type: "TEXT_MESSAGE_CONTENT" },
      { error: "boom", message: "boom", runId: "turn_4", type: "RUN_ERROR" },
    ])).rejects.toThrow("finalize failed");

    await publisher.publish(binding, [
      { delta: "second", messageId: "turn_4", type: "TEXT_MESSAGE_CONTENT" },
    ]);

    expect(startMessage).toHaveBeenCalledTimes(2);
  });

  it("finalizes run errors with a readable fallback body", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperStreamPublisher({
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
    const publisher = new BeeperStreamPublisher({
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
    const publisher = new BeeperStreamPublisher({
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
      expect.objectContaining({ text: "thinking", type: "reasoning" }),
      expect.objectContaining({
        approval: { approved: true, id: "approval_1" },
        input: { cmd: "date" },
        output: "ok",
        state: "approval-responded",
        toolCallId: "tool_1",
        toolName: "shell",
        type: "dynamic-tool",
      }),
      expect.objectContaining({ text: "done", type: "text" }),
    ]));
  });
});

function sessionBinding(): OpenClawSessionBinding {
  return {
    agentId: "codex",
    createdAt: 1,
    ghostUserId: "@openclaw_agent_codex:example.com",
    id: "binding",
    kind: "session",
    owner: "bridge",
    roomId: "!room:example.com",
    sessionKey: "agent:codex:session",
    updatedAt: 1,
  };
}

function createClient() {
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
      streams: {
        finalizeMessage,
        publishPart,
        startMessage,
      },
    },
  } as unknown as MatrixClient;
  return { client, finalizeMessage, publishPart, startMessage };
}
