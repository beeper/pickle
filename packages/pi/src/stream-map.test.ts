import { describe, expect, it } from "vitest";
import {
  closeOpenMessageParts,
  createStreamRunState,
  finishRunEvents,
  mapPiApprovalRequest,
  mapPiMessageDelta,
  mapPiToolInput,
  mapPiToolOutput,
  startRunEvents,
} from "./stream-map";

describe("Pi event to AG-UI stream mapping", () => {
  it("maps assistant text and reasoning to AG-UI events", () => {
    const state = createStreamRunState("turn_1");

    expect(startRunEvents(state)).toEqual([
      { runId: "turn_1", threadId: "turn_1", type: "RUN_STARTED" },
      { messageId: "turn_1", role: "assistant", type: "TEXT_MESSAGE_START" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "thinking", value: "checking" })).toEqual([
      { messageId: "turn_1", type: "REASONING_START" },
      { messageId: "turn_1", type: "REASONING_MESSAGE_START" },
      { delta: "checking", messageId: "turn_1", type: "REASONING_MESSAGE_CONTENT" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "thinking", value: " files" })).toEqual([
      { delta: " files", messageId: "turn_1", type: "REASONING_MESSAGE_CONTENT" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "text", value: "done" })).toEqual([
      { delta: "done", messageId: "turn_1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "text", value: "." })).toEqual([
      { delta: ".", messageId: "turn_1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(closeOpenMessageParts(state)).toEqual([
      { messageId: "turn_1", type: "REASONING_MESSAGE_END" },
      { messageId: "turn_1", type: "REASONING_END" },
    ]);
    expect(finishRunEvents(state)).toMatchObject([
      { messageId: "turn_1", type: "TEXT_MESSAGE_END" },
      { finishReason: "stop", runId: "turn_1", threadId: "turn_1", type: "RUN_FINISHED" },
    ]);
  });

  it("maps tool lifecycle and approval events", () => {
    const state = createStreamRunState("turn_2");

    expect(mapPiToolInput({ input: { cmd: "pwd" }, toolCallId: "call_1", toolName: "bash" })).toEqual([
      {
        parentMessageId: "call_1",
        state: "awaiting-input",
        toolCallId: "call_1",
        toolCallName: "bash",
        toolName: "bash",
        type: "TOOL_CALL_START",
      },
      {
        args: { cmd: "pwd" },
        delta: "{\"cmd\":\"pwd\"}",
        state: "input-streaming",
        toolCallId: "call_1",
        type: "TOOL_CALL_ARGS",
      },
      {
        input: { cmd: "pwd" },
        state: "input-complete",
        toolCallId: "call_1",
        toolCallName: "bash",
        toolName: "bash",
        type: "TOOL_CALL_END",
      },
    ]);
    expect(mapPiToolOutput({ output: "ok", toolCallId: "call_1", toolName: "bash" })).toEqual([
      {
        content: "ok",
        role: "tool",
        state: "complete",
        toolCallId: "call_1",
        toolName: "bash",
        type: "TOOL_CALL_RESULT",
      },
    ]);
    expect(mapPiApprovalRequest(state, { toolCallId: "call_1", toolName: "bash" })).toMatchObject({
      name: "approval-requested",
      type: "CUSTOM",
      value: {
        approvalMessageId: "approval_call_1",
        toolCallId: "call_1",
      },
    });
  });
});
