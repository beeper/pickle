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
        metadata: {
          agent_id: "codex",
          run_id: "run_1",
          session_key: "agent:codex:main",
          turn_id: "turn_oc",
        },
        runId: "turn_oc",
        threadId: "turn_oc",
        type: "RUN_STARTED",
      },
      {
        messageId: "turn_oc",
        role: "assistant",
        type: "TEXT_MESSAGE_START",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, { data: { delta: "Hello" }, type: "assistant.delta" })).toEqual([
      { delta: "Hello", messageId: "turn_oc", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, { data: { delta: " thinking" }, type: "thinking.delta" })).toEqual([
      { messageId: "turn_oc", type: "REASONING_START" },
      { messageId: "turn_oc", role: "reasoning", type: "REASONING_MESSAGE_START" },
      { delta: " thinking", messageId: "turn_oc", type: "REASONING_MESSAGE_CONTENT" },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, { runId: "run_1", type: "run.completed" })).toEqual([
      { messageId: "turn_oc", type: "REASONING_MESSAGE_END" },
      { messageId: "turn_oc", type: "REASONING_END" },
      {
        messageId: "turn_oc",
        type: "TEXT_MESSAGE_END",
      },
      {
        finishReason: "stop",
        metadata: { finish_reason: "stop", run_id: "run_1", turn_id: "turn_oc" },
        runId: "turn_oc",
        threadId: "turn_oc",
        type: "RUN_FINISHED",
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
        parentMessageId: "call_1",
        state: "awaiting-input",
        toolCallId: "call_1",
        toolCallName: "shell",
        toolName: "shell",
        type: "TOOL_CALL_START",
      },
      {
        args: "{\"cmd\":\"pnpm test\"}",
        delta: "{\"cmd\":\"pnpm test\"}",
        state: "input-streaming",
        toolCallId: "call_1",
        type: "TOOL_CALL_ARGS",
      },
      {
        input: { cmd: "pnpm test" },
        state: "input-complete",
        toolCallId: "call_1",
        toolCallName: "shell",
        toolName: "shell",
        type: "TOOL_CALL_END",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { delta: "{\"cmd\"", toolCallId: "call_2", toolName: "edit" },
      type: "tool.call.delta",
    })).toEqual([
      {
        args: "{\"cmd\"",
        delta: "{\"cmd\"",
        state: "input-streaming",
        toolCallId: "call_2",
        type: "TOOL_CALL_ARGS",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { output: "ok", preliminary: true, toolCallId: "call_1", toolName: "shell" },
      type: "tool.call.completed",
    })).toEqual([
      {
        content: "ok",
        messageId: "call_1",
        preliminary: true,
        role: "tool",
        state: "streaming",
        toolCallId: "call_1",
        toolName: "shell",
        type: "TOOL_CALL_RESULT",
      },
    ]);

    expect(mapOpenClawEventToBeeperChunks(state, {
      data: { error: { message: "denied" }, toolCallId: "call_3", toolName: "write" },
      type: "tool.call.failed",
    })).toEqual([
      {
        content: "{\"message\":\"denied\"}",
        messageId: "call_3",
        role: "tool",
        state: "error",
        toolCallId: "call_3",
        toolName: "write",
        type: "TOOL_CALL_RESULT",
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
        name: "approval-requested",
        type: "CUSTOM",
        value: {
          approval: {
            id: "approval_1",
            needsApproval: true,
          },
          approvalMessageId: "approval_1",
          message: "Allow shell?",
          toolCallId: "call_1",
          toolName: "shell",
        },
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
        name: "approval-responded",
        type: "CUSTOM",
        value: {
          approval: {
            always: false,
            approved: true,
            id: "approval_1",
          },
          toolCallId: "call_1",
        },
      },
    ]);
  });

  it("starts text messages when upstream sends deltas before run.started", () => {
    const state = createOpenClawStreamState("turn_delta_only");

    expect(mapOpenClawEventToBeeperChunks(state, { data: { delta: "Hello" }, type: "assistant.delta" })).toEqual([
      {
        messageId: "turn_delta_only",
        role: "assistant",
        type: "TEXT_MESSAGE_START",
      },
      { delta: "Hello", messageId: "turn_delta_only", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, { data: { delta: " again" }, type: "assistant.delta" })).toEqual([
      { delta: " again", messageId: "turn_delta_only", type: "TEXT_MESSAGE_CONTENT" },
    ]);
  });

  it("normalizes upstream gateway session and approval event families", () => {
    const state = createOpenClawStreamState("turn_gateway");

    expect(mapOpenClawEventToBeeperChunks(state, {
      event: "session.operation",
      payload: { phase: "started", runId: "run_1", sessionKey: "session_1" },
    })).toEqual([
      {
        metadata: {
          run_id: "run_1",
          session_key: "session_1",
          turn_id: "turn_gateway",
        },
        runId: "turn_gateway",
        threadId: "turn_gateway",
        type: "RUN_STARTED",
      },
      {
        messageId: "turn_gateway",
        role: "assistant",
        type: "TEXT_MESSAGE_START",
      },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, {
      event: "session.message",
      payload: { deltaText: "Hello", role: "assistant", runId: "run_1" },
    })).toEqual([
      { delta: "Hello", messageId: "turn_gateway", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, {
      event: "session.tool",
      payload: { args: { cmd: "pwd" }, phase: "started", tool: "exec", toolCallId: "tool_1" },
    })).toEqual([
      {
        parentMessageId: "tool_1",
        state: "awaiting-input",
        toolCallId: "tool_1",
        toolCallName: "exec",
        toolName: "exec",
        type: "TOOL_CALL_START",
      },
      {
        args: "{\"cmd\":\"pwd\"}",
        delta: "{\"cmd\":\"pwd\"}",
        state: "input-streaming",
        toolCallId: "tool_1",
        type: "TOOL_CALL_ARGS",
      },
      {
        input: { cmd: "pwd" },
        state: "input-complete",
        toolCallId: "tool_1",
        toolCallName: "exec",
        toolName: "exec",
        type: "TOOL_CALL_END",
      },
    ]);
    expect(mapOpenClawEventToBeeperChunks(state, {
      event: "exec.approval.requested",
      payload: { id: "approval_1", reason: "Run command?", tool: "exec", toolCallId: "tool_1" },
    })).toEqual([
      {
        name: "approval-requested",
        type: "CUSTOM",
        value: {
          approval: {
            id: "approval_1",
            needsApproval: true,
          },
          approvalMessageId: "approval_1",
          message: "Run command?",
          toolCallId: "tool_1",
          toolName: "exec",
        },
      },
    ]);
  });

  it("marks cancelled OpenClaw runs as abort terminal stream events", () => {
    const state = createOpenClawStreamState("turn_cancel");

    expect(mapOpenClawEventToBeeperChunks(state, {
      event: "session.operation",
      payload: { phase: "cancelled", reason: "user stopped it", runId: "run_cancel" },
    })).toEqual([
      {
        message: "user stopped it",
        reason: "user stopped it",
        runId: "turn_cancel",
        terminalType: "abort",
        type: "RUN_ERROR",
      },
    ]);
  });
});
