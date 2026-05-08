export type BeeperUIMessageChunk = Record<string, unknown> & { type: string };

export interface StreamRunState {
  reasoningPartId?: string;
  seq: number;
  textPartId?: string;
  toolCallIdToApprovalId: Record<string, string>;
  turnId: string;
}

export function createStreamRunState(turnId: string): StreamRunState {
  return { seq: 1, toolCallIdToApprovalId: {}, turnId };
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
  const chunks: BeeperUIMessageChunk[] = [];
  if (delta.kind === "text") {
    state.textPartId ??= `text_${state.turnId}`;
    chunks.push({ id: state.textPartId, type: "text-start" });
    chunks.push({ delta: delta.value, id: state.textPartId, type: "text-delta" });
    return chunks;
  }
  state.reasoningPartId ??= `reasoning_${state.turnId}`;
  chunks.push({ id: state.reasoningPartId, type: "reasoning-start" });
  chunks.push({ delta: delta.value, id: state.reasoningPartId, type: "reasoning-delta" });
  return chunks;
}

export function closeOpenMessageParts(state: StreamRunState): BeeperUIMessageChunk[] {
  const chunks: BeeperUIMessageChunk[] = [];
  if (state.reasoningPartId) chunks.push({ id: state.reasoningPartId, type: "reasoning-end" });
  if (state.textPartId) chunks.push({ id: state.textPartId, type: "text-end" });
  return chunks;
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

export function withStreamEnvelope(state: StreamRunState, chunk: BeeperUIMessageChunk): Record<string, unknown> {
  return {
    "com.beeper.llm.deltas": [
      {
        parts: [chunk],
        seq: state.seq++,
        timestamp: Date.now(),
        turn_id: state.turnId,
      },
    ],
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error);
}
