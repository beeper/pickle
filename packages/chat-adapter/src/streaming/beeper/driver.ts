import type { MatrixRawMessage } from "better-matrix-js";
import type { RawMessage, StreamOptions } from "chat";
import type { MatrixRawMessage as MatrixAdapterRawMessage } from "../../types";
import { isStreamChunk, normalizeStreamPart, readString, streamChunkText, streamPart } from "../chunks";
import type { MatrixStream, MatrixStreamDriver, MatrixStreamDriverOptions } from "../types";
import { BEEPER_STREAM_EVENT_TYPE, buildStreamDelta, clearStreamContent, streamDescriptorType } from "./envelope";

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
    const target = await this.#options.postMessage(threadId, "...", {
      "com.beeper.stream": stream.descriptor,
    });
    const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const textId = `text_${turnId}`;
    let seq = 1;
    let textStarted = false;
    let streamStarted = false;
    let streamFinished = false;
    let accumulated = "";

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
        streamStarted = true;
      }
      if (typeof chunk === "string") {
        if (!textStarted) {
          await this.#sendPart(turnId, seq++, { id: textId, type: "text-start" }, target.id, stream.descriptor, options);
          textStarted = true;
        }
        accumulated += chunk;
        await this.#sendPart(
          turnId,
          seq++,
          { delta: chunk, id: textId, type: "text-delta" },
          target.id,
          stream.descriptor,
          options
        );
        continue;
      }
      if (isStreamChunk(chunk) && chunk.type === "markdown_text") {
        if (!textStarted) {
          await this.#sendPart(turnId, seq++, { id: textId, type: "text-start" }, target.id, stream.descriptor, options);
          textStarted = true;
        }
        accumulated += chunk.text;
        await this.#sendPart(
          turnId,
          seq++,
          { delta: chunk.text, id: textId, type: "text-delta" },
          target.id,
          stream.descriptor,
          options
        );
        continue;
      }
      const part = normalizeStreamPart(streamPart(chunk), textId);
      if (readString(part, "type") === "start") {
        streamStarted = true;
      } else if (readString(part, "type") === "finish") {
        streamFinished = true;
      }
      accumulated += streamChunkText(part);
      await this.#sendPart(turnId, seq++, part, target.id, stream.descriptor, options);
    }

    if (textStarted) {
      await this.#sendPart(turnId, seq++, { id: textId, type: "text-end" }, target.id, stream.descriptor, options);
    }
    if (!streamFinished) {
      if (!streamStarted) {
        await this.#sendPart(
          turnId,
          seq++,
          { messageId: turnId, messageMetadata: { turn_id: turnId }, type: "start" },
          target.id,
          stream.descriptor,
          options
        );
      }
      await this.#sendPart(
        turnId,
        seq++,
        { finishReason: "stop", messageMetadata: { finish_reason: "stop", turn_id: turnId }, type: "finish" },
        target.id,
        stream.descriptor,
        options
      );
    }
    return accumulated
      ? this.#options.editMessage(threadId, target.id, accumulated, clearStreamContent())
      : target;
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
