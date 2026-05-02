import type { MatrixCore } from "better-matrix-js";
import type { RawMessage, StreamChunk, StreamOptions } from "chat";
import type { MatrixRawMessage } from "../types";

export type MatrixStream = AsyncIterable<string | StreamChunk | Record<string, unknown>>;

export interface MatrixStreamDriver {
  stream(
    threadId: string,
    textStream: MatrixStream,
    options?: StreamOptions
  ): Promise<RawMessage<MatrixRawMessage>>;
}

export interface MatrixStreamDriverOptions {
  core: MatrixCore;
  editMessage(
    threadId: string,
    messageId: string,
    message: string,
    content?: Record<string, unknown>
  ): Promise<RawMessage<MatrixRawMessage>>;
  homeserverUrl: string;
  postMessage(
    threadId: string,
    message: string,
    content?: Record<string, unknown>
  ): Promise<RawMessage<MatrixRawMessage>>;
  roomId: string;
}
