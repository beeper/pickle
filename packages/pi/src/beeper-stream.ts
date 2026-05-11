import type { MatrixBeeper, MatrixMessages, SentEvent } from "@beeper/pickle";
import { SerialQueue } from "./serial";
import { createTurnId, type BeeperUIMessageChunk } from "./stream-map";

export interface BeeperStreamPublisherClient {
  beeper: MatrixBeeper;
  messages: Pick<MatrixMessages, "edit" | "get" | "send">;
}

export interface CreateBeeperStreamPublisherOptions {
  client: BeeperStreamPublisherClient;
  initialMessageMetadata?: Record<string, unknown>;
  roomId: string;
  targetEventId?: string;
  threadRoot?: string;
  turnId?: string;
}

export interface BeeperStreamStartResult {
  descriptor: Record<string, unknown>;
  eventId: string;
  turnId: string;
}

export interface BeeperStreamFinalizeOptions {
  body?: string;
  finalText?: string;
  finishReason?: string;
  messageMetadata?: Record<string, unknown>;
  message?: Record<string, unknown>;
  terminalPart?: BeeperUIMessageChunk;
}

const MAX_MATRIX_EVENT_CONTENT_BYTES = 60 * 1024;

export class BeeperStreamPublisher {
  readonly roomId: string;
  readonly turnId: string;
  #accumulator: FinalMessageAccumulator;
  #client: BeeperStreamPublisherClient;
  #descriptor: Record<string, unknown> | undefined;
  #finalized = false;
  #initialMessageMetadata: Record<string, unknown>;
  #queue = new SerialQueue();
  #seq = 1;
  #targetEventId: string | undefined;
  #threadRoot: string | undefined;

  constructor(options: CreateBeeperStreamPublisherOptions) {
    this.#client = options.client;
    this.#initialMessageMetadata = options.initialMessageMetadata ?? {};
    this.roomId = options.roomId;
    this.turnId = options.turnId ?? createTurnId();
    this.#targetEventId = options.targetEventId;
    this.#threadRoot = options.threadRoot;
    this.#accumulator = createFinalMessageAccumulator(this.turnId);
  }

  get targetEventId(): string | undefined {
    return this.#targetEventId;
  }

  async start(): Promise<BeeperStreamStartResult> {
    return this.#queue.run(() => this.#start());
  }

  async publish(part: BeeperUIMessageChunk): Promise<void> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
      const { eventId: targetEventId } = await this.#start();
      await this.#publishPart(targetEventId, part);
    });
  }

  async publishMany(parts: Iterable<BeeperUIMessageChunk>): Promise<void> {
    return this.#queue.run(async () => {
      for (const part of parts) {
        if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
        const { eventId: targetEventId } = await this.#start();
        await this.#publishPart(targetEventId, part);
      }
    });
  }

  async error(error: unknown): Promise<void> {
    await this.publish({ errorText: errorText(error), type: "error" });
  }

  async abort(reason?: string): Promise<void> {
    await this.publish({ ...(reason ? { reason } : {}), type: "abort" });
  }

  async finalize(options: BeeperStreamFinalizeOptions = {}): Promise<SentEvent> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Beeper stream is already finalized");
      const finishReason = options.finishReason ?? "stop";
      const { eventId: targetEventId } = await this.#start();
      await this.#publishPart(targetEventId, options.terminalPart ?? {
          finishReason,
          messageMetadata: { finish_reason: finishReason, turn_id: this.turnId, ...options.messageMetadata },
          type: "finish",
        });
      const finalAIMessage = options.message ?? finalizeAccumulatedAIMessage(this.#accumulator);
      const finalText = options.body ?? options.finalText ?? getFinalMessageText(finalAIMessage);
      const finalContent = compactFinalContent({
        aiMessage: finalAIMessage,
        body: finalText,
      });
      const replacement = await this.#client.messages.edit({
        content: {
          body: finalContent.body || "...",
          "com.beeper.ai": finalContent.aiMessage,
          "com.beeper.stream": null,
          msgtype: "m.text",
        },
        eventId: targetEventId,
        messageType: "m.text",
        roomId: this.roomId,
        text: finalContent.body || "...",
        topLevelContent: {
          "com.beeper.dont_render_edited": true,
          "com.beeper.stream": null,
        },
      });
      this.#finalized = true;
      return {
        ...replacement,
        eventId: targetEventId,
        raw: {
          logicalEventId: targetEventId,
          raw: replacement.raw,
          replacementEventId: replacement.eventId,
        },
      };
    });
  }

  async #start(): Promise<BeeperStreamStartResult> {
    if (this.#targetEventId && this.#descriptor) {
      return { descriptor: this.#descriptor, eventId: this.#targetEventId, turnId: this.turnId };
    }
    if (this.#targetEventId) {
      const { message } = await this.#client.messages.get({ eventId: this.#targetEventId, roomId: this.roomId });
      const descriptor = message?.content["com.beeper.stream"];
      if (!isRecord(descriptor)) {
        throw new Error(`Target message ${this.#targetEventId} does not contain a Beeper stream descriptor`);
      }
      this.#descriptor = descriptor;
      return { descriptor, eventId: this.#targetEventId, turnId: this.turnId };
    }
    const stream = await this.#client.beeper.streams.create({ roomId: this.roomId, streamType: "com.beeper.llm" });
    this.#descriptor = stream.descriptor;
    const target = await this.#client.messages.send({
      content: {
        body: "...",
        "com.beeper.ai": { id: this.turnId, metadata: { turn_id: this.turnId, ...this.#initialMessageMetadata }, parts: [], role: "assistant" },
        "com.beeper.stream": stream.descriptor,
        msgtype: "m.text",
      },
      messageType: "m.text",
      roomId: this.roomId,
      text: "...",
      ...(this.#threadRoot ? { threadRoot: this.#threadRoot } : {}),
    });
    this.#targetEventId = target.eventId;
    await this.#client.beeper.streams.register({
      descriptor: stream.descriptor,
      eventId: target.eventId,
      roomId: this.roomId,
    });
    await this.#publishPart(target.eventId, { messageId: this.turnId, messageMetadata: { turn_id: this.turnId, ...this.#initialMessageMetadata }, type: "start" });
    return { descriptor: stream.descriptor, eventId: target.eventId, turnId: this.turnId };
  }

  async #publishPart(targetEventId: string, part: BeeperUIMessageChunk): Promise<void> {
    const descriptorType = descriptorTypeOf(this.#descriptor);
    const seq = this.#seq;
    await this.#client.beeper.streams.publish({
      content: {
        [`${descriptorType}.deltas`]: [
          {
            "m.relates_to": { event_id: targetEventId, rel_type: "m.reference" },
            part,
            seq,
            target_event: targetEventId,
            turn_id: this.turnId,
          },
        ],
      },
      eventId: targetEventId,
      roomId: this.roomId,
    });
    this.#seq = seq + 1;
    applyFinalMessagePart(this.#accumulator, part);
  }
}

type FinalMessageAccumulator = {
  message: { id: string; metadata: Record<string, unknown>; parts: Record<string, unknown>[]; role: "assistant" };
  reasoningIndexById: Map<string, number>;
  textIndexById: Map<string, number>;
  toolIndexByCallId: Map<string, number>;
  toolInputTextByCallId: Map<string, string>;
  toolNameByCallId: Map<string, string>;
};

function createFinalMessageAccumulator(turnId: string): FinalMessageAccumulator {
  return {
    message: { id: turnId, metadata: { turn_id: turnId }, parts: [], role: "assistant" },
    reasoningIndexById: new Map(),
    textIndexById: new Map(),
    toolIndexByCallId: new Map(),
    toolInputTextByCallId: new Map(),
    toolNameByCallId: new Map(),
  };
}

function compactFinalContent(options: { aiMessage: Record<string, unknown>; body: string }): { aiMessage: Record<string, unknown>; body: string } {
  if (eventContentBytes(options.aiMessage, options.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return options;

  const compact = compactAIMessage(options.aiMessage, { keepToolInput: true, maxTextChars: options.body.length });
  if (eventContentBytes(compact, options.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return { aiMessage: compact, body: options.body };

  const toolCallsOnly = compactAIMessage(options.aiMessage, { keepToolInput: false, maxTextChars: options.body.length });
  if (eventContentBytes(toolCallsOnly, options.body) <= MAX_MATRIX_EVENT_CONTENT_BYTES) return { aiMessage: toolCallsOnly, body: options.body };

  const maxTextChars = Math.max(0, Math.floor((MAX_MATRIX_EVENT_CONTENT_BYTES - eventContentBytes(toolCallsOnly, "")) / 2) - 1024);
  const body = truncateWithNotice(options.body, maxTextChars);
  return {
    aiMessage: compactAIMessage(options.aiMessage, { keepToolInput: false, maxTextChars }),
    body,
  };
}

function eventContentBytes(aiMessage: Record<string, unknown>, body: string): number {
  return Buffer.byteLength(JSON.stringify({
    body: body || "...",
    "com.beeper.ai": aiMessage,
    "com.beeper.stream": null,
    msgtype: "m.text",
  }));
}

function compactAIMessage(
  message: Record<string, unknown>,
  options: { keepToolInput: boolean; maxTextChars: number },
): Record<string, unknown> {
  return {
    id: message.id,
    metadata: compactMetadata(isRecord(message.metadata) ? message.metadata : {}),
    parts: compactParts(Array.isArray(message.parts) ? message.parts : [], options),
    role: message.role,
  };
}

function compactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  return copyDefined({
    turn_id: metadata.turn_id,
    finish_reason: metadata.finish_reason,
    response_status: metadata.response_status,
    usage: metadata.usage,
    context_limit: metadata.context_limit,
    contextLimit: metadata.contextLimit,
  });
}

function compactParts(parts: unknown[], options: { keepToolInput: boolean; maxTextChars: number }): Record<string, unknown>[] {
  return parts
    .filter(isRecord)
    .flatMap((part) => {
      if (part.type === "text") {
        return [copyDefined({
          state: part.state,
          text: typeof part.text === "string" ? truncateWithNotice(part.text, options.maxTextChars) : part.text,
          type: part.type,
        })];
      }
      if (part.type === "dynamic-tool" || (typeof part.type === "string" && part.type.startsWith("tool-"))) {
        return [copyDefined({
          input: options.keepToolInput ? part.input : undefined,
          state: part.state,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          type: part.type,
        })];
      }
      return [];
    });
}

function truncateWithNotice(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  if (maxChars <= 0) return "";
  const limitKiB = Math.floor(MAX_MATRIX_EVENT_CONTENT_BYTES / 1024);
  const notice = `\n\n[Matrix event compacted: text truncated to fit the ${limitKiB} KiB event content limit.]`;
  return `${value.slice(0, Math.max(0, maxChars - notice.length))}${notice}`;
}

function copyDefined(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function applyFinalMessagePart(state: FinalMessageAccumulator, part: Record<string, unknown>): void {
  const type = typeof part.type === "string" ? part.type : "";
  const id = typeof part.id === "string" ? part.id : undefined;
  const toolCallId = typeof part.toolCallId === "string" ? part.toolCallId : undefined;
  switch (type) {
    case "start":
      if (typeof part.messageId === "string") state.message.id = part.messageId;
      if (isRecord(part.messageMetadata)) state.message.metadata = { ...state.message.metadata, ...part.messageMetadata };
      return;
    case "text-start":
      if (id) ensureTextPart(state, id);
      return;
    case "text-delta":
      if (id && typeof part.delta === "string") {
        const textPart = state.message.parts[ensureTextPart(state, id)];
        if (textPart) textPart.text = `${textPart.text ?? ""}${part.delta}`;
      }
      return;
    case "text-end":
      if (id) {
        const textPart = state.message.parts[ensureTextPart(state, id)];
        if (textPart) textPart.state = "done";
        state.textIndexById.delete(id);
      }
      return;
    case "reasoning-start":
      if (id) ensureReasoningPart(state, id);
      return;
    case "reasoning-delta":
      if (id && typeof part.delta === "string") {
        const reasoningPart = state.message.parts[ensureReasoningPart(state, id)];
        if (reasoningPart) reasoningPart.text = `${reasoningPart.text ?? ""}${part.delta}`;
      }
      return;
    case "reasoning-end":
      if (id) {
        const reasoningPart = state.message.parts[ensureReasoningPart(state, id)];
        if (reasoningPart) reasoningPart.state = "done";
        state.reasoningIndexById.delete(id);
      }
      return;
    case "tool-input-available":
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied":
    case "tool-approval-request":
    case "tool-approval-response":
      applyToolPart(state, part, type, toolCallId);
      return;
    case "finish":
      if (isRecord(part.messageMetadata)) state.message.metadata = { ...state.message.metadata, ...part.messageMetadata };
      return;
    case "error":
    case "abort":
      state.message.metadata = { ...state.message.metadata, beeper_terminal_state: { type, errorText: part.errorText } };
      return;
  }
}

function ensureTextPart(state: FinalMessageAccumulator, id: string): number {
  return ensurePart(state.message.parts, state.textIndexById, id, { state: "streaming", text: "", type: "text" });
}

function ensureReasoningPart(state: FinalMessageAccumulator, id: string): number {
  return ensurePart(state.message.parts, state.reasoningIndexById, id, { state: "streaming", text: "", type: "reasoning" });
}

function ensurePart(
  parts: Record<string, unknown>[],
  indexById: Map<string, number>,
  id: string,
  initial: Record<string, unknown>
): number {
  const existing = indexById.get(id);
  if (existing !== undefined) return existing;
  const index = parts.length;
  parts.push({ ...initial });
  indexById.set(id, index);
  return index;
}

function applyToolPart(
  state: FinalMessageAccumulator,
  part: Record<string, unknown>,
  type: string,
  toolCallId: string | undefined
): void {
  if (!toolCallId) return;
  if (typeof part.toolName === "string" && part.toolName.trim()) state.toolNameByCallId.set(toolCallId, part.toolName);
  const index = ensureToolPart(state, toolCallId);
  const toolPart = state.message.parts[index];
  if (!toolPart) return;
  if (type === "tool-input-start") {
    toolPart.state = "input-streaming";
    return;
  }
  if (type === "tool-input-delta") {
    toolPart.state = "input-streaming";
    if (typeof part.inputTextDelta === "string") {
      const next = `${state.toolInputTextByCallId.get(toolCallId) ?? ""}${part.inputTextDelta}`;
      state.toolInputTextByCallId.set(toolCallId, next);
      toolPart.input = parseMaybeJSON(next);
    }
    return;
  }
  if (part.input !== undefined) toolPart.input = part.input;
  if (part.output !== undefined) toolPart.output = part.output;
  if (part.errorText !== undefined) toolPart.errorText = part.errorText;
  if (part.preliminary !== undefined) toolPart.preliminary = part.preliminary;
  if (part.startedAtMs !== undefined) toolPart.startedAtMs = part.startedAtMs;
  if (part.completedAtMs !== undefined) toolPart.completedAtMs = part.completedAtMs;
  if (type === "tool-input-available") toolPart.state = "input-available";
  if (type === "tool-output-available") toolPart.state = "output-available";
  if (type === "tool-output-error") toolPart.state = "output-error";
  if (type === "tool-output-denied") toolPart.state = "output-denied";
  if (type === "tool-approval-request") toolPart.state = "approval-requested";
  if (type === "tool-approval-response") toolPart.state = "approval-responded";
}

function ensureToolPart(state: FinalMessageAccumulator, toolCallId: string): number {
  const existing = state.toolIndexByCallId.get(toolCallId);
  if (existing !== undefined) return existing;
  const toolName = state.toolNameByCallId.get(toolCallId) || "tool";
  const index = state.message.parts.length;
  state.message.parts.push({ input: undefined, state: "input-streaming", toolCallId, toolName, type: "dynamic-tool" });
  state.toolIndexByCallId.set(toolCallId, index);
  return index;
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
  return state.message;
}

function getFinalMessageText(message: Record<string, unknown>): string {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part): part is Record<string, unknown> => isRecord(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
}

function descriptorTypeOf(descriptor: Record<string, unknown> | undefined): string {
  return typeof descriptor?.type === "string" ? descriptor.type : "com.beeper.llm";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}

function parseMaybeJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text || undefined;
  }
}
