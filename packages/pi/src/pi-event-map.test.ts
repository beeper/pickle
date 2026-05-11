import { describe, expect, it } from "vitest";
import { createPiStreamState, mapPiAgentSessionEvent } from "./pi-event-map";

describe("Pi AgentSessionEvent to Beeper Desktop chunk mapping", () => {
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
      {
        messageId: "turn_message",
        messageMetadata: { turn_id: "turn_message" },
        type: "start",
      },
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
    ).toEqual([{ id: "reasoning_turn_message", type: "reasoning-start" }]);

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
        id: "reasoning_turn_message",
        type: "reasoning-delta",
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
    ).toEqual([{ id: "text_turn_message", type: "text-start" }]);

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
      { delta: "The mapping is ready.", id: "text_turn_message", type: "text-delta" },
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
      { id: "reasoning_turn_message", type: "reasoning-end" },
      { id: "text_turn_message", type: "text-end" },
      {
        finishReason: "stop",
        messageMetadata: { finish_reason: "stop", turn_id: "turn_message" },
        type: "finish",
      },
    ]);
  });

  it("maps tool_call and tool execution lifecycle events", () => {
    const state = createPiStreamState("turn_tools");

    expect(
      mapPiAgentSessionEvent(state, {
        dynamic: true,
        input: { cmd: "pwd" },
        toolCallId: "call_bash",
        toolName: "bash",
        type: "tool_call",
      })
    ).toEqual([
      {
        dynamic: true,
        input: { cmd: "pwd" },
        toolCallId: "call_bash",
        toolName: "bash",
        type: "tool-input-available",
      },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        args: { path: "packages/pi" },
        toolCallId: "call_read",
        toolName: "read",
        type: "tool_execution_start",
      })
    ).toEqual([
      {
        dynamic: true,
        input: { path: "packages/pi" },
        toolCallId: "call_read",
        toolName: "read",
        type: "tool-input-available",
      },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        args: { cmd: "pnpm test" },
        partialResult: "running tests...",
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool_execution_update",
      })
    ).toEqual([
      {
        dynamic: true,
        output: "running tests...",
        preliminary: true,
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool-output-available",
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
        dynamic: true,
        output: "all tests passed",
        preliminary: undefined,
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool-output-available",
      },
    ]);
  });

  it("maps successful and failed tool_result events", () => {
    const state = createPiStreamState("turn_results");

    expect(
      mapPiAgentSessionEvent(state, {
        content: [{ text: "src/index.ts", type: "text" }],
        details: { matches: 1 },
        input: { pattern: "createPiStreamState" },
        isError: false,
        toolCallId: "call_grep",
        toolName: "grep",
        type: "tool_result",
      })
    ).toEqual([
      {
        dynamic: true,
        output: [{ text: "src/index.ts", type: "text" }],
        preliminary: undefined,
        toolCallId: "call_grep",
        toolName: "grep",
        type: "tool-output-available",
      },
    ]);

    expect(
      mapPiAgentSessionEvent(state, {
        content: [{ text: "permission denied", type: "text" }],
        details: undefined,
        input: { path: "/private" },
        isError: true,
        toolCallId: "call_read",
        toolName: "read",
        type: "tool_result",
      })
    ).toEqual([
      {
        dynamic: true,
        errorText: JSON.stringify([{ text: "permission denied", type: "text" }]),
        toolCallId: "call_read",
        toolName: "read",
        type: "tool-output-error",
      },
    ]);
  });
});
