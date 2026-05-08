import { describe, expect, it } from "vitest";
import { createPiEventMapper } from "./pi-event-map";

describe("Pi AgentSessionEvent to Beeper Desktop chunk mapping", () => {
  it("maps assistant message start, text/thinking deltas, and message end", () => {
    const mapper = createPiEventMapper("turn_message");
    const assistantMessage = {
      content: [],
      role: "assistant",
    };

    expect(
      mapper.map({
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
      mapper.map({
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
      { id: "reasoning_turn_message", type: "reasoning-start" },
      {
        delta: "Need to inspect the files.",
        id: "reasoning_turn_message",
        type: "reasoning-delta",
      },
    ]);

    expect(
      mapper.map({
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
      { id: "text_turn_message", type: "text-start" },
      { delta: "The mapping is ready.", id: "text_turn_message", type: "text-delta" },
    ]);

    expect(
      mapper.map({
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
    const mapper = createPiEventMapper("turn_tools");

    expect(
      mapper.map({
        input: { cmd: "pwd" },
        toolCallId: "call_bash",
        toolName: "bash",
        type: "tool_call",
      })
    ).toEqual([
      {
        input: { cmd: "pwd" },
        toolCallId: "call_bash",
        toolName: "bash",
        type: "tool-input-available",
      },
    ]);

    expect(
      mapper.map({
        args: { path: "packages/pi" },
        toolCallId: "call_read",
        toolName: "read",
        type: "tool_execution_start",
      })
    ).toEqual([
      {
        input: { path: "packages/pi" },
        toolCallId: "call_read",
        toolName: "read",
        type: "tool-input-available",
      },
    ]);

    expect(
      mapper.map({
        args: { cmd: "pnpm test" },
        partialResult: "running tests...",
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool_execution_update",
      })
    ).toEqual([
      {
        output: "running tests...",
        preliminary: true,
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool-output-available",
      },
    ]);

    expect(
      mapper.map({
        isError: false,
        result: "all tests passed",
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool_execution_end",
      })
    ).toEqual([
      {
        output: "all tests passed",
        preliminary: undefined,
        toolCallId: "call_test",
        toolName: "bash",
        type: "tool-output-available",
      },
    ]);
  });

  it("maps successful and failed tool_result events", () => {
    const mapper = createPiEventMapper("turn_results");

    expect(
      mapper.map({
        content: [{ text: "src/index.ts", type: "text" }],
        details: { matches: 1 },
        input: { pattern: "createPiEventMapState" },
        isError: false,
        toolCallId: "call_grep",
        toolName: "grep",
        type: "tool_result",
      })
    ).toEqual([
      {
        output: [{ text: "src/index.ts", type: "text" }],
        preliminary: undefined,
        toolCallId: "call_grep",
        toolName: "grep",
        type: "tool-output-available",
      },
    ]);

    expect(
      mapper.map({
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
        errorText: JSON.stringify([{ text: "permission denied", type: "text" }]),
        toolCallId: "call_read",
        toolName: "read",
        type: "tool-output-error",
      },
    ]);
  });
});
