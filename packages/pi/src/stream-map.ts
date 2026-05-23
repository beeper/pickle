export type AGUIEvent = Record<string, unknown> & { type: string };

export const AGUIEventType = {
  CUSTOM: "CUSTOM",
  REASONING_END: "REASONING_END",
  REASONING_MESSAGE_CONTENT: "REASONING_MESSAGE_CONTENT",
  REASONING_MESSAGE_END: "REASONING_MESSAGE_END",
  REASONING_MESSAGE_START: "REASONING_MESSAGE_START",
  REASONING_START: "REASONING_START",
  RUN_ERROR: "RUN_ERROR",
  RUN_FINISHED: "RUN_FINISHED",
  RUN_STARTED: "RUN_STARTED",
  TEXT_MESSAGE_CONTENT: "TEXT_MESSAGE_CONTENT",
  TEXT_MESSAGE_END: "TEXT_MESSAGE_END",
  TEXT_MESSAGE_START: "TEXT_MESSAGE_START",
  TOOL_CALL_ARGS: "TOOL_CALL_ARGS",
  TOOL_CALL_END: "TOOL_CALL_END",
  TOOL_CALL_RESULT: "TOOL_CALL_RESULT",
  TOOL_CALL_START: "TOOL_CALL_START",
} as const;

export interface StreamRunState {
  messageStarted: boolean;
  reasoningStarted: boolean;
  textStarted: boolean;
  toolCallIdToApprovalId: Record<string, string>;
  toolInputByCallId: Record<string, unknown>;
  toolNameByCallId: Record<string, string>;
  turnId: string;
}

export function createStreamRunState(turnId: string): StreamRunState {
  return {
    messageStarted: false,
    reasoningStarted: false,
    textStarted: false,
    toolCallIdToApprovalId: {},
    toolInputByCallId: {},
    toolNameByCallId: {},
    turnId,
  };
}

export function createTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function startRunEvents(state: StreamRunState): AGUIEvent[] {
  if (state.messageStarted) return [];
  state.messageStarted = true;
  return [
    {
      runId: state.turnId,
      threadId: state.turnId,
      type: AGUIEventType.RUN_STARTED,
    },
    {
      messageId: state.turnId,
      role: "assistant",
      type: AGUIEventType.TEXT_MESSAGE_START,
    },
  ];
}

export function finishRunEvents(state: StreamRunState, finishReason = "stop"): AGUIEvent[] {
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
    },
  ];
}

export function mapPiMessageDelta(
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
  return [];
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

export function mapPiToolInput(event: {
  dynamic?: boolean;
  input?: unknown;
  startedAtMs?: number;
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
      ...(event.startedAtMs !== undefined ? { startedAtMs: event.startedAtMs } : {}),
    },
    {
      args: event.input,
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

export function mapPiToolOutput(event: {
  completedAtMs?: number;
  error?: unknown;
  output?: unknown;
  preliminary?: boolean;
  toolCallId: string;
  toolName?: string;
}): AGUIEvent[] {
  const state = event.error !== undefined ? "error" : event.preliminary ? "streaming" : "complete";
  return [
    {
      content: stringifyToolValue(event.error !== undefined ? event.error : event.output),
      role: "tool",
      state,
      toolCallId: event.toolCallId,
      type: AGUIEventType.TOOL_CALL_RESULT,
      ...(event.toolName ? { toolName: event.toolName } : {}),
      ...(event.completedAtMs !== undefined ? { completedAtMs: event.completedAtMs } : {}),
      ...(event.preliminary !== undefined ? { preliminary: event.preliminary } : {}),
    },
  ];
}

export function mapPiApprovalRequest(
  state: StreamRunState,
  event: { message?: string; toolCallId: string; toolName: string }
): AGUIEvent {
  const approvalId = `approval_${event.toolCallId}`;
  state.toolCallIdToApprovalId[event.toolCallId] = approvalId;
  return {
    name: "approval-requested",
    type: AGUIEventType.CUSTOM,
    value: {
      approval: {
        id: approvalId,
        needsApproval: true,
      },
      approvalMessageId: approvalId,
      message: event.message,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
    },
  };
}

export function mapPiApprovalResponse(event: {
  approvalId: string;
  approved: boolean;
  approvedAlways?: boolean;
  toolCallId: string;
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
