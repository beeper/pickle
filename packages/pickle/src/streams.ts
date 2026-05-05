import type { MatrixBeeper, MatrixMessages, MatrixStreams } from "./client-types";
import { stripUndefined } from "./object";
import type { MatrixClientOptions, SendMatrixStreamOptions, SendMessageOptions, SentEvent } from "./types";

export function createMatrixStreams(options: {
  beeper: MatrixBeeper;
  clientOptions: MatrixClientOptions;
  messages: MatrixMessages;
}): MatrixStreams {
  return {
    send: (opts) => sendStream(options, opts),
  };
}

async function sendStream(
  client: {
    beeper: MatrixBeeper;
    clientOptions: MatrixClientOptions;
    messages: MatrixMessages;
  },
  opts: SendMatrixStreamOptions
): Promise<SentEvent> {
  const mode = opts.mode ?? "auto";
  if (mode !== "edits" && (mode === "beeper" || supportsBeeperFeatures(client.clientOptions))) {
    return sendBeeperStream(client, opts);
  }
  return sendEditStream(client.messages, opts);
}

async function sendEditStream(messages: MatrixMessages, opts: SendMatrixStreamOptions): Promise<SentEvent> {
  const intervalMs = opts.updateIntervalMs ?? 500;
  let message: SentEvent | null = null;
  let accumulated = opts.text ?? "";
  let lastFlushed = "";
  let lastFlushAt = 0;
  if (accumulated) {
    message = await messages.send(stripUndefined({
      roomId: opts.roomId,
      text: accumulated,
      threadRoot: opts.threadRoot,
    }));
    lastFlushed = accumulated;
    lastFlushAt = Date.now();
  }
  for await (const chunk of opts.stream) {
    const text = streamChunkText(chunk);
    if (!text) continue;
    accumulated += text;
    if (!message) {
      message = await messages.send(stripUndefined({
        roomId: opts.roomId,
        text: accumulated,
        threadRoot: opts.threadRoot,
      }));
      lastFlushed = accumulated;
      lastFlushAt = Date.now();
      continue;
    }
    if (Date.now() - lastFlushAt >= intervalMs && accumulated !== lastFlushed) {
      message = await messages.edit({
        eventId: message.eventId,
        roomId: opts.roomId,
        text: accumulated,
      });
      lastFlushed = accumulated;
      lastFlushAt = Date.now();
    }
  }
  if (!message) {
    return messages.send(stripUndefined({
      roomId: opts.roomId,
      text: "...",
      threadRoot: opts.threadRoot,
    }));
  }
  if (accumulated !== lastFlushed) {
    const replacement = await messages.edit({
      eventId: message.eventId,
      roomId: opts.roomId,
      text: accumulated,
    });
    return {
      ...replacement,
      eventId: message.eventId,
      raw: {
        logicalEventId: message.eventId,
        raw: replacement.raw,
        replacementEventId: replacement.eventId,
      },
    };
  }
  return message;
}

async function sendBeeperStream(
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
  const startPart = {
    messageId: turnId,
    messageMetadata: { turn_id: turnId },
    type: "start",
  };
  applyFinalMessagePart(accumulator, startPart);
  await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, startPart);
  for await (const chunk of opts.stream) {
    if (isStreamPart(chunk)) {
      const type = typeof chunk.type === "string" ? chunk.type : "";
      if (type === "finish" || type === "error" || type === "abort") sawFinish = true;
      applyFinalMessagePart(accumulator, chunk);
      await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, chunk);
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
      await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, textStartPart);
      textOpen = true;
    }
    const textDeltaPart = {
      delta: text,
      id: textId,
      type: "text-delta",
    };
    applyFinalMessagePart(accumulator, textDeltaPart);
    await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, textDeltaPart);
  }
  if (textOpen) {
    const textEndPart = {
      id: textId,
      type: "text-end",
    };
    applyFinalMessagePart(accumulator, textEndPart);
    await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, textEndPart);
  }
  if (!sawFinish) {
    const finishPart = {
      finishReason: "stop",
      messageMetadata: { finish_reason: "stop", turn_id: turnId },
      type: "finish",
    };
    applyFinalMessagePart(accumulator, finishPart);
    await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, finishPart);
  }
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
    && typeof chunk.type === "string"
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

const BEEPER_DOMAINS = new Set([
  "beeper.com",
  "beeper-staging.com",
  "beeper-dev.com",
  "beeper.localtest.me",
]);

function isBeeperHomeserver(homeserverUrl: string): boolean {
  try {
    const hostname = new URL(homeserverUrl).hostname;
    return BEEPER_DOMAINS.has(hostname) || [...BEEPER_DOMAINS].some((domain) => hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function supportsBeeperFeatures(options: MatrixClientOptions): boolean {
  const homeserver = options.account?.homeserver ?? options.homeserver;
  return options.beeper ?? (homeserver ? isBeeperHomeserver(homeserver) : false);
}

function streamChunkText(chunk: string | Record<string, unknown>): string {
  if (typeof chunk === "string") return chunk;
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.delta === "string") return chunk.delta;
  if (typeof chunk.markdown === "string") return chunk.markdown;
  return "";
}
