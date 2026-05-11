export type BeeperUIMessageChunk = Record<string, unknown> & { type: string };

export interface StreamRunState {
  reasoningPartId?: string;
  textPartId?: string;
  toolCallIdToApprovalId: Record<string, string>;
  turnId: string;
}

export function createStreamRunState(turnId: string): StreamRunState {
  return { toolCallIdToApprovalId: {}, turnId };
}

export function createTurnId(): string {
  return `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function startChunk(state: StreamRunState): BeeperUIMessageChunk {
  return {
    messageId: state.turnId,
    messageMetadata: { turn_id: state.turnId },
    type: "start",
  };
}

export function finishChunk(state: StreamRunState, finishReason = "stop"): BeeperUIMessageChunk {
  return {
    finishReason,
    messageMetadata: { finish_reason: finishReason, turn_id: state.turnId },
    type: "finish",
  };
}

export function mapPiMessageDelta(
  state: StreamRunState,
  delta: { kind: "text" | "thinking"; value: string }
): BeeperUIMessageChunk[] {
  if (delta.kind === "text") {
    return [...openTextPart(state), { delta: delta.value, id: state.textPartId!, type: "text-delta" }];
  }
  return [...openReasoningPart(state), { delta: delta.value, id: state.reasoningPartId!, type: "reasoning-delta" }];
}

export function closeOpenMessageParts(state: StreamRunState): BeeperUIMessageChunk[] {
  return [...closeReasoningPart(state), ...closeTextPart(state)];
}

export function openTextPart(state: StreamRunState): BeeperUIMessageChunk[] {
  if (state.textPartId) return [];
  state.textPartId = `text_${state.turnId}`;
  return [{ id: state.textPartId, type: "text-start" }];
}

export function closeTextPart(state: StreamRunState): BeeperUIMessageChunk[] {
  if (!state.textPartId) return [];
  const id = state.textPartId;
  delete state.textPartId;
  return [{ id, type: "text-end" }];
}

export function openReasoningPart(state: StreamRunState): BeeperUIMessageChunk[] {
  if (state.reasoningPartId) return [];
  state.reasoningPartId = `reasoning_${state.turnId}`;
  return [{ id: state.reasoningPartId, type: "reasoning-start" }];
}

export function closeReasoningPart(state: StreamRunState): BeeperUIMessageChunk[] {
  if (!state.reasoningPartId) return [];
  const id = state.reasoningPartId;
  delete state.reasoningPartId;
  return [{ id, type: "reasoning-end" }];
}

export function mapPiToolInput(event: {
  dynamic?: boolean;
  input?: unknown;
  startedAtMs?: number;
  toolCallId: string;
  toolName?: string;
}): BeeperUIMessageChunk {
  return {
    input: event.input,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    ...(event.dynamic !== undefined ? { dynamic: event.dynamic } : {}),
    ...(event.startedAtMs !== undefined ? { startedAtMs: event.startedAtMs } : {}),
    type: "tool-input-available",
  };
}

export function mapPiToolOutput(event: {
  completedAtMs?: number;
  error?: unknown;
  output?: unknown;
  preliminary?: boolean;
  toolCallId: string;
  toolName?: string;
}): BeeperUIMessageChunk {
  if (event.error !== undefined) {
    return {
      errorText: errorText(event.error),
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      ...(event.completedAtMs !== undefined ? { completedAtMs: event.completedAtMs } : {}),
      ...(event.preliminary !== undefined ? { preliminary: event.preliminary } : {}),
      type: "tool-output-error",
    };
  }
  return {
    output: event.output,
    preliminary: event.preliminary,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    ...(event.completedAtMs !== undefined ? { completedAtMs: event.completedAtMs } : {}),
    type: "tool-output-available",
  };
}

export function mapPiApprovalRequest(
  state: StreamRunState,
  event: { message?: string; toolCallId: string; toolName: string }
): BeeperUIMessageChunk {
  const approvalId = `approval_${event.toolCallId}`;
  state.toolCallIdToApprovalId[event.toolCallId] = approvalId;
  return {
    approvalId,
    message: event.message,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    type: "tool-approval-request",
  };
}

export function mapPiApprovalResponse(event: {
  approvalId: string;
  approved: boolean;
  approvedAlways?: boolean;
  toolCallId: string;
}): BeeperUIMessageChunk {
  return {
    approvalId: event.approvalId,
    approved: event.approved,
    approvedAlways: event.approvedAlways,
    toolCallId: event.toolCallId,
    type: "tool-approval-response",
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}
