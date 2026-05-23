import type { MatrixStream } from "@beeper/pickle";

export type AGUIEvent = {
  type: string;
  [key: string]: unknown;
};

export type AGUIEventStream =
  | AsyncIterable<AGUIEvent>
  | ReadableStream<AGUIEvent>;

export interface AGUIEventStreamResult {
  toAGUIEventStream(): AGUIEventStream;
}

export function fromAGUIEventStream(stream: AGUIEventStream): MatrixStream {
  if (isAsyncIterable(stream)) {
    return stream;
  }
  return readableStreamToAsyncIterable(stream);
}

export function fromAGUIStreamResult(result: AGUIEventStreamResult): MatrixStream {
  return fromAGUIEventStream(result.toAGUIEventStream());
}

export function isAGUIEventStreamResult(value: unknown): value is AGUIEventStreamResult {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toAGUIEventStream?: unknown }).toAGUIEventStream === "function"
  );
}

async function* readableStreamToAsyncIterable(stream: ReadableStream<AGUIEvent>): AsyncIterable<AGUIEvent> {
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

function isAsyncIterable(value: AGUIEventStream): value is AsyncIterable<AGUIEvent> {
  return Symbol.asyncIterator in value;
}
