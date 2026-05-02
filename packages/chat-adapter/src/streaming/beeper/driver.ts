import type { MatrixRawMessage } from "better-matrix-js";
import type { RawMessage, StreamOptions } from "chat";
import type { MatrixRawMessage as MatrixAdapterRawMessage } from "../../types";
import { isStreamChunk, normalizeStreamPart, readString, streamChunkText, streamParts } from "../chunks";
import type { MatrixStream, MatrixStreamDriver, MatrixStreamDriverOptions } from "../types";
import { BEEPER_STREAM_EVENT_TYPE, aiMessageContent, buildStreamDelta, clearStreamContent, streamDescriptorType } from "./envelope";

export class BeeperStreamDriver implements MatrixStreamDriver {
  #options: MatrixStreamDriverOptions;

  constructor(options: MatrixStreamDriverOptions) {
    this.#options = options;
  }

  async stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixAdapterRawMessage>> {
    const stream = await this.#options.core.createBeeperStream({
      roomId: this.#options.roomId,
      streamType: BEEPER_STREAM_EVENT_TYPE,
    });
    const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    this.#options.logger?.debug("Beeper stream created", {
      descriptor: summarizeDescriptor(stream.descriptor),
      roomId: this.#options.roomId,
      turnId,
    });
    const target = await this.#options.postMessage(threadId, "...", {
      "com.beeper.ai": aiMessageContent(turnId),
      "com.beeper.stream": stream.descriptor,
    });
    this.#options.logger?.debug("Beeper stream target posted", {
      eventId: target.id,
      roomId: this.#options.roomId,
      turnId,
    });
    await this.#options.core.registerBeeperStream({
      descriptor: stream.descriptor,
      eventId: target.id,
      roomId: this.#options.roomId,
    });
    this.#options.logger?.debug("Beeper stream registered", {
      descriptor: summarizeDescriptor(stream.descriptor),
      eventId: target.id,
      roomId: this.#options.roomId,
      turnId,
    });
    const textId = `text_${turnId}`;
    let seq = 1;
    let textStarted = false;
    let streamStarted = false;
    let streamFinished = false;
    let accumulated = "";
    const startedToolCallIds = new Set<string>();
    const recorder = new UIMessageRecorder(turnId);

    for await (const chunk of textStream) {
      const explicitType = typeof chunk === "string" ? undefined : readString(chunk, "type");
      if (!streamStarted && explicitType !== "start") {
        await this.#sendPart(
          turnId,
          seq++,
          { messageId: turnId, messageMetadata: { turn_id: turnId }, type: "start" },
          target.id,
          stream.descriptor,
          options
        );
        recorder.apply({ messageId: turnId, messageMetadata: { turn_id: turnId }, type: "start" });
        streamStarted = true;
      }
      if (typeof chunk === "string") {
        if (!textStarted) {
          const part = { id: textId, type: "text-start" };
          await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
          recorder.apply(part);
          textStarted = true;
        }
        accumulated += chunk;
        const part = { delta: chunk, id: textId, type: "text-delta" };
        await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
        recorder.apply(part);
        continue;
      }
      if (isStreamChunk(chunk) && chunk.type === "markdown_text") {
        if (!textStarted) {
          const part = { id: textId, type: "text-start" };
          await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
          recorder.apply(part);
          textStarted = true;
        }
        accumulated += chunk.text;
        const part = { delta: chunk.text, id: textId, type: "text-delta" };
        await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
        recorder.apply(part);
        continue;
      }
      for (const rawPart of streamParts(chunk)) {
        const part = normalizeStreamPart(rawPart, textId);
        const partType = readString(part, "type");
        if (partType === "tool-input-start") {
          const toolCallId = readString(part, "toolCallId");
          if (toolCallId) {
            if (startedToolCallIds.has(toolCallId)) {
              this.#options.logger?.debug("Beeper stream skipped duplicate tool start", {
                roomId: this.#options.roomId,
                toolCallId,
                turnId,
              });
              continue;
            }
            startedToolCallIds.add(toolCallId);
          }
        }
        if (partType === "start") {
          streamStarted = true;
        } else if (partType === "finish") {
          streamFinished = true;
        }
        accumulated += streamChunkText(part);
        await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
        recorder.apply(part);
      }
    }

    if (textStarted) {
      const part = { id: textId, type: "text-end" };
      await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
      recorder.apply(part);
    }
    if (!streamFinished) {
      if (!streamStarted) {
        const part = { messageId: turnId, messageMetadata: { turn_id: turnId }, type: "start" };
        await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
        recorder.apply(part);
      }
      const part = { finishReason: "stop", messageMetadata: { finish_reason: "stop", turn_id: turnId }, type: "finish" };
      await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
      recorder.apply(part);
    }
    if (!accumulated) {
      return target;
    }
    const persistedParts = recorder.snapshotParts();
    this.#options.logger?.debug("Beeper stream finalizing persisted message", {
      eventId: target.id,
      partTypes: persistedParts.map((part) => readString(part, "type")),
      roomId: this.#options.roomId,
      toolStates: persistedParts
        .filter((part) => readString(part, "type") === "dynamic-tool")
        .map((part) => ({
          state: readString(part, "state"),
          toolCallId: readString(part, "toolCallId"),
          toolName: readString(part, "toolName"),
        })),
      turnId,
    });
    const edited = await this.#options.editMessage(threadId, target.id, accumulated, clearStreamContent(turnId, persistedParts));
    this.#options.logger?.debug("Beeper stream finalized", {
      replacementEventId: edited.id,
      targetEventId: target.id,
      turnId,
    });
    return edited;
  }

  async #sendPart(
    turnId: string,
    seq: number,
    part: Record<string, unknown>,
    targetEventId: string,
    descriptor: Record<string, unknown>,
    options?: StreamOptions
  ): Promise<MatrixRawMessage> {
    const delta = buildStreamDelta(turnId, seq, part, targetEventId, options);
    this.#options.logger?.debug("Beeper stream publish part", {
      eventId: targetEventId,
      part: summarizePart(part),
      roomId: this.#options.roomId,
      seq,
      turnId,
    });
    await this.#options.core.publishBeeperStream({
      content: {
        [`${streamDescriptorType(descriptor)}.deltas`]: [delta],
      },
      eventId: targetEventId,
      roomId: this.#options.roomId,
    });
    return { eventId: targetEventId, raw: {}, roomId: this.#options.roomId };
  }
}

function summarizeDescriptor(descriptor: Record<string, unknown>): Record<string, unknown> {
  return {
    device_id: descriptor.device_id,
    type: descriptor.type,
    user_id: descriptor.user_id,
  };
}

function summarizePart(part: Record<string, unknown>): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    type: part.type,
  };
  for (const key of ["id", "toolCallId", "toolName", "title", "providerExecuted", "dynamic", "finishReason"]) {
    if (part[key] !== undefined) {
      summary[key] = part[key];
    }
  }
  if (typeof part.delta === "string") {
    summary.deltaLength = part.delta.length;
  }
  if (part.input && typeof part.input === "object") {
    summary.inputKeys = Object.keys(part.input as Record<string, unknown>);
  }
  if (part.output !== undefined) {
    summary.outputType = typeof part.output;
  }
  if (part.errorText !== undefined) {
    summary.errorText = part.errorText;
  }
  return summary;
}

class UIMessageRecorder {
  readonly #message: { id: string; metadata: Record<string, unknown>; parts: Record<string, unknown>[]; role: "assistant" };
  readonly #textIndexById = new Map<string, number>();
  readonly #reasoningIndexById = new Map<string, number>();
  readonly #toolIndexByCallId = new Map<string, number>();
  readonly #toolInputTextByCallId = new Map<string, string>();
  readonly #toolNameByCallId = new Map<string, string>();

  constructor(turnId: string) {
    this.#message = { id: turnId, metadata: { turn_id: turnId }, parts: [], role: "assistant" };
  }

  apply(part: Record<string, unknown>): void {
    const type = readString(part, "type");
    switch (type) {
      case "start":
      case "finish":
      case "message-metadata":
        this.#mergeMetadata(readRecord(part.messageMetadata));
        break;
      case "text-start":
        this.#startStreamingText(part, this.#textIndexById, "text");
        break;
      case "text-delta":
        this.#appendStreamingText(part, this.#textIndexById, "text");
        break;
      case "text-end":
        this.#finishStreamingText(part, this.#textIndexById, "text");
        break;
      case "reasoning-start":
        this.#startStreamingText(part, this.#reasoningIndexById, "reasoning");
        break;
      case "reasoning-delta":
        this.#appendStreamingText(part, this.#reasoningIndexById, "reasoning");
        break;
      case "reasoning-end":
        this.#finishStreamingText(part, this.#reasoningIndexById, "reasoning");
        break;
      case "source-url":
      case "source-document":
      case "file":
        this.#message.parts.push(clone(part) as Record<string, unknown>);
        break;
      case "start-step":
        this.#message.parts.push({ type: "step-start" });
        break;
      case "finish-step":
        this.#textIndexById.clear();
        this.#reasoningIndexById.clear();
        break;
      case "tool-input-start":
        this.#toolPart(part).state = "input-streaming";
        this.#toolPart(part).input = "";
        this.#toolInputTextByCallId.set(readString(part, "toolCallId") ?? "", "");
        break;
      case "tool-input-delta": {
        const toolCallId = readString(part, "toolCallId") ?? "";
        const toolPart = this.#toolPart(part);
        const next = (this.#toolInputTextByCallId.get(toolCallId) ?? "") + (readString(part, "inputTextDelta") ?? "");
        this.#toolInputTextByCallId.set(toolCallId, next);
        toolPart.state = "input-streaming";
        toolPart.input = parseJsonOrString(next);
        break;
      }
      case "tool-input-available": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "input-available";
        toolPart.input = clone(part.input);
        break;
      }
      case "tool-input-error": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "output-error";
        toolPart.input = clone(part.input);
        toolPart.errorText = readString(part, "errorText") ?? "";
        if (part.providerExecuted !== undefined) toolPart.providerExecuted = part.providerExecuted;
        break;
      }
      case "tool-approval-request": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "approval-requested";
        toolPart.approval = { id: readString(part, "approvalId") ?? "" };
        break;
      }
      case "tool-approval-response": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "approval-responded";
        toolPart.approval = {
          approved: part.approved === true,
          id: readString(part, "approvalId") ?? "",
          ...(readString(part, "reason") ? { reason: readString(part, "reason") } : {}),
        };
        break;
      }
      case "tool-output-available": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "output-available";
        toolPart.output = clone(part.output);
        if (part.providerExecuted !== undefined) toolPart.providerExecuted = part.providerExecuted;
        if (part.preliminary !== undefined) {
          toolPart.preliminary = part.preliminary;
        } else {
          delete toolPart.preliminary;
        }
        break;
      }
      case "tool-output-error": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "output-error";
        toolPart.errorText = readString(part, "errorText") ?? "";
        if (part.providerExecuted !== undefined) toolPart.providerExecuted = part.providerExecuted;
        break;
      }
      case "tool-output-denied": {
        const toolPart = this.#toolPart(part);
        toolPart.state = "output-denied";
        break;
      }
      default:
        if (type?.startsWith("data-") && part.transient !== true) {
          this.#message.parts.push(clone(part) as Record<string, unknown>);
        }
    }
  }

  snapshotParts(): unknown[] {
    return clone(this.#message.parts) as unknown[];
  }

  #startStreamingText(part: Record<string, unknown>, indexById: Map<string, number>, type: "text" | "reasoning"): void {
    const id = readString(part, "id");
    if (!id || indexById.has(id)) return;
    indexById.set(id, this.#message.parts.length);
    this.#message.parts.push({ state: "streaming", text: "", type });
  }

  #appendStreamingText(part: Record<string, unknown>, indexById: Map<string, number>, type: "text" | "reasoning"): void {
    const id = readString(part, "id");
    if (!id) return;
    if (!indexById.has(id)) this.#startStreamingText({ id }, indexById, type);
    const existing = this.#message.parts[indexById.get(id) ?? -1];
    if (!existing) return;
    existing.state = "streaming";
    existing.text = String(existing.text ?? "") + (readString(part, "delta") ?? "");
  }

  #finishStreamingText(part: Record<string, unknown>, indexById: Map<string, number>, type: "text" | "reasoning"): void {
    const id = readString(part, "id");
    if (!id) return;
    if (!indexById.has(id)) this.#startStreamingText({ id }, indexById, type);
    const existing = this.#message.parts[indexById.get(id) ?? -1];
    if (existing) existing.state = "done";
    indexById.delete(id);
  }

  #toolPart(part: Record<string, unknown>): Record<string, unknown> {
    const toolCallId = readString(part, "toolCallId") ?? "";
    const toolName = readString(part, "toolName") ?? this.#toolNameByCallId.get(toolCallId) ?? "tool";
    if (toolCallId) this.#toolNameByCallId.set(toolCallId, toolName);
    const existingIndex = this.#toolIndexByCallId.get(toolCallId);
    if (existingIndex !== undefined) {
      const existing = this.#message.parts[existingIndex];
      if (!existing) {
        this.#toolIndexByCallId.delete(toolCallId);
        return this.#toolPart(part);
      }
      existing.toolName = toolName;
      this.#applyToolMetadata(existing, part);
      return existing;
    }
    const next = {
      input: "",
      state: "input-streaming",
      toolCallId,
      toolName,
      type: "dynamic-tool",
    };
    this.#applyToolMetadata(next, part);
    this.#toolIndexByCallId.set(toolCallId, this.#message.parts.length);
    this.#message.parts.push(next);
    return next;
  }

  #applyToolMetadata(target: Record<string, unknown>, part: Record<string, unknown>): void {
    if (part.title !== undefined) target.title = part.title;
    if (part.providerExecuted !== undefined) target.providerExecuted = part.providerExecuted;
    if (part.providerMetadata !== undefined) target.callProviderMetadata = clone(part.providerMetadata);
  }

  #mergeMetadata(metadata: Record<string, unknown> | undefined): void {
    if (!metadata) return;
    this.#message.metadata = { ...this.#message.metadata, ...metadata };
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function clone(value: unknown): unknown {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function parseJsonOrString(value: string): unknown {
  if (!value.trim()) return "";
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
