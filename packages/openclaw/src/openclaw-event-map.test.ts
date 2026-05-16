import { describe, expect, it } from "vitest";
import { createOpenClawStreamState, mapOpenClawEventToBeeperChunks } from "./openclaw-event-map";

describe("OpenClaw event to Beeper stream mapping", () => {
  it("maps run lifecycle and assistant deltas into a single Beeper message", () => {
    const state = createOpenClawStreamState("turn_oc");

    expect(mapOpenClawEventToBeeperChunks(state, {
      agentId: "codex",
      runId: "run_1",
      sessionKey: "agent:codex:main",
      type: "run.started",
    })).toEqual([
      {
        messageId: "turn_oc",
        messageMetadata: {
          agent_id: "codex",
          run_id: "run_1",
          session_key: "agent:codex:main",
          turn_id: "turn_oc",
        },
        type: "start",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, { data: { delta: "Hello" }, type: "assistant.delta" })).toEqual([
      { id: "text_turn_oc", type: "text-start" },
      { delta: "Hello", id: "text_turn_oc", type: "text-delta" },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, { data: { delta: " thinking" }, type: "thinking.delta" })).toEqual([
      { id: "reasoning_turn_oc", type: "reasoning-start" },
      { delta: " thinking", id: "reasoning_turn_oc", type: "reasoning-delta" },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, { runId: "run_1", type: "run.completed" })).toEqual([
      { id: "reasoning_turn_oc", type: "reasoning-end" },
      { id: "text_turn_oc", type: "text-end" },
      {
        finishReason: "stop",
        messageMetadata: { finish_reason: "stop", run_id: "run_1", turn_id: "turn_oc" },
        type: "finish",
      },
    ]);
  });

  it("maps tool lifecycle events to Desktop-compatible tool chunks", () => {
    const state = createOpenClawStreamState("turn_tools");

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { arguments: "{\"cmd\":\"pnpm test\"}", id: "call_1", name: "shell" },
      type: "tool.call.started",
    })).toEqual([
      {
        dynamic: true,
        input: { cmd: "pnpm test" },
        toolCallId: "call_1",
        toolName: "shell",
        type: "tool-input-available",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { delta: "{\"cmd\"", toolCallId: "call_2", toolName: "edit" },
      type: "tool.call.delta",
    })).toEqual([
      {
        dynamic: true,
        inputTextDelta: "{\"cmd\"",
        toolCallId: "call_2",
        toolName: "edit",
        type: "tool-input-delta",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { output: "ok", preliminary: true, toolCallId: "call_1", toolName: "shell" },
      type: "tool.call.completed",
    })).toEqual([
      {
        dynamic: true,
        output: "ok",
        preliminary: true,
        toolCallId: "call_1",
        toolName: "shell",
        type: "tool-output-available",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { error: { message: "denied" }, toolCallId: "call_3", toolName: "write" },
      type: "tool.call.failed",
    })).toEqual([
      {
        dynamic: true,
        errorText: "{\"message\":\"denied\"}",
        toolCallId: "call_3",
        toolName: "write",
        type: "tool-output-error",
      },
    ]);
  });

  it("maps OpenClaw approval events to Beeper approval chunks", () => {
    const state = createOpenClawStreamState("turn_approvals");

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: {
        approvalId: "approval_1",
        message: "Allow shell?",
        toolCallId: "call_1",
        toolName: "shell",
      },
      type: "approval.requested",
    })).toEqual([
      {
        approvalId: "approval_1",
        message: "Allow shell?",
        toolCallId: "call_1",
        toolName: "shell",
        type: "tool-approval-request",
      },
    ]);
    expect(state.toolCallIdToApprovalId.call_1).toBe("approval_1");

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: {
        approvalId: "approval_1",
        decision: "approve",
        toolCallId: "call_1",
      },
      type: "approval.resolved",
    })).toEqual([
      {
        approvalId: "approval_1",
        approved: true,
        approvedAlways: false,
        toolCallId: "call_1",
        type: "tool-approval-response",
      },
    ]);
  });
});
