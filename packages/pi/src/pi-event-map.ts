import {
  closeOpenMessageParts,
  closeReasoningPart,
  closeTextPart,
  createStreamRunState,
  finishChunk,
  mapPiMessageDelta,
  mapPiToolInput,
  mapPiToolOutput,
  openReasoningPart,
  openTextPart,
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
  if (!record) return [];
  const type = stringValue(record?.type) ?? stringValue(record?.kind);
  const contentIndex = typeof record?.contentIndex === "number" ? record.contentIndex : 0;
  const partial = recordValue(record?.partial);
  const content = Array.isArray(partial?.content) ? recordValue(partial.content[contentIndex]) : undefined;
  const genericDelta = stringValue(record?.delta);
  const textDelta = stringValue(record?.text_delta) ?? stringValue(record?.textDelta) ?? (type === "text_delta" ? genericDelta : undefined);
  const thinkingDelta =
    stringValue(record?.thinking_delta) ??
    stringValue(record?.thinkingDelta) ??
    stringValue(record?.reasoningDelta) ??
    (type === "thinking_delta" || type === "reasoning_delta" ? genericDelta : undefined);
  if (type === "text_start") return openTextPart(state);
  if (type === "text_delta" && textDelta) return mapPiMessageDelta(state, { kind: "text", value: textDelta });
  if (type === "text_end") return closeTextPart(state);
  if (type === "thinking_start" || type === "reasoning_start") return openReasoningPart(state);
  if ((type === "thinking_delta" || type === "reasoning_delta") && thinkingDelta) {
    return mapPiMessageDelta(state, { kind: "thinking", value: thinkingDelta });
  }
  if (type === "thinking_end" || type === "reasoning_end") return closeReasoningPart(state);
  if (type === "toolcall_start") {
    const toolCall = toolCallFromContent(record.toolCall, record.tool_call, record.call, content);
    if (!toolCall) return [];
    return [{ toolCallId: toolCall.id, toolName: toolCall.name, type: "tool-input-start" }];
  }
  if (type === "toolcall_delta") {
    const toolCall = toolCallFromContent(record.toolCall, record.tool_call, record.call, content, record);
    if (!toolCall || typeof record.delta !== "string") return [];
    return [{ inputTextDelta: record.delta, toolCallId: toolCall.id, type: "tool-input-delta" }];
  }
  if (type === "toolcall_end") {
    const toolCall = toolCallFromContent(record.toolCall, record.tool_call, record.call, content);
    if (!toolCall) return [];
    return [{ input: toolCall.arguments, toolCallId: toolCall.id, toolName: toolCall.name, type: "tool-input-available" }];
  }
  if (textDelta && !thinkingDelta) return mapPiMessageDelta(state, { kind: "text", value: textDelta });
  if (thinkingDelta) return mapPiMessageDelta(state, { kind: "thinking", value: thinkingDelta });
  return [];
}

function mapToolCall(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  const toolName = stringValue(event.toolName) ?? stringValue(event.name);
  if (!toolCallId) return [];
  return [mapPiToolInput({ input: event.input ?? event.args ?? parseMaybeJSONValue(event.arguments), toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolExecutionStart(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  const toolName = stringValue(event.toolName) ?? stringValue(event.name);
  if (!toolCallId) return [];
  return [mapPiToolInput({ input: event.args, toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolExecutionUpdate(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  const toolName = stringValue(event.toolName) ?? stringValue(event.name);
  if (!toolCallId) return [];
  return [mapPiToolOutput({ output: normalizeToolOutput(event.partialResult), preliminary: true, toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolExecutionEnd(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  const toolName = stringValue(event.toolName) ?? stringValue(event.name);
  if (!toolCallId) return [];
  if (event.isError === true) {
    return [mapPiToolOutput({ error: event.result, toolCallId, ...(toolName ? { toolName } : {}) })];
  }
  return [mapPiToolOutput({ output: normalizeToolOutput(event.result), toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolResult(event: Record<string, unknown>): BeeperUIMessageChunk[] {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  const toolName = stringValue(event.toolName) ?? stringValue(event.name);
  if (!toolCallId) return [];
  const result = event.content ?? event.result ?? event.output ?? event;
  if (event.isError === true) {
    return [mapPiToolOutput({ error: result, toolCallId, ...(toolName ? { toolName } : {}) })];
  }
  return [mapPiToolOutput({ output: normalizeToolOutput(result), toolCallId, ...(toolName ? { toolName } : {}) })];
}

function mapToolResultMessage(message: unknown): BeeperUIMessageChunk[] {
  const record = recordValue(message);
  const toolCallId = stringValue(record?.toolCallId);
  const toolName = stringValue(record?.toolName);
  if (!toolCallId) return [];
  if (record?.isError === true) {
    return [mapPiToolOutput({ error: record.content, toolCallId, ...(toolName ? { toolName } : {}) })];
  }
  return [mapPiToolOutput({ output: normalizeToolOutput(record?.content), toolCallId, ...(toolName ? { toolName } : {}) })];
}

function toolCallFromContent(...values: unknown[]): { id: string; name: string; arguments: unknown } | null {
  for (const value of values) {
    const record = recordValue(value);
    if (!record) continue;
    const type = stringValue(record.type);
    if (type && !["toolCall", "tool_call", "function_call"].includes(type)) continue;
    const id = stringValue(record.id) ?? stringValue(record.toolCallId) ?? stringValue(record.callId) ?? stringValue(record.call_id);
    const name = stringValue(record.name) ?? stringValue(record.toolName);
    if (!id) continue;
    return { id, name: name || "tool", arguments: parseMaybeJSONValue(record.arguments ?? record.args ?? record.input) };
  }
  return null;
}

function parseMaybeJSONValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeToolOutput(result: unknown): unknown {
  const record = recordValue(result);
  if (!record) return result;
  if (Object.keys(record).length === 1 && record.content !== undefined) return contentText(record.content);
  return result;
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    const record = recordValue(part);
    if (!record) return "";
    if (typeof record.text === "string") return record.text;
    if (typeof record.content === "string") return record.content;
    return "";
  }).join("");
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
