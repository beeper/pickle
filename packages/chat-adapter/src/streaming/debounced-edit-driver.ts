import type { RawMessage, StreamOptions } from "chat";
import type { MatrixRawMessage } from "../types";
import { streamChunkText } from "./chunks";
import type { MatrixStream, MatrixStreamDriver, MatrixStreamDriverOptions } from "./types";

export class DebouncedEditStreamDriver implements MatrixStreamDriver {
  #options: MatrixStreamDriverOptions;

  constructor(options: MatrixStreamDriverOptions) {
    this.#options = options;
  }

  async stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixRawMessage>> {
    const intervalMs = options?.updateIntervalMs ?? 500;
    let message: RawMessage<MatrixRawMessage> | null = null;
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
