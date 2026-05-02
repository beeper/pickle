import type { MatrixCore, MatrixRawMessage } from "better-matrix-js";
import type { RawMessage, StreamChunk, StreamOptions } from "chat";
import type { MatrixRawMessage as MatrixAdapterRawMessage } from "./types";

const BEEPER_STREAM_EVENT_TYPE = "com.beeper.ai.stream_event";
const BEEPER_DOMAINS = new Set([
  "beeper.com",
  "beeper-staging.com",
  "beeper-dev.com",
  "beeper.localtest.me",
]);

export interface MatrixStreamDriver {
  stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixAdapterRawMessage>>;
}

export type MatrixStream = AsyncIterable<string | StreamChunk | Record<string, unknown>>;

export interface MatrixStreamDriverOptions {
  core: MatrixCore;
  editMessage(
    threadId: string,
    messageId: string,
    message: string
  ): Promise<RawMessage<MatrixAdapterRawMessage>>;
  homeserverUrl: string;
  postMessage(
    threadId: string,
    message: string,
    content?: Record<string, unknown>
  ): Promise<RawMessage<MatrixAdapterRawMessage>>;
  roomId: string;
}

export function isBeeperHomeserver(homeserverUrl: string): boolean {
  try {
    const hostname = new URL(homeserverUrl).hostname;
    return BEEPER_DOMAINS.has(hostname) || [...BEEPER_DOMAINS].some((domain) => hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

export function createMatrixStreamDriver(options: MatrixStreamDriverOptions): MatrixStreamDriver {
  return isBeeperHomeserver(options.homeserverUrl)
    ? new BeeperStreamDriver(options)
    : new DebouncedEditStreamDriver(options);
}

class BeeperStreamDriver implements MatrixStreamDriver {
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
    const target = await this.#options.postMessage(threadId, "...", {
      "com.beeper.stream": stream.descriptor,
    });
    const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const textId = `text_${turnId}`;
    let seq = 1;
    let textStarted = false;
    let accumulated = "";

    for await (const chunk of textStream) {
      if (typeof chunk === "string") {
        if (!textStarted) {
          await this.#sendPart(turnId, seq++, { id: textId, type: "text-start" }, target.id, options);
          textStarted = true;
        }
        accumulated += chunk;
        await this.#sendPart(turnId, seq++, { delta: chunk, id: textId, type: "text-delta" }, target.id, options);
        continue;
      }
      if (isStreamChunk(chunk) && chunk.type === "markdown_text") {
        if (!textStarted) {
          await this.#sendPart(turnId, seq++, { id: textId, type: "text-start" }, target.id, options);
          textStarted = true;
        }
        accumulated += chunk.text;
        await this.#sendPart(turnId, seq++, { delta: chunk.text, id: textId, type: "text-delta" }, target.id, options);
        continue;
      }
      await this.#sendPart(turnId, seq++, streamPart(chunk), target.id, options);
    }

    if (textStarted) {
      await this.#sendPart(turnId, seq++, { id: textId, type: "text-end" }, target.id, options);
    }
    return accumulated
      ? this.#options.editMessage(threadId, target.id, accumulated)
      : target;
  }

  async #sendPart(
    turnId: string,
    seq: number,
    part: Record<string, unknown>,
    targetEventId: string,
    options?: StreamOptions
  ): Promise<MatrixRawMessage> {
    await this.#options.core.publishBeeperStream({
      content: {
        "m.relates_to": {
          event_id: targetEventId,
          rel_type: "m.reference",
        },
        ...(options?.recipientUserId ? { agent_id: options.recipientUserId } : {}),
        part,
        seq,
        target_event: targetEventId,
        turn_id: turnId,
      },
      eventId: targetEventId,
      roomId: this.#options.roomId,
    });
    return { eventId: targetEventId, raw: {}, roomId: this.#options.roomId };
  }
}

class DebouncedEditStreamDriver implements MatrixStreamDriver {
  #options: MatrixStreamDriverOptions;

  constructor(options: MatrixStreamDriverOptions) {
    this.#options = options;
  }

  async stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixAdapterRawMessage>> {
    const intervalMs = options?.updateIntervalMs ?? 500;
    let message: RawMessage<MatrixAdapterRawMessage> | null = null;
    let accumulated = "";
    let lastFlushed = "";
    let lastFlushAt = 0;

    for await (const chunk of textStream) {
      const text = streamChunkText(chunk);
      if (!text) {
        continue;
      }
      accumulated += text;
      if (!message) {
        message = await this.#options.postMessage(threadId, accumulated);
        lastFlushed = accumulated;
        lastFlushAt = Date.now();
        continue;
      }
      if (Date.now() - lastFlushAt >= intervalMs && accumulated !== lastFlushed) {
        await this.#options.editMessage(threadId, message.id, accumulated);
        lastFlushed = accumulated;
        lastFlushAt = Date.now();
      }
    }

    if (!message) {
      return this.#options.postMessage(threadId, "...");
    }
    if (accumulated !== lastFlushed) {
      return this.#options.editMessage(threadId, message.id, accumulated);
    }
    return message;
  }
}

function streamChunkText(chunk: string | StreamChunk | Record<string, unknown>): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (isStreamChunk(chunk) && chunk.type === "markdown_text") {
    return chunk.text;
  }
  if (readString(chunk, "type") === "text-delta") {
    return readString(chunk, "text") ?? readString(chunk, "delta") ?? readString(chunk, "textDelta") ?? "";
  }
  return "";
}

function streamPart(chunk: StreamChunk | Record<string, unknown>): Record<string, unknown> {
  if (!isStreamChunk(chunk)) {
    return chunk;
  }
  switch (chunk.type) {
    case "markdown_text":
      return { delta: chunk.text, type: "text-delta" };
    case "task_update":
      return {
        data: {
          call_id: chunk.id,
          output: chunk.output,
          progress: chunk.output,
          status: chunk.status,
          tool_name: chunk.title,
        },
        transient: chunk.status === "pending" || chunk.status === "in_progress",
        type: "data-tool-progress",
      };
    case "plan_update":
      return {
        data: { title: chunk.title },
        transient: true,
        type: "data-plan-update",
      };
  }
}

function isStreamChunk(value: unknown): value is StreamChunk {
  const type = readString(value, "type");
  return type === "markdown_text" || type === "task_update" || type === "plan_update";
}

function readString(record: unknown, key: string): string | undefined {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
