import { stripUndefined } from "../object";

export const MAX_MATRIX_EVENT_CONTENT_BYTES = 60 * 1024;

export type BeeperFinalMessageAccumulator = {
  message: {
    id: string;
    metadata: Record<string, unknown>;
    parts: Record<string, unknown>[];
    role: "assistant";
  };
  reasoningIndexById: Map<string, number>;
  textIndexById: Map<string, number>;
  toolDynamicByCallId: Map<string, boolean>;
  toolIndexByCallId: Map<string, number>;
  toolInputTextByCallId: Map<string, string>;
  toolNameByCallId: Map<string, string>;
};

export function createFinalMessageAccumulator(turnId: string): BeeperFinalMessageAccumulator {
  return {
    message: {
      id: turnId,
      metadata: { turn_id: turnId },
      parts: [],
      role: "assistant",
    },
    reasoningIndexById: new Map(),
    textIndexById: new Map(),
    toolDynamicByCallId: new Map(),
    toolIndexByCallId: new Map(),
    toolInputTextByCallId: new Map(),
    toolNameByCallId: new Map(),
  };
}

export function applyFinalMessagePart(state: BeeperFinalMessageAccumulator, part: Record<string, unknown>): void {
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
      content: "",
      providerMetadata,
      state: "streaming",
      type: kind,
    }));
    indexById.set(partId, index);
    return index;
  };
  const getPart = (index: number) => {
    const messagePart = state.message.parts[index];
    if (!messagePart) throw new Error(`missing accumulated message part at index ${index}`);
    return messagePart;
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
    const index = state.message.parts.length;
    state.message.parts.push(stripUndefined({
      arguments: "",
      id: toolCallId,
      name: toolName,
      state: "awaiting-input",
      toolCallId,
      type: "tool-call",
    }));
    state.toolIndexByCallId.set(toolCallId, index);
    return index;
  };
  const updateToolLabel = (toolPart: Record<string, unknown>) => {
    const toolName = toolCallId ? state.toolNameByCallId.get(toolCallId) : undefined;
    if (!toolName) return;
    if (toolPart.type === "tool-call" && (toolPart.name === undefined || toolPart.name === "tool")) {
      toolPart.name = toolName;
    }
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
      textPart.content = `${typeof textPart.content === "string" ? textPart.content : ""}${part.delta}`;
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
      reasoningPart.content = `${typeof reasoningPart.content === "string" ? reasoningPart.content : ""}${part.delta}`;
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
      updateToolLabel(toolPart);
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
      updateToolLabel(toolPart);
      toolPart.state = "input-streaming";
      toolPart.arguments = next;
      toolPart.input = parsePartialJson(next);
      return;
    }
    case "tool-input-available":
    case "tool-input-error": {
      const index = ensureToolPart();
      if (index === undefined) return;
      const toolPart = getPart(index);
      updateToolLabel(toolPart);
      toolPart.state = type === "tool-input-error" ? "output-error" : "input-complete";
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
      updateToolLabel(toolPart);
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
      updateToolLabel(toolPart);
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
        beeper_terminal_state: stripUndefined({ reason: part.reason, type: "abort" }),
      });
      return;
    default:
      if (type.startsWith("data-") && part.transient !== true) applyDataPart(state.message.parts, part);
  }
}

export function finalizeAccumulatedAIMessage(state: BeeperFinalMessageAccumulator): Record<string, unknown> {
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

export function getFinalMessageText(message: Record<string, unknown>): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text" && (typeof part.content === "string" || typeof part.text === "string"))
    .map((part) => typeof part.content === "string" ? part.content : part.text)
    .join("");
}

export function compactFinalContent(options: { aiMessage: Record<string, unknown>; body: string }): { aiMessage: Record<string, unknown>; body: string } {
  if (eventContentBytes(options.aiMessage, options.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return options;

  const compact = compactAIMessage(options.aiMessage, { keepToolInput: true, textBudgetChars: Infinity });
  if (eventContentBytes(compact, options.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return { aiMessage: compact, body: options.body };

  const noToolInput = compactAIMessage(options.aiMessage, { keepToolInput: false, textBudgetChars: Infinity });
  if (eventContentBytes(noToolInput, options.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return { aiMessage: noToolInput, body: options.body };

  const totalTextChars = options.body.length + messageTextChars(noToolInput);
  let low = 0;
  let high = totalTextChars;
  let best = compactTextContent(noToolInput, options.body, 0);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = compactTextContent(noToolInput, options.body, mid);
    if (eventContentBytes(candidate.aiMessage, candidate.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (eventContentBytes(best.aiMessage, best.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return best;

  const minimal = minimalAIMessage(options.aiMessage);
  return eventContentBytes(minimal, "") <= MAX_MATRIX_EVENT_CONTENT_BYTES
    ? { aiMessage: minimal, body: "" }
    : { aiMessage: { id: options.aiMessage.id, metadata: {}, parts: [], role: options.aiMessage.role }, body: "" };
}

export function eventContentBytes(aiMessage: Record<string, unknown>, body: string): number {
  return new TextEncoder().encode(JSON.stringify({
    body: body || "...",
    "com.beeper.ai": aiMessage,
    "com.beeper.stream": null,
    msgtype: "m.text",
  })).byteLength;
}

function compactTextContent(aiMessage: Record<string, unknown>, body: string, textBudgetChars: number): { aiMessage: Record<string, unknown>; body: string } {
  const budget = { remaining: textBudgetChars };
  return {
    aiMessage: compactAIMessage(aiMessage, { budget, keepToolInput: false }),
    body: takeText(body, budget),
  };
}

function compactAIMessage(
  message: Record<string, unknown>,
  options: { budget?: { remaining: number }; keepToolInput: boolean; textBudgetChars?: number },
): Record<string, unknown> {
  const budget = options.budget ?? (
    options.textBudgetChars === Infinity ? undefined : { remaining: options.textBudgetChars ?? Infinity }
  );
  return {
    id: message.id,
    metadata: compactMetadata(isRecord(message.metadata) ? message.metadata : {}),
    parts: compactParts(Array.isArray(message.parts) ? message.parts : [], {
      keepToolInput: options.keepToolInput,
      ...(budget ? { budget } : {}),
    }),
    role: message.role,
  };
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return stripUndefined({
    beeper_terminal_state: metadata.beeper_terminal_state,
    context_limit: metadata.context_limit,
    contextLimit: metadata.contextLimit,
    finish_reason: metadata.finish_reason,
    response_status: metadata.response_status,
    turn_id: metadata.turn_id,
    usage: metadata.usage,
  });
}

function compactParts(parts: unknown[], options: { budget?: { remaining: number }; keepToolInput: boolean }): Record<string, unknown>[] {
  return parts
    .filter(isRecord)
    .flatMap((part) => {
      if (part.type === "text" || part.type === "reasoning") {
        const content = typeof part.content === "string" ? part.content : typeof part.text === "string" ? part.text : undefined;
        return [stripUndefined({
          content: typeof content === "string" ? takeText(content, options.budget) : content,
          state: part.state,
          type: part.type,
        })];
      }
      if (part.type === "tool-call" || part.type === "dynamic-tool" || (typeof part.type === "string" && part.type.startsWith("tool-"))) {
        return [stripUndefined({
          arguments: part.arguments,
          id: part.id ?? part.toolCallId,
          input: options.keepToolInput ? part.input : undefined,
          name: part.name ?? part.toolName,
          output: part.output,
          state: part.state,
          toolCallId: part.toolCallId,
          type: "tool-call",
        })];
      }
      return [];
    });
}

function takeText(value: string, budget?: { remaining: number }): string {
  if (!budget) return value;
  if (budget.remaining <= 0) return "";
  if (value.length <= budget.remaining) {
    budget.remaining -= value.length;
    return value;
  }
  const truncated = truncateWithNotice(value, budget.remaining);
  budget.remaining = 0;
  return truncated;
}

function truncateWithNotice(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 0) return "";
  const limitKiB = Math.floor(MAX_MATRIX_EVENT_CONTENT_BYTES / 1024);
  const notice = `\n\n[Matrix event compacted: text truncated to fit the ${limitKiB} KiB event content limit.]`;
  return `${value.slice(0, Math.max(0, maxChars - notice.length))}${notice.slice(0, maxChars)}`;
}

function messageTextChars(message: Record<string, unknown>): number {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts.reduce((total, part) => {
    if (!isRecord(part)) return total;
    const text = typeof part.content === "string" ? part.content : typeof part.text === "string" ? part.text : "";
    return total + text.length;
  }, 0);
}

function minimalAIMessage(message: Record<string, unknown>): Record<string, unknown> {
  const metadata = isRecord(message.metadata) ? message.metadata : {};
  return {
    id: message.id,
    metadata: stripUndefined({ turn_id: metadata.turn_id }),
    parts: [],
    role: message.role,
  };
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
