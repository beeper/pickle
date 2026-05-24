import type { MatrixStream } from "@beeper/pickle";
export { EventType } from "@ag-ui/core";
export type {
  AGUIEvent,
  CustomEvent,
  ReasoningEndEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningMessageStartEvent,
  ReasoningStartEvent,
  RunErrorEvent,
  RunFinishedEvent,
  RunStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  ToolCallStartEvent,
} from "@tanstack/ai";
export type { MessagePart, UIMessage } from "@tanstack/ai-client";

import type { AGUIEvent } from "@tanstack/ai";

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
