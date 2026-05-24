import {
  closeOpenMessageParts,
  createStreamRunState,
  finishRunEvents,
  mapOpenClawApprovalRequest,
  mapOpenClawApprovalResponse,
  mapOpenClawMessageDelta,
  mapOpenClawToolInput,
  mapOpenClawToolInputDelta,
  mapOpenClawToolOutput,
  startRunEvents,
  AGUIEventType,
  type AGUIEvent,
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
): AGUIEvent[] {
  const record = recordValue(event);
  const rawType = stringValue(record?.type) ?? stringValue(record?.event);
  const type = normalizeOpenClawEventType(rawType, record);
  if (!record || !type) return [];
  const data = recordValue(record.data) ?? recordValue(record.payload) ?? record;
  const metadata = streamMetadata(record);

  switch (type) {
    case "run.created":
    case "run.queued":
    case "run.started":
      return startRunEvents(state, metadata);
    case "assistant.delta": {
      const delta = stringValue(data.delta) ?? stringValue(data.deltaText) ?? stringValue(data.text) ?? stringValue(data.content);
      return delta ? mapOpenClawMessageDelta(state, { kind: "text", value: delta }) : [];
    }
    case "assistant.message": {
      const text = stringValue(data.deltaText) ?? stringValue(data.text) ?? stringValue(data.content) ?? stringValue(data.message);
      return text ? mapOpenClawMessageDelta(state, { kind: "text", value: text }) : [];
    }
    case "thinking.delta": {
      const delta = stringValue(data.delta) ?? stringValue(data.text) ?? stringValue(data.content);
      return delta ? mapOpenClawMessageDelta(state, { kind: "thinking", value: delta }) : [];
    }
    case "tool.call.started":
      return mapOpenClawToolInput(toolInput(data));
    case "tool.call.delta": {
      const inputTextDelta = stringValue(data.delta) ?? stringValue(data.inputTextDelta);
      const input = inputTextDelta ? undefined : data.input ?? data.args ?? parseMaybeJSONValue(data.arguments);
      const delta: Parameters<typeof mapOpenClawToolInputDelta>[0] = {
        toolCallId: toolCallId(data),
      };
      const name = toolName(data);
      if (input !== undefined) delta.input = input;
      if (inputTextDelta !== undefined) delta.inputTextDelta = inputTextDelta;
      if (name !== undefined) delta.toolName = name;
      return mapOpenClawToolInputDelta(delta);
    }
    case "tool.call.completed":
      return mapOpenClawToolOutput(toolOutput(data));
    case "tool.call.failed":
      return mapOpenClawToolOutput({ ...toolOutput(data), error: data.error ?? data.message ?? data.output });
    case "approval.requested":
      return [mapOpenClawApprovalRequest(state, approvalRequest(data))];
    case "approval.resolved":
      return [mapOpenClawApprovalResponse(approvalResponse(data))];
    case "run.completed":
      return finishRunEvents(state, "stop", metadata);
    case "run.failed":
      return [...closeOpenMessageParts(state), { message: errorText(data.error ?? data.message ?? data), runId: state.turnId, type: AGUIEventType.RUN_ERROR }];
    case "run.cancelled":
      return [
        ...closeOpenMessageParts(state),
        {
          message: stringValue(data.reason) ?? "OpenClaw run cancelled.",
          reason: stringValue(data.reason),
          runId: state.turnId,
          terminalType: "abort",
          type: AGUIEventType.RUN_ERROR,
        } as AGUIEvent,
      ];
    case "run.timed_out":
      return [...closeOpenMessageParts(state), { message: "OpenClaw run timed out.", runId: state.turnId, type: AGUIEventType.RUN_ERROR }];
    default:
      return [];
  }
}

export function normalizeOpenClawEventType(type: string | undefined, event?: Record<string, unknown>): string | undefined {
  if (!type) return undefined;
  const payload = recordValue(event?.payload) ?? recordValue(event?.data) ?? event;
  const phase = stringValue(payload?.phase) ?? stringValue(payload?.status) ?? stringValue(payload?.kind);
  if (type === "chat") return "assistant.delta";
  if (type === "session.message") {
    const role = stringValue(payload?.role);
    if (role === "assistant") return "assistant.delta";
    if (role === "reasoning" || role === "thinking") return "thinking.delta";
    return "assistant.message";
  }
  if (type === "session.operation") {
    if (phase === "started" || phase === "queued" || phase === "running") return "run.started";
    if (phase === "completed" || phase === "complete" || phase === "done") return "run.completed";
    if (phase === "failed" || phase === "error") return "run.failed";
    if (phase === "cancelled" || phase === "canceled") return "run.cancelled";
    if (phase === "timed_out" || phase === "timeout") return "run.timed_out";
    return type;
  }
  if (type === "session.tool") {
    if (phase === "delta" || payload?.delta !== undefined || payload?.inputTextDelta !== undefined) return "tool.call.delta";
    if (phase === "completed" || phase === "complete" || phase === "result") return "tool.call.completed";
    if (phase === "failed" || phase === "error") return "tool.call.failed";
    return "tool.call.started";
  }
  if (type === "exec.approval.requested" || type === "plugin.approval.requested") return "approval.requested";
  if (type === "exec.approval.resolved" || type === "plugin.approval.resolved") return "approval.resolved";
  return type;
}

function streamMetadata(event: Record<string, unknown>): Record<string, unknown> {
  const payload = recordValue(event.payload) ?? recordValue(event.data);
  return stripUndefined({
    agent_id: stringValue(event.agentId) ?? stringValue(payload?.agentId),
    run_id: stringValue(event.runId) ?? stringValue(payload?.runId),
    session_id: stringValue(event.sessionId) ?? stringValue(payload?.sessionId),
    session_key: stringValue(event.sessionKey) ?? stringValue(payload?.sessionKey),
    task_id: stringValue(event.taskId) ?? stringValue(payload?.taskId),
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
  return stringValue(data.toolName) ?? stringValue(data.name) ?? stringValue(data.tool);
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
