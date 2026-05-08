import {
  closeOpenMessageParts,
  createStreamRunState,
  finishChunk,
  mapPiMessageDelta,
  mapPiToolInput,
  mapPiToolOutput,
  startChunk,
  type BeeperUIMessageChunk,
  type StreamRunState,
} from "./stream-map";

export interface PiEventMapper {
  readonly state: StreamRunState;
  map(event: unknown): BeeperUIMessageChunk[];
}

export function createPiEventMapper(turnId: string): PiEventMapper {
  const state = createStreamRunState(turnId);
  return {
    state,
    map: (event) => mapPiAgentSessionEvent(state, event),
  };
}

export function createPiEventMapState(turnId: string): StreamRunState {
  return createStreamRunState(turnId);
}

export function mapPiAgentSessionEventToBeeperChunks(state: StreamRunState, event: unknown): BeeperUIMessageChunk[] {
  return mapPiAgentSessionEvent(state, event);
}

export function mapPiAgentSessionEvent(state: StreamRunState, event: unknown): BeeperUIMessageChunk[] {
  const record = recordValue(event);
  const type = stringValue(record?.type);
  if (!record) return [];
  if (!type) return [];
  if (type === "message_start" && messageRole(record?.message) === "assistant") return [startChunk(state)];
  if (type === "message_update") return mapAssistantMessageEvent(state, record.assistantMessageEvent);
  if (type === "message_end" && messageRole(record.message) === "assistant") {
    return [...closeOpenMessageParts(state), finishChunk(state)];
  }
  if (type === "message_end" && messageRole(record.message) === "toolResult") return mapToolResultMessage(record.message);
  if (type === "tool_call") return mapToolCall(record);
  if (type === "tool_execution_start") return mapToolExecutionStart(record);
  if (type === "tool_execution_update") return mapToolExecutionUpdate(record);
  if (type === "tool_execution_end") return mapToolExecutionEnd(record);
  if (type === "tool_result") return mapToolResult(record);
  return [];
}

function mapAssistantMessageEvent(state: StreamRunState, event: unknown): BeeperUIMessageChunk[] {
  const record = recordValue(event);
  const type = stringValue(record?.type) ?? stringValue(record?.kind);
  const genericDelta = stringValue(record?.delta);
  const textDelta = stringValue(record?.text_delta) ?? stringValue(record?.textDelta) ?? (type === "text_delta" ? genericDelta : undefined);
  const thinkingDelta =
    stringValue(record?.thinking_delta) ??
    stringValue(record?.thinkingDelta) ??
    stringValue(record?.reasoningDelta) ??
    (type === "thinking_delta" || type === "reasoning_delta" ? genericDelta : undefined);
  if (type === "text_delta" && textDelta) return mapPiMessageDelta(state, { kind: "text", value: textDelta });
  if ((type === "thinking_delta" || type === "reasoning_delta") && thinkingDelta) {
    return mapPiMessageDelta(state, { kind: "thinking", value: thinkingDelta });
  }
  if (textDelta && !thinkingDelta) return mapPiMessageDelta(state, { kind: "text", value: textDelta });
  if (thinkingDelta) return mapPiMessageDelta(state, { kind: "thinking", value: thinkingDelta });
  return [];
}

function mapToolCall(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId);
  const toolName = stringValue(event.toolName);
  if (!toolCallId || !toolName) return [];
  return [mapPiToolInput({ input: event.input, toolCallId, toolName })];
}

function mapToolExecutionStart(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId);
  const toolName = stringValue(event.toolName);
  if (!toolCallId || !toolName) return [];
  return [mapPiToolInput({ input: event.args, toolCallId, toolName })];
}

function mapToolExecutionUpdate(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId);
  const toolName = stringValue(event.toolName);
  if (!toolCallId) return [];
  return [mapPiToolOutput({ output: event.partialResult, preliminary: true, toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolExecutionEnd(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId);
  const toolName = stringValue(event.toolName);
  if (!toolCallId) return [];
  if (event.isError === true) {
    return [mapPiToolOutput({ error: event.result, toolCallId, ...(toolName ? { toolName } : {}) })];
  }
  return [mapPiToolOutput({ output: event.result, toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolResult(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId);
  const toolName = stringValue(event.toolName);
  if (!toolCallId) return [];
  if (event.isError === true) {
    return [mapPiToolOutput({ error: event.content, toolCallId, ...(toolName ? { toolName } : {}) })];
  }
  return [mapPiToolOutput({ output: event.content, toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolResultMessage(message: unknown): BeeperUIMessageChunk[] {
  const record = recordValue(message);
  const toolCallId = stringValue(record?.toolCallId);
  const toolName = stringValue(record?.toolName);
  if (!toolCallId) return [];
  if (record?.isError === true) {
    return [mapPiToolOutput({ error: record.content, toolCallId, ...(toolName ? { toolName } : {}) })];
  }
  return [mapPiToolOutput({ output: record?.content, toolCallId, ...(toolName ? { toolName } : {}) })];
}

function messageRole(message: unknown): string | undefined {
  return stringValue(recordValue(message)?.role);
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
