import { describe, expect, it } from "vitest";
import {
  closeOpenMessageParts,
  createStreamRunState,
  finishChunk,
  mapPiApprovalRequest,
  mapPiMessageDelta,
  mapPiToolInput,
  mapPiToolOutput,
  startChunk,
  withStreamEnvelope,
} from "./stream-map";

describe("Pi event to Beeper stream mapping", () => {
  it("maps assistant text and reasoning to Desktop chunks", () => {
    const state = createStreamRunState("turn_1");

    expect(startChunk(state)).toEqual({
      messageId: "turn_1",
      messageMetadata: { turn_id: "turn_1" },
      type: "start",
    });
    expect(mapPiMessageDelta(state, { kind: "thinking", value: "checking" })).toEqual([
      { id: "reasoning_turn_1", type: "reasoning-start" },
      { delta: "checking", id: "reasoning_turn_1", type: "reasoning-delta" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "thinking", value: " files" })).toEqual([
      { delta: " files", id: "reasoning_turn_1", type: "reasoning-delta" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "text", value: "done" })).toEqual([
      { id: "text_turn_1", type: "text-start" },
      { delta: "done", id: "text_turn_1", type: "text-delta" },
    ]);
    expect(mapPiMessageDelta(state, { kind: "text", value: "." })).toEqual([
      { delta: ".", id: "text_turn_1", type: "text-delta" },
    ]);
    expect(closeOpenMessageParts(state)).toEqual([
      { id: "reasoning_turn_1", type: "reasoning-end" },
      { id: "text_turn_1", type: "text-end" },
    ]);
    expect(finishChunk(state)).toMatchObject({ finishReason: "stop", type: "finish" });
  });

  it("maps tool lifecycle and approval chunks", () => {
    const state = createStreamRunState("turn_2");

    expect(mapPiToolInput({ input: { cmd: "pwd" }, toolCallId: "call_1", toolName: "bash" })).toEqual({
      input: { cmd: "pwd" },
      toolCallId: "call_1",
      toolName: "bash",
      type: "tool-input-available",
    });
    expect(mapPiToolOutput({ output: "ok", toolCallId: "call_1", toolName: "bash" })).toEqual({
      output: "ok",
      preliminary: undefined,
      toolCallId: "call_1",
      toolName: "bash",
      type: "tool-output-available",
    });
    expect(mapPiApprovalRequest(state, { toolCallId: "call_1", toolName: "bash" })).toMatchObject({
      approvalId: "approval_call_1",
      toolCallId: "call_1",
      type: "tool-approval-request",
    });
  });

  it("envelopes chunks with monotonic Desktop stream seq values", () => {
    const state = createStreamRunState("turn_3");
    const first = withStreamEnvelope(state, { type: "start" });
    const second = withStreamEnvelope(state, { type: "finish" });

    expect(first["com.beeper.llm.deltas"]).toMatchObject([{ seq: 1, turn_id: "turn_3" }]);
    expect(second["com.beeper.llm.deltas"]).toMatchObject([{ seq: 2, turn_id: "turn_3" }]);
  });
});
