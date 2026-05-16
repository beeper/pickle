import {
  closeOpenMessageParts,
  createStreamRunState,
  finishChunk,
  mapOpenClawApprovalRequest,
  mapOpenClawApprovalResponse,
  mapOpenClawMessageDelta,
  mapOpenClawToolInput,
  mapOpenClawToolOutput,
  startChunk,
  type BeeperUIMessageChunk,
  type StreamRunState,
} from "./stream-map";

type ToolInputChunkInput = Parameters<typeof mapOpenClawToolInput>[0];
type ToolOutputChunkInput = Parameters<typeof mapOpenClawToolOutput>[0];
type ApprovalRequestChunkInput = Parameters<typeof mapOpenClawApprovalRequest>[1];
type ApprovalResponseChunkInput = Parameters<typeof mapOpenClawApprovalResponse>[0];

export function createOpenClawStreamState(turnId: string): StreamRunState {
  return createStreamRunState(turnId);
}

export function mapOpenClawEventToBeeperChunks(
  state: StreamRunState,
  event: unknown
): BeeperUIMessageChunk[] {
  const record = recordValue(event);
  const type = stringValue(record?.type) ?? stringValue(record?.event);
  if (!record || !type) return [];
  const data = recordValue(record.data) ?? recordValue(record.payload) ?? record;
  const metadata = streamMetadata(record);

  switch (type) {
    case "run.created":
    case "run.queued":
    case "run.started":
      return [startChunk(state, metadata)];
    case "assistant.delta": {
      const delta = stringValue(data.delta) ?? stringValue(data.text) ?? stringValue(data.content);
      return delta ? mapOpenClawMessageDelta(state, { kind: "text", value: delta }) : [];
    }
    case "assistant.message": {
      const text = stringValue(data.text) ?? stringValue(data.content) ?? stringValue(data.message);
      return text ? mapOpenClawMessageDelta(state, { kind: "text", value: text }) : [];
    }
    case "thinking.delta": {
      const delta = stringValue(data.delta) ?? stringValue(data.text) ?? stringValue(data.content);
      return delta ? mapOpenClawMessageDelta(state, { kind: "thinking", value: delta }) : [];
    }
    case "tool.call.started":
      return [mapOpenClawToolInput(toolInput(data))];
    case "tool.call.delta": {
      const inputTextDelta = stringValue(data.delta) ?? stringValue(data.inputTextDelta);
      const input = inputTextDelta ? undefined : data.input ?? data.args ?? parseMaybeJSONValue(data.arguments);
      return [stripUndefined({
        dynamic: true,
        input,
        inputTextDelta,
        toolCallId: toolCallId(data),
        toolName: toolName(data),
        type: inputTextDelta ? "tool-input-delta" : "tool-input-available",
      })];
    }
    case "tool.call.completed":
      return [mapOpenClawToolOutput(toolOutput(data))];
    case "tool.call.failed":
      return [mapOpenClawToolOutput({ ...toolOutput(data), error: data.error ?? data.message ?? data.output })];
    case "approval.requested":
      return [mapOpenClawApprovalRequest(state, approvalRequest(data))];
    case "approval.resolved":
      return [mapOpenClawApprovalResponse(approvalResponse(data))];
    case "run.completed":
      return [...closeOpenMessageParts(state), finishChunk(state, "stop", metadata)];
    case "run.failed":
      return [...closeOpenMessageParts(state), { errorText: errorText(data.error ?? data.message ?? data), type: "error" }, finishChunk(state, "error", metadata)];
    case "run.cancelled":
      return [...closeOpenMessageParts(state), { reason: stringValue(data.reason), type: "abort" }, finishChunk(state, "cancelled", metadata)];
    case "run.timed_out":
      return [...closeOpenMessageParts(state), { errorText: "OpenClaw run timed out.", type: "error" }, finishChunk(state, "timeout", metadata)];
    default:
      return [];
  }
}

function streamMetadata(event: Record<string, unknown>): Record<string, unknown> {
  return stripUndefined({
    agent_id: stringValue(event.agentId),
    run_id: stringValue(event.runId),
    session_id: stringValue(event.sessionId),
    session_key: stringValue(event.sessionKey),
    task_id: stringValue(event.taskId),
  });
}

function toolInput(data: Record<string, unknown>): ToolInputChunkInput {
  const input: ToolInputChunkInput = { toolCallId: toolCallId(data) };
  const toolInputValue = data.input ?? data.args ?? parseMaybeJSONValue(data.arguments);
  const providerExecuted = booleanValue(data.providerExecuted);
  const startedAtMs = numberValue(data.startedAtMs);
  const title = stringValue(data.title);
  const name = toolName(data);
  if (toolInputValue !== undefined) input.input = toolInputValue;
  if (providerExecuted !== undefined) input.providerExecuted = providerExecuted;
  if (startedAtMs !== undefined) input.startedAtMs = startedAtMs;
  if (title !== undefined) input.title = title;
  if (name !== undefined) input.toolName = name;
  return input;
}

function toolOutput(data: Record<string, unknown>): ToolOutputChunkInput {
  const output: ToolOutputChunkInput = { toolCallId: toolCallId(data) };
  const completedAtMs = numberValue(data.completedAtMs);
  const outputValue = data.output ?? data.result ?? data.content;
  const preliminary = booleanValue(data.preliminary);
  const providerExecuted = booleanValue(data.providerExecuted);
  const name = toolName(data);
  if (completedAtMs !== undefined) output.completedAtMs = completedAtMs;
  if (outputValue !== undefined) output.output = outputValue;
  if (preliminary !== undefined) output.preliminary = preliminary;
  if (providerExecuted !== undefined) output.providerExecuted = providerExecuted;
  if (name !== undefined) output.toolName = name;
  return output;
}

function approvalRequest(data: Record<string, unknown>): ApprovalRequestChunkInput {
  const request: ApprovalRequestChunkInput = {};
  const approvalId = stringValue(data.approvalId) ?? stringValue(data.id);
  const message = stringValue(data.message) ?? stringValue(data.reason);
  const callId = stringValue(data.toolCallId) ?? stringValue(data.callId);
  const name = toolName(data);
  if (approvalId !== undefined) request.approvalId = approvalId;
  if (message !== undefined) request.message = message;
  if (callId !== undefined) request.toolCallId = callId;
  if (name !== undefined) request.toolName = name;
  return request;
}

function approvalResponse(data: Record<string, unknown>): ApprovalResponseChunkInput {
  const approvalId = stringValue(data.approvalId) ?? stringValue(data.id);
  if (!approvalId) throw new Error("OpenClaw approval.resolved event is missing approvalId");
  const response: ApprovalResponseChunkInput = {
    approvalId,
    approved: data.approved === true || data.decision === "approve" || data.decision === "allow",
    approvedAlways: data.approvedAlways === true || data.decision === "approve_always" || data.decision === "allow_always",
  };
  const callId = stringValue(data.toolCallId) ?? stringValue(data.callId);
  if (callId !== undefined) response.toolCallId = callId;
  return response;
}

function toolCallId(data: Record<string, unknown>): string {
  return stringValue(data.toolCallId) ?? stringValue(data.callId) ?? stringValue(data.id) ?? "tool_call";
}

function toolName(data: Record<string, unknown>): string | undefined {
  return stringValue(data.toolName) ?? stringValue(data.name);
}

function parseMaybeJSONValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}
