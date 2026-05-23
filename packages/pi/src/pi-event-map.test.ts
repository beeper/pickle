import { describe, expect, it } from "vitest";
import { createPiStreamState, mapPiAgentSessionEvent } from "./pi-event-map";

describe("Pi AgentSessionEvent to AG-UI mapping", () => {
  it("maps assistant message start, text/thinking deltas, and message end", () => {
    const state = createPiStreamState("turn_message");
    const assistantMessage = {
      content: [],
      role: "assistant",
    };

    expect(
      mapPiAgentSessionEvent(state, {
        message: assistantMessage,
        type: "message_start",
      })
    ).toEqual([
      { runId: "turn_message", threadId: "turn_message", type: "RUN_STARTED" },
      { messageId: "turn_message", role: "assistant", type: "TEXT_MESSAGE_START" },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        assistantMessageEvent: {
          contentIndex: 0,
          partial: assistantMessage,
          type: "thinking_start",
        },
        message: assistantMessage,
        type: "message_update",
      })
    ).toEqual([
      { messageId: "turn_message", type: "REASONING_START" },
      { messageId: "turn_message", role: "reasoning", type: "REASONING_MESSAGE_START" },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        assistantMessageEvent: {
          contentIndex: 0,
          delta: "Need to inspect the files.",
          partial: {
            ...assistantMessage,
            content: [{ text: "Need to inspect the files.", type: "thinking" }],
          },
          type: "thinking_delta",
        },
        message: assistantMessage,
        type: "message_update",
      })
    ).toEqual([
      {
        delta: "Need to inspect the files.",
        messageId: "turn_message",
        type: "REASONING_MESSAGE_CONTENT",
      },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        assistantMessageEvent: {
          contentIndex: 1,
          partial: assistantMessage,
          type: "text_start",
        },
        message: assistantMessage,
        type: "message_update",
      })
    ).toEqual([]);

    expect(
      mapPiAgentSessionEvent(state, {
        assistantMessageEvent: {
          contentIndex: 1,
          delta: "The mapping is ready.",
          partial: {
            ...assistantMessage,
            content: [
              { text: "Need to inspect the files.", type: "thinking" },
              { text: "The mapping is ready.", type: "text" },
            ],
          },
          type: "text_delta",
        },
        message: assistantMessage,
        type: "message_update",
      })
    ).toEqual([
      { delta: "The mapping is ready.", messageId: "turn_message", type: "TEXT_MESSAGE_CONTENT" },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        message: {
          ...assistantMessage,
          content: [
            { text: "Need to inspect the files.", type: "thinking" },
            { text: "The mapping is ready.", type: "text" },
          ],
        },
        type: "message_end",
      })
    ).toEqual([
      { messageId: "turn_message", type: "REASONING_MESSAGE_END" },
      { messageId: "turn_message", type: "REASONING_END" },
      { messageId: "turn_message", type: "TEXT_MESSAGE_END" },
      { finishReason: "stop", runId: "turn_message", threadId: "turn_message", type: "RUN_FINISHED" },
    ]);
  });

  it("maps tool_call and tool execution lifecycle events", () => {
    const state = createPiStreamState("turn_tools");

    expect(
      mapPiAgentSessionEvent(state, {
        input: { cmd: "pwd" },
        toolCallId: "call_bash",
        toolName: "bash",
        type: "tool_call",
      })
    ).toEqual([
      expect.objectContaining({ toolCallId: "call_bash", toolName: "bash", type: "TOOL_CALL_START" }),
      expect.objectContaining({ delta: "{\"cmd\":\"pwd\"}", toolCallId: "call_bash", type: "TOOL_CALL_ARGS" }),
      expect.objectContaining({ input: { cmd: "pwd" }, toolCallId: "call_bash", type: "TOOL_CALL_END" }),
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        partialResult: "running tests...",
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool_execution_update",
      })
    ).toEqual([
      {
        content: "running tests...",
        messageId: "call_test",
        preliminary: true,
        role: "tool",
        state: "streaming",
        toolCallId: "call_test",
        toolName: "bash",
        type: "TOOL_CALL_RESULT",
      },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        isError: false,
        result: "all tests passed",
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool_execution_end",
      })
    ).toEqual([
      {
        content: "all tests passed",
        messageId: "call_test",
        role: "tool",
        state: "complete",
        toolCallId: "call_test",
        toolName: "bash",
        type: "TOOL_CALL_RESULT",
      },
    ]);
  });

  it("maps successful and failed tool_result events", () => {
    const state = createPiStreamState("turn_results");

    expect(
      mapPiAgentSessionEvent(state, {
        content: [{ text: "src/index.ts", type: "text" }],
        isError: false,
        toolCallId: "call_grep",
        toolName: "grep",
        type: "tool_result",
      })
    ).toEqual([
      {
        content: "[{\"text\":\"src/index.ts\",\"type\":\"text\"}]",
        messageId: "call_grep",
        role: "tool",
        state: "complete",
        toolCallId: "call_grep",
        toolName: "grep",
        type: "TOOL_CALL_RESULT",
      },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        content: [{ text: "permission denied", type: "text" }],
        isError: true,
        toolCallId: "call_read",
        toolName: "read",
        type: "tool_result",
      })
    ).toEqual([
      {
        content: "[{\"text\":\"permission denied\",\"type\":\"text\"}]",
        messageId: "call_read",
        role: "tool",
        state: "error",
        toolCallId: "call_read",
        toolName: "read",
        type: "TOOL_CALL_RESULT",
      },
    ]);
  });
});
