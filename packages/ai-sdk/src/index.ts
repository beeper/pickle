import type { MatrixStream } from "@better-matrix-js/chat-adapter";

export type AIUIMessageChunk = {
  type: string;
  [key: string]: unknown;
};

export type AIUIMessageChunkStream =
  | AsyncIterable<AIUIMessageChunk>
  | ReadableStream<AIUIMessageChunk>;

export interface AIUIMessageStreamResult {
  toUIMessageStream(): AIUIMessageChunkStream;
}

export function fromAIUIMessageStream(stream: AIUIMessageChunkStream): MatrixStream {
  if (isAsyncIterable(stream)) {
    return stream;
  }
  return readableStreamToAsyncIterable(stream);
}

export function fromAIStreamResult(result: AIUIMessageStreamResult): MatrixStream {
  return fromAIUIMessageStream(result.toUIMessageStream());
}

export function isAIUIMessageStreamResult(value: unknown): value is AIUIMessageStreamResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toUIMessageStream?: unknown }).toUIMessageStream === "function"
  );
}

async function* readableStreamToAsyncIterable(stream: ReadableStream<AIUIMessageChunk>): AsyncIterable<AIUIMessageChunk> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        return;
      }
      yield result.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function isAsyncIterable(value: AIUIMessageChunkStream): value is AsyncIterable<AIUIMessageChunk> {
  return Symbol.asyncIterator in value;
}
