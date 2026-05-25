export { EventType as AGUIEventType } from "@beeper/pickle-ag-ui";
export type { AGUIEvent } from "@beeper/pickle-ag-ui";

import { EventType as AGUIEventType, type AGUIEvent } from "@beeper/pickle-ag-ui";
import type { RunFinishedEvent } from "@beeper/pickle-ag-ui";
import { defaultBeeperApprovalChoices } from "./approval";

type FinishReason = NonNullable<RunFinishedEvent["finishReason"]>;

export interface StreamRunState {
  messageStarted: boolean;
  reasoningStarted: boolean;
  textStarted: boolean;
  toolCallIdToApprovalId: Record<string, string>;
  turnId: string;
}

export function createStreamRunState(turnId: string): StreamRunState {
  return {
    messageStarted: false,
    reasoningStarted: false,
    textStarted: false,
    toolCallIdToApprovalId: {},
    turnId,
  };
}

export function createTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function startRunEvents(state: StreamRunState, metadata: Record<string, unknown> = {}): AGUIEvent[] {
  if (state.messageStarted) return [];
  state.messageStarted = true;
  state.textStarted = true;
  return [
    {
      runId: state.turnId,
      threadId: state.turnId,
      type: AGUIEventType.RUN_STARTED,
      ...(Object.keys(metadata).length > 0 ? { metadata: { turn_id: state.turnId, ...metadata } } : {}),
    },
    {
      messageId: state.turnId,
      role: "assistant",
      type: AGUIEventType.TEXT_MESSAGE_START,
    },
  ];
}

export function finishRunEvents(
  state: StreamRunState,
  finishReason: FinishReason = "stop",
  metadata: Record<string, unknown> = {}
): AGUIEvent[] {
  return [
    ...closeOpenMessageParts(state),
    {
      messageId: state.turnId,
      type: AGUIEventType.TEXT_MESSAGE_END,
    },
    {
      finishReason,
      runId: state.turnId,
      threadId: state.turnId,
      type: AGUIEventType.RUN_FINISHED,
      ...(Object.keys(metadata).length > 0 ? { metadata: { finish_reason: finishReason, turn_id: state.turnId, ...metadata } } : {}),
    },
  ];
}

export function mapOpenClawMessageDelta(
  state: StreamRunState,
  delta: { kind: "text" | "thinking"; value: string }
): AGUIEvent[] {
  if (delta.kind === "text") {
    return [
      ...openTextPart(state),
      {
        delta: delta.value,
        messageId: state.turnId,
        type: AGUIEventType.TEXT_MESSAGE_CONTENT,
      },
    ];
  }
  return [
    ...openReasoningPart(state),
    {
      delta: delta.value,
      messageId: state.turnId,
      type: AGUIEventType.REASONING_MESSAGE_CONTENT,
    },
  ];
}

export function closeOpenMessageParts(state: StreamRunState): AGUIEvent[] {
  return [...closeReasoningPart(state), ...closeTextPart(state)];
}

export function openTextPart(state: StreamRunState): AGUIEvent[] {
  if (state.textStarted) return [];
  state.textStarted = true;
  return [
    {
      messageId: state.turnId,
      role: "assistant",
      type: AGUIEventType.TEXT_MESSAGE_START,
    },
  ];
}

export function closeTextPart(state: StreamRunState): AGUIEvent[] {
  if (!state.textStarted) return [];
  state.textStarted = false;
  return [];
}

export function openReasoningPart(state: StreamRunState): AGUIEvent[] {
  if (state.reasoningStarted) return [];
  state.reasoningStarted = true;
  return [
    {
      messageId: state.turnId,
      type: AGUIEventType.REASONING_START,
    },
    {
      messageId: state.turnId,
      role: "reasoning",
      type: AGUIEventType.REASONING_MESSAGE_START,
    },
  ];
}

export function closeReasoningPart(state: StreamRunState): AGUIEvent[] {
  if (!state.reasoningStarted) return [];
  state.reasoningStarted = false;
  return [
    {
      messageId: state.turnId,
      type: AGUIEventType.REASONING_MESSAGE_END,
    },
    {
      messageId: state.turnId,
      type: AGUIEventType.REASONING_END,
    },
  ];
}

export function mapOpenClawToolInput(event: {
  dynamic?: boolean;
  input?: unknown;
  providerExecuted?: boolean;
  startedAtMs?: number;
  title?: string;
  toolCallId: string;
  toolName?: string;
}): AGUIEvent[] {
  const toolName = event.toolName || "tool";
  return [
    {
      parentMessageId: event.toolCallId,
      state: "awaiting-input",
      toolCallId: event.toolCallId,
      toolCallName: toolName,
      toolName,
      type: AGUIEventType.TOOL_CALL_START,
      ...(event.dynamic !== undefined ? { dynamic: event.dynamic } : {}),
      ...(event.providerExecuted !== undefined ? { providerExecuted: event.providerExecuted } : {}),
      ...(event.startedAtMs !== undefined ? { startedAtMs: event.startedAtMs } : {}),
      ...(event.title !== undefined ? { title: event.title } : {}),
    },
    {
      args: stringifyToolValue(event.input),
      delta: stringifyToolValue(event.input),
      state: "input-streaming",
      toolCallId: event.toolCallId,
      type: AGUIEventType.TOOL_CALL_ARGS,
    },
    {
      input: event.input,
      state: "input-complete",
      toolCallId: event.toolCallId,
      toolCallName: toolName,
      toolName,
      type: AGUIEventType.TOOL_CALL_END,
    },
  ];
}

export function mapOpenClawToolInputDelta(event: {
  input?: unknown;
  inputTextDelta?: string;
  toolCallId: string;
  toolName?: string;
}): AGUIEvent[] {
  return [
    {
      args: event.inputTextDelta ?? stringifyToolValue(event.input),
      delta: event.inputTextDelta ?? stringifyToolValue(event.input),
      state: "input-streaming",
      toolCallId: event.toolCallId,
      type: AGUIEventType.TOOL_CALL_ARGS,
    },
  ];
}

export function mapOpenClawToolOutput(event: {
  completedAtMs?: number;
  error?: unknown;
  output?: unknown;
  preliminary?: boolean;
  providerExecuted?: boolean;
  toolCallId: string;
  toolName?: string;
}): AGUIEvent[] {
  const state = event.error !== undefined ? "error" : event.preliminary ? "streaming" : "complete";
  return [
    {
      content: stringifyToolValue(event.error !== undefined ? event.error : event.output),
      messageId: event.toolCallId,
      role: "tool",
      state,
      toolCallId: event.toolCallId,
      type: AGUIEventType.TOOL_CALL_RESULT,
      ...(event.completedAtMs !== undefined ? { completedAtMs: event.completedAtMs } : {}),
      ...(event.preliminary !== undefined ? { preliminary: event.preliminary } : {}),
      ...(event.providerExecuted !== undefined ? { providerExecuted: event.providerExecuted } : {}),
      ...(event.toolName ? { toolName: event.toolName } : {}),
    },
  ];
}

export function mapOpenClawApprovalRequest(
  state: StreamRunState,
  event: { approvalId?: string; message?: string; toolCallId?: string; toolName?: string }
): AGUIEvent {
  const toolCallId = event.toolCallId ?? event.approvalId ?? "approval";
  const approvalId = event.approvalId ?? `approval_${toolCallId}`;
  state.toolCallIdToApprovalId[toolCallId] = approvalId;
  return {
    name: "approval-requested",
    type: AGUIEventType.CUSTOM,
    value: {
      approval: {
        id: approvalId,
        needsApproval: true,
      },
      approvalMessageId: approvalId,
      choices: defaultBeeperApprovalChoices(),
      message: event.message,
      toolCallId,
      toolName: event.toolName,
    },
  };
}

export function mapOpenClawApprovalResponse(event: {
  approvalId: string;
  approved: boolean;
  approvedAlways?: boolean;
  toolCallId?: string;
}): AGUIEvent {
  return {
    name: "approval-responded",
    type: AGUIEventType.CUSTOM,
    value: {
      approval: {
        always: event.approvedAlways,
        approved: event.approved,
        id: event.approvalId,
      },
      toolCallId: event.toolCallId,
    },
  };
}

function stringifyToolValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
