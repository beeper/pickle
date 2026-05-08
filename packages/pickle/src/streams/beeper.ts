import type { MatrixBeeper, MatrixMessages } from "../client-types";
import { stripUndefined } from "../object";
import type { SendMatrixStreamOptions, SendMessageOptions, SentEvent } from "../types";
import { streamChunkText } from "./edits";

export async function sendBeeperStream(
  client: {
    beeper: MatrixBeeper;
    messages: MatrixMessages;
  },
  opts: SendMatrixStreamOptions
): Promise<SentEvent> {
  const stream = await client.beeper.streams.create({
    roomId: opts.roomId,
    streamType: "com.beeper.llm",
  });
  const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const targetOptions: SendMessageOptions = {
    content: {
      body: "...",
      "com.beeper.ai": { id: turnId, metadata: { turn_id: turnId }, parts: [], role: "assistant" },
      "com.beeper.stream": stream.descriptor,
      msgtype: "m.text",
    },
    messageType: "m.text" as const,
    roomId: opts.roomId,
    text: "...",
    ...(opts.threadRoot === undefined ? {} : { threadRoot: opts.threadRoot }),
  };
  const target = await client.messages.send(targetOptions);
  await client.beeper.streams.register({
    descriptor: stream.descriptor,
    eventId: target.eventId,
    roomId: opts.roomId,
  });
  const textId = `text_${turnId}`;
  const accumulator = createFinalMessageAccumulator(turnId);
  let seq = 1;
  let textOpen = false;
  let sawFinish = false;
  const pendingPublishes = new Set<Promise<void>>();
  const publishPart = (part: Record<string, unknown>) => {
    const publish = publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, part)
      .catch((error) => {
        console.warn("[pickle] failed to publish beeper stream part", error);
      })
      .finally(() => {
        pendingPublishes.delete(publish);
      });
    pendingPublishes.add(publish);
  };
  const waitForPublishes = async () => {
    while (pendingPublishes.size) await Promise.all([...pendingPublishes]);
  };
  const startPart = {
    messageId: turnId,
    messageMetadata: { turn_id: turnId },
    type: "start",
  };
  applyFinalMessagePart(accumulator, startPart);
  publishPart(startPart);
  for await (const chunk of opts.stream) {
    const normalizedChunks = normalizeRichStreamChunk(chunk);
    if (normalizedChunks.length > 0) {
      for (const normalizedChunk of normalizedChunks) {
        const type = typeof normalizedChunk.type === "string" ? normalizedChunk.type : "";
        if (type === "finish" || type === "error" || type === "abort") sawFinish = true;
        applyFinalMessagePart(accumulator, normalizedChunk);
        publishPart(normalizedChunk);
      }
      continue;
    }
    if (isStreamPart(chunk)) {
      const type = typeof chunk.type === "string" ? chunk.type : "";
      if (type === "finish" || type === "error" || type === "abort") sawFinish = true;
      applyFinalMessagePart(accumulator, chunk);
      publishPart(chunk);
      continue;
    }
    const text = streamChunkText(chunk);
    if (!text) continue;
    if (!textOpen) {
      const textStartPart = {
        id: textId,
        type: "text-start",
      };
      applyFinalMessagePart(accumulator, textStartPart);
      publishPart(textStartPart);
      textOpen = true;
    }
    const textDeltaPart = {
      delta: text,
      id: textId,
      type: "text-delta",
    };
    applyFinalMessagePart(accumulator, textDeltaPart);
    publishPart(textDeltaPart);
  }
  if (textOpen) {
    const textEndPart = {
      id: textId,
      type: "text-end",
    };
    applyFinalMessagePart(accumulator, textEndPart);
    publishPart(textEndPart);
  }
  if (!sawFinish) {
    const finishPart = {
      finishReason: "stop",
      messageMetadata: { finish_reason: "stop", turn_id: turnId },
      type: "finish",
    };
    applyFinalMessagePart(accumulator, finishPart);
    publishPart(finishPart);
  }
  await waitForPublishes();
  const finalAIMessage = opts.finalAIMessage ?? finalizeAccumulatedAIMessage(accumulator);
  const finalText = opts.finalText ?? getFinalMessageText(finalAIMessage);
  const replacement = await client.messages.edit({
    content: {
      body: finalText || "...",
      "com.beeper.ai": finalAIMessage,
      "com.beeper.stream": null,
      msgtype: "m.text",
    },
    eventId: target.eventId,
    messageType: "m.text",
    roomId: opts.roomId,
    text: finalText || "...",
    topLevelContent: {
      "com.beeper.dont_render_edited": true,
      "com.beeper.stream": null,
    },
  });
  return {
    ...replacement,
    eventId: target.eventId,
    raw: {
      logicalEventId: target.eventId,
      raw: replacement.raw,
      replacementEventId: replacement.eventId,
    },
  };
}

type FinalMessageAccumulator = {
  message: {
    id: string;
    metadata: Record<string, unknown>;
    parts: Record<string, unknown>[];
    role: "assistant";
  };
  reasoningIndexById: Map<string, number>;
  textIndexById: Map<string, number>;
  toolIndexByCallId: Map<string, number>;
  toolInputTextByCallId: Map<string, string>;
  toolNameByCallId: Map<string, string>;
  toolDynamicByCallId: Map<string, boolean>;
};

function createFinalMessageAccumulator(turnId: string): FinalMessageAccumulator {
  return {
    message: {
      id: turnId,
      metadata: { turn_id: turnId },
      parts: [],
      role: "assistant",
    },
    reasoningIndexById: new Map(),
    textIndexById: new Map(),
    toolIndexByCallId: new Map(),
    toolInputTextByCallId: new Map(),
    toolNameByCallId: new Map(),
    toolDynamicByCallId: new Map(),
  };
}

function applyFinalMessagePart(state: FinalMessageAccumulator, part: Record<string, unknown>): void {
  const type = typeof part.type === "string" ? part.type : "";
  const id = typeof part.id === "string" ? part.id : undefined;
  const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : undefined;
  const providerMetadata = part.providerMetadata;
  const mergeMetadata = (metadata: unknown) => {
    if (isRecord(metadata)) state.message.metadata = mergeRecords(state.message.metadata, metadata);
  };
  const ensureStreamingPart = (kind: "text" | "reasoning", indexById: Map<string, number>, partId: string) => {
    const existing = indexById.get(partId);
    if (existing !== undefined) return existing;
    const index = state.message.parts.length;
    state.message.parts.push(stripUndefined({
      providerMetadata,
      state: "streaming",
      text: "",
      type: kind,
    }));
    indexById.set(partId, index);
    return index;
  };
  const getPart = (index: number) => {
    const part = state.message.parts[index];
    if (!part) throw new Error(`missing accumulated message part at index ${index}`);
    return part;
  };
  const rememberTool = () => {
    if (!toolCallId) return;
    if (typeof part.toolName === "string" && part.toolName.trim()) state.toolNameByCallId.set(toolCallId, part.toolName);
    if (typeof part.dynamic === "boolean") state.toolDynamicByCallId.set(toolCallId, part.dynamic);
  };
  const ensureToolPart = () => {
    if (!toolCallId) return undefined;
    rememberTool();
    const existing = state.toolIndexByCallId.get(toolCallId);
    if (existing !== undefined) return existing;
    const toolName = state.toolNameByCallId.get(toolCallId) ?? "tool";
    const dynamic = state.toolDynamicByCallId.get(toolCallId) ?? false;
    const index = state.message.parts.length;
    state.message.parts.push(stripUndefined(dynamic ? {
      input: undefined,
      state: "input-streaming",
      toolCallId,
      toolName,
      type: "dynamic-tool",
    } : {
      input: undefined,
      state: "input-streaming",
      toolCallId,
      type: `tool-${toolName}`,
    }));
    state.toolIndexByCallId.set(toolCallId, index);
    return index;
  };

  switch (type) {
    case "start":
      if (typeof part.messageId === "string") state.message.id = part.messageId;
      mergeMetadata(part.messageMetadata);
      return;
    case "message-metadata":
      mergeMetadata(part.messageMetadata);
      return;
    case "text-start":
      if (id) ensureStreamingPart("text", state.textIndexById, id);
      return;
    case "text-delta": {
      if (!id || typeof part.delta !== "string") return;
      const textPart = getPart(ensureStreamingPart("text", state.textIndexById, id));
      textPart.text = `${typeof textPart.text === "string" ? textPart.text : ""}${part.delta}`;
      textPart.state = "streaming";
      return;
    }
    case "text-end": {
      if (!id) return;
      const textPart = getPart(ensureStreamingPart("text", state.textIndexById, id));
      textPart.state = "done";
      state.textIndexById.delete(id);
      return;
    }
    case "reasoning-start":
      if (id) ensureStreamingPart("reasoning", state.reasoningIndexById, id);
      return;
    case "reasoning-delta": {
      if (!id || typeof part.delta !== "string") return;
      const reasoningPart = getPart(ensureStreamingPart("reasoning", state.reasoningIndexById, id));
      reasoningPart.text = `${typeof reasoningPart.text === "string" ? reasoningPart.text : ""}${part.delta}`;
      reasoningPart.state = "streaming";
      return;
    }
    case "reasoning-end": {
      if (!id) return;
      const reasoningPart = getPart(ensureStreamingPart("reasoning", state.reasoningIndexById, id));
      reasoningPart.state = "done";
      state.reasoningIndexById.delete(id);
      return;
    }
    case "source-url":
    case "source-document":
    case "file":
    case "start-step":
      state.message.parts.push(finalPartFromChunk(part));
      return;
    case "finish-step":
      state.textIndexById.clear();
      state.reasoningIndexById.clear();
      return;
    case "tool-input-start": {
      const index = ensureToolPart();
      if (index === undefined || !toolCallId) return;
      const toolPart = getPart(index);
      toolPart.state = "input-streaming";
      toolPart.providerExecuted = part.providerExecuted;
      toolPart.callProviderMetadata = part.providerMetadata;
      if (part.title !== undefined) toolPart.title = part.title;
      state.toolInputTextByCallId.set(toolCallId, "");
      return;
    }
    case "tool-input-delta": {
      const index = ensureToolPart();
      if (index === undefined || !toolCallId || typeof part.inputTextDelta !== "string") return;
      const current = state.toolInputTextByCallId.get(toolCallId) ?? "";
      const next = current + part.inputTextDelta;
      state.toolInputTextByCallId.set(toolCallId, next);
      const toolPart = getPart(index);
      toolPart.state = "input-streaming";
      toolPart.input = parsePartialJson(next);
      return;
    }
    case "tool-input-available":
    case "tool-input-error": {
      const index = ensureToolPart();
      if (index === undefined) return;
      const toolPart = getPart(index);
      toolPart.state = type === "tool-input-error" ? "output-error" : "input-available";
      toolPart.input = part.input;
      toolPart.providerExecuted = part.providerExecuted;
      toolPart.callProviderMetadata = part.providerMetadata;
      if (part.errorText !== undefined) toolPart.errorText = part.errorText;
      if (part.title !== undefined) toolPart.title = part.title;
      if (part.startedAtMs !== undefined) toolPart.startedAtMs = part.startedAtMs;
      return;
    }
    case "tool-approval-request":
    case "tool-approval-response": {
      const index = ensureToolPart();
      if (index === undefined || typeof part.approvalId !== "string") return;
      const toolPart = getPart(index);
      toolPart.state = type === "tool-approval-request" ? "approval-requested" : "approval-responded";
      toolPart.approval = stripUndefined({
        approved: part.approved,
        id: part.approvalId,
        reason: part.reason,
      });
      return;
    }
    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied": {
      const index = ensureToolPart();
      if (index === undefined) return;
      const toolPart = getPart(index);
      toolPart.state = type === "tool-output-available" ? "output-available" : type === "tool-output-error" ? "output-error" : "output-denied";
      if (part.output !== undefined) toolPart.output = part.output;
      if (part.errorText !== undefined) toolPart.errorText = part.errorText;
      if (part.providerExecuted !== undefined) toolPart.providerExecuted = part.providerExecuted;
      if (part.preliminary !== undefined) toolPart.preliminary = part.preliminary;
      if (part.completedAtMs !== undefined) toolPart.completedAtMs = part.completedAtMs;
      return;
    }
    case "finish":
      mergeMetadata(part.messageMetadata);
      return;
    case "error":
      state.message.metadata = mergeRecords(state.message.metadata, {
        beeper_terminal_state: stripUndefined({ errorText: part.errorText, type: "error" }),
      });
      return;
    case "abort":
      state.message.metadata = mergeRecords(state.message.metadata, {
        beeper_terminal_state: { type: "abort" },
      });
      return;
    default:
      if (type.startsWith("data-") && part.transient !== true) applyDataPart(state.message.parts, part);
  }
}

function normalizeRichStreamChunk(chunk: string | Record<string, unknown>): Record<string, unknown>[] {
  if (!isRecord(chunk)) return [];
  if (isNativeStreamPartRecord(chunk)) return [];

  const type = typeof chunk.type === "string" ? chunk.type : "";
  if (type === "assistant-message-event" && isRecord(chunk.event)) {
    const mapped = uiChunkFromAssistantMessageEvent(chunk.event);
    return mapped ? [mapped] : [];
  }
  if (type === "agent-message-update" && isRecord(chunk.assistantMessageEvent)) {
    const mapped = uiChunkFromAssistantMessageEvent(chunk.assistantMessageEvent);
    return mapped ? [mapped] : [];
  }
  if (type === "agent-message-end" && isRecord(chunk.message)) {
    if (chunk.message.role === "toolResult") {
      const mapped = uiChunkFromToolResult(chunk.message);
      return mapped ? [mapped] : [];
    }
    return terminalChunksFromAssistantMessage(chunk.message);
  }
  if (type === "tool-call" || type === "tool_call") {
    const mapped = uiChunkFromToolCall(chunk);
    return mapped ? [mapped] : [];
  }
  if (type === "tool-result" || type === "tool_result") {
    const mapped = uiChunkFromToolResult(chunk);
    return mapped ? [mapped] : [];
  }
  if (type === "tool-execution-start" || type === "tool_execution_start") {
    const mapped = uiChunkFromToolExecutionStart(chunk);
    return mapped ? [mapped] : [];
  }
  if (type === "tool-execution-update" || type === "tool_execution_update") {
    const mapped = uiChunkFromToolExecutionUpdate(chunk);
    return mapped ? [mapped] : [];
  }
  if (type === "tool-execution-end" || type === "tool_execution_end") {
    const mapped = uiChunkFromToolExecutionEnd(chunk);
    return mapped ? [mapped] : [];
  }
  return [];
}

function uiChunkFromAssistantMessageEvent(event: Record<string, unknown>): Record<string, unknown> | null {
  const type = stringValue(event.type) ?? stringValue(event.kind) ?? "";
  const contentIndex = typeof event.contentIndex === "number" ? event.contentIndex : 0;
  const id = `content_${contentIndex}`;
  const partial = isRecord(event.partial) ? event.partial : undefined;
  const content = Array.isArray(partial?.content) ? partial.content[contentIndex] : undefined;
  const textDelta = stringValue(event.text_delta) ?? stringValue(event.textDelta) ?? (type === "text_delta" ? stringValue(event.delta) : undefined);
  const reasoningDelta =
    stringValue(event.thinking_delta) ??
    stringValue(event.thinkingDelta) ??
    stringValue(event.reasoning_delta) ??
    stringValue(event.reasoningDelta) ??
    (type === "thinking_delta" || type === "reasoning_delta" ? stringValue(event.delta) : undefined);

  switch (type) {
    case "text_start":
      return { id, type: "text-start" };
    case "text_delta":
      return textDelta ? { delta: textDelta, id, type: "text-delta" } : null;
    case "text_end":
      return { id, type: "text-end" };
    case "thinking_start":
    case "reasoning_start":
      return { id, type: "reasoning-start" };
    case "thinking_delta":
    case "reasoning_delta":
      return reasoningDelta ? { delta: reasoningDelta, id, type: "reasoning-delta" } : null;
    case "thinking_end":
    case "reasoning_end":
      return { id, type: "reasoning-end" };
    case "toolcall_start": {
      const toolCall = toolCallFromContent(event.toolCall, event.tool_call, event.call, content);
      return toolCall ? { dynamic: true, toolCallId: toolCall.id, toolName: toolCall.name, type: "tool-input-start" } : null;
    }
    case "toolcall_delta": {
      const toolCall = toolCallFromContent(event.toolCall, event.tool_call, event.call, content, event);
      return toolCall && typeof event.delta === "string"
        ? { inputTextDelta: event.delta, toolCallId: toolCall.id, type: "tool-input-delta" }
        : null;
    }
    case "toolcall_end": {
      const toolCall = toolCallFromContent(event.toolCall, event.tool_call, event.call, content);
      return toolCall
        ? { dynamic: true, input: toolCall.arguments, toolCallId: toolCall.id, toolName: toolCall.name, type: "tool-input-available" }
        : null;
    }
    default:
      return null;
  }
}

function uiChunkFromToolCall(event: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  const toolName = stringValue(event.toolName) ?? stringValue(event.name);
  if (!toolCallId) return null;
  return stripUndefined({
    dynamic: true,
    input: event.input ?? event.args ?? parseMaybeJSONValue(event.arguments),
    startedAtMs: Date.now(),
    toolCallId,
    toolName,
    type: "tool-input-available",
  });
}

function uiChunkFromToolExecutionStart(event: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  if (!toolCallId) return null;
  return stripUndefined({
    dynamic: true,
    input: event.args,
    startedAtMs: Date.now(),
    toolCallId,
    toolName: stringValue(event.toolName) ?? stringValue(event.name),
    type: "tool-input-available",
  });
}

function uiChunkFromToolExecutionUpdate(event: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  if (!toolCallId) return null;
  return stripUndefined({
    output: normalizeToolOutput(event.partialResult),
    preliminary: true,
    toolCallId,
    toolName: stringValue(event.toolName) ?? stringValue(event.name),
    type: "tool-output-available",
  });
}

function uiChunkFromToolExecutionEnd(event: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  if (!toolCallId) return null;
  const isError = event.isError === true;
  return stripUndefined({
    completedAtMs: Date.now(),
    errorText: isError ? toolResultText(event.result) || "Tool execution failed." : undefined,
    output: isError ? undefined : normalizeToolOutput(event.result),
    preliminary: false,
    toolCallId,
    toolName: stringValue(event.toolName) ?? stringValue(event.name),
    type: isError ? "tool-output-error" : "tool-output-available",
  });
}

function uiChunkFromToolResult(event: Record<string, unknown>): Record<string, unknown> | null {
  const toolCallId = stringValue(event.toolCallId) ?? stringValue(event.callId) ?? stringValue(event.id);
  if (!toolCallId) return null;
  const isError = event.isError === true;
  const result = event.content ?? event.result ?? event.output ?? event;
  return stripUndefined({
    completedAtMs: Date.now(),
    errorText: isError ? toolResultText(result) || "Tool execution failed." : undefined,
    output: isError ? undefined : normalizeToolOutput(result),
    preliminary: false,
    toolCallId,
    toolName: stringValue(event.toolName) ?? stringValue(event.name),
    type: isError ? "tool-output-error" : "tool-output-available",
  });
}

function terminalChunksFromAssistantMessage(message: Record<string, unknown>): Record<string, unknown>[] {
  if (message.role !== "assistant") return [];
  const metadata = metadataFromAssistantMessage(message);
  const stopReason = stringValue(message.stopReason) || "stop";
  if (stopReason === "error") {
    return [{ errorText: stringValue(message.errorMessage) || "Assistant response failed.", messageMetadata: metadata, type: "error" }];
  }
  if (stopReason === "aborted") {
    return [{ messageMetadata: metadata, type: "abort" }];
  }
  return [{ finishReason: stopReason, messageMetadata: metadata, type: "finish" }];
}

function metadataFromAssistantMessage(message: Record<string, unknown>): Record<string, unknown> {
  const stopReason = stringValue(message.stopReason) || "stop";
  return stripUndefined({
    diagnostics: Array.isArray(message.diagnostics) ? message.diagnostics : undefined,
    error: stringValue(message.errorMessage) ? { message: stringValue(message.errorMessage) } : undefined,
    finish_reason: stopReason,
    model: stringValue(message.model),
    provider: stringValue(message.provider),
    response_id: stringValue(message.responseId),
    response_model: stringValue(message.responseModel),
    response_status: stopReason === "error" ? "failed" : stopReason === "aborted" ? "cancelled" : "completed",
    usage: isRecord(message.usage) ? normalizeUsage(message.usage) : undefined,
  });
}

function normalizeUsage(usage: Record<string, unknown>): Record<string, unknown> {
  const input = numberValue(usage.input) ?? numberValue(usage.prompt_tokens) ?? numberValue(usage.promptTokens);
  const output = numberValue(usage.output) ?? numberValue(usage.completion_tokens) ?? numberValue(usage.completionTokens);
  return stripUndefined({
    ...usage,
    completion_tokens: output,
    context_limit: numberValue(usage.contextLimit) ?? numberValue(usage.context_limit),
    prompt_tokens: input,
  });
}

function toolCallFromContent(...values: unknown[]): { id: string; name: string; arguments: unknown } | null {
  for (const value of values) {
    if (!isRecord(value)) continue;
    const recordType = stringValue(value.type);
    if (recordType && !["toolCall", "tool_call", "function_call"].includes(recordType)) continue;
    const id = stringValue(value.id) ?? stringValue(value.toolCallId) ?? stringValue(value.callId) ?? stringValue(value.call_id);
    if (!id) continue;
    return {
      arguments: parseMaybeJSONValue(value.arguments ?? value.args ?? value.input),
      id,
      name: stringValue(value.name) ?? stringValue(value.toolName) ?? "tool",
    };
  }
  return null;
}

function normalizeToolOutput(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (Object.keys(result).length === 1 && result.content !== undefined) return contentText(result.content);
  return result;
}

function toolResultText(result: unknown): string {
  if (!isRecord(result)) return typeof result === "string" ? result : "";
  return contentText(result.content) || (typeof result.error === "string" ? result.error : "");
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "").filter(Boolean).join("\n");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseMaybeJSONValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value || undefined;
  }
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function finalPartFromChunk(part: Record<string, unknown>): Record<string, unknown> {
  if (part.type === "start-step") return { type: "step-start" };
  return stripUndefined({ ...part });
}

function applyDataPart(parts: Record<string, unknown>[], part: Record<string, unknown>): void {
  const type = typeof part.type === "string" ? part.type : "";
  const id = typeof part.id === "string" ? part.id : undefined;
  if (id) {
    const existing = parts.find((candidate) => candidate.type === type && candidate.id === id && "data" in candidate);
    if (existing) {
      existing.data = part.data;
      return;
    }
  }
  parts.push(stripUndefined({ data: part.data, id, type }));
}

function finalizeAccumulatedAIMessage(state: FinalMessageAccumulator): Record<string, unknown> {
  for (const index of state.textIndexById.values()) {
    const part = state.message.parts[index];
    if (part) part.state = "done";
  }
  for (const index of state.reasoningIndexById.values()) {
    const part = state.message.parts[index];
    if (part) part.state = "done";
  }
  state.textIndexById.clear();
  state.reasoningIndexById.clear();
  return {
    id: state.message.id,
    metadata: state.message.metadata,
    parts: state.message.parts,
    role: state.message.role,
  };
}

function getFinalMessageText(message: Record<string, unknown>): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeRecords(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  return { ...a, ...b };
}

function parsePartialJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text || undefined;
  }
}

function isStreamPart(chunk: string | Record<string, unknown>): chunk is Record<string, unknown> {
  return typeof chunk === "object"
    && chunk !== null
    && isNativeStreamPartRecord(chunk);
}

function isNativeStreamPartRecord(chunk: Record<string, unknown>): boolean {
  return typeof chunk.type === "string"
    && (NATIVE_STREAM_PART_TYPES.has(chunk.type) || chunk.type.startsWith("data-"));
}

const NATIVE_STREAM_PART_TYPES = new Set([
  "abort",
  "error",
  "file",
  "finish",
  "finish-step",
  "message-metadata",
  "reasoning-delta",
  "reasoning-end",
  "reasoning-start",
  "source-document",
  "source-url",
  "start-step",
  "text-delta",
  "text-end",
  "text-start",
  "tool-approval-request",
  "tool-approval-response",
  "tool-input-available",
  "tool-input-delta",
  "tool-input-error",
  "tool-input-start",
  "tool-output-available",
  "tool-output-denied",
  "tool-output-error",
]);

async function publishBeeperStreamPart(
  beeper: MatrixBeeper,
  roomId: string,
  eventId: string,
  descriptor: Record<string, unknown>,
  turnId: string,
  seq: number,
  part: Record<string, unknown>
): Promise<void> {
  const descriptorType = typeof descriptor.type === "string" ? descriptor.type : "com.beeper.llm";
  await beeper.streams.publish({
    content: {
      [`${descriptorType}.deltas`]: [{
        "m.relates_to": { event_id: eventId, rel_type: "m.reference" },
        part,
        seq,
        target_event: eventId,
        turn_id: turnId,
      }],
    },
    eventId,
    roomId,
  });
}
