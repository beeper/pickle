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

export function startChunk(state: StreamRunState, metadata: Record<string, unknown> = {}): BeeperUIMessageChunk {
  return {
    messageId: state.turnId,
    messageMetadata: { turn_id: state.turnId, ...metadata },
    type: "start",
  };
}

export function finishChunk(
  state: StreamRunState,
  finishReason = "stop",
  metadata: Record<string, unknown> = {}
): BeeperUIMessageChunk {
  return {
    finishReason,
    messageMetadata: { finish_reason: finishReason, turn_id: state.turnId, ...metadata },
    type: "finish",
  };
}

export function mapOpenClawMessageDelta(
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

export function mapOpenClawToolInput(event: {
  dynamic?: boolean;
  input?: unknown;
  providerExecuted?: boolean;
  startedAtMs?: number;
  title?: string;
  toolCallId: string;
  toolName?: string;
}): BeeperUIMessageChunk {
  return stripUndefined({
    dynamic: event.dynamic ?? true,
    input: event.input,
    providerExecuted: event.providerExecuted,
    startedAtMs: event.startedAtMs,
    title: event.title,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    type: "tool-input-available",
  });
}

export function mapOpenClawToolOutput(event: {
  completedAtMs?: number;
  error?: unknown;
  output?: unknown;
  preliminary?: boolean;
  providerExecuted?: boolean;
  toolCallId: string;
  toolName?: string;
}): BeeperUIMessageChunk {
  if (event.error !== undefined) {
    return stripUndefined({
      dynamic: true,
      errorText: errorText(event.error),
      preliminary: event.preliminary,
      providerExecuted: event.providerExecuted,
      completedAtMs: event.completedAtMs,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      type: "tool-output-error",
    });
  }
  return stripUndefined({
    dynamic: true,
    output: event.output,
    preliminary: event.preliminary,
    providerExecuted: event.providerExecuted,
    completedAtMs: event.completedAtMs,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    type: "tool-output-available",
  });
}

export function mapOpenClawApprovalRequest(
  state: StreamRunState,
  event: { approvalId?: string; message?: string; toolCallId?: string; toolName?: string }
): BeeperUIMessageChunk {
  const toolCallId = event.toolCallId ?? event.approvalId ?? "approval";
  const approvalId = event.approvalId ?? `approval_${toolCallId}`;
  state.toolCallIdToApprovalId[toolCallId] = approvalId;
  return stripUndefined({
    approvalId,
    message: event.message,
    toolCallId,
    toolName: event.toolName,
    type: "tool-approval-request",
  });
}

export function mapOpenClawApprovalResponse(event: {
  approvalId: string;
  approved: boolean;
  approvedAlways?: boolean;
  toolCallId?: string;
}): BeeperUIMessageChunk {
  return stripUndefined({
    approvalId: event.approvalId,
    approved: event.approved,
    approvedAlways: event.approvedAlways,
    toolCallId: event.toolCallId,
    type: "tool-approval-response",
  });
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}
