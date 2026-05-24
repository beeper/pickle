import { describe, expect, it } from "vitest";
import { fromAGUIEventStream, fromAGUIStreamResult, isAGUIEventStreamResult } from "./index";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("AG-UI stream adapters", () => {
  it("passes async iterable AG-UI events through structurally", async () => {
    async function* events() {
      yield { messageId: "message-1", role: "assistant", type: "TEXT_MESSAGE_START" };
      yield { delta: "hello", messageId: "message-1", type: "TEXT_MESSAGE_CONTENT" };
    }

    await expect(collect(fromAGUIEventStream(events()))).resolves.toEqual([
      { messageId: "message-1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "hello", messageId: "message-1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
  });

  it("converts ReadableStream AG-UI events to async iterable Matrix streams", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ runId: "run-1", threadId: "thread-1", type: "RUN_STARTED" });
        controller.enqueue({ delta: "thinking", messageId: "message-1", type: "REASONING_MESSAGE_CONTENT" });
        controller.close();
      },
    });

    await expect(collect(fromAGUIEventStream(stream))).resolves.toEqual([
      { runId: "run-1", threadId: "thread-1", type: "RUN_STARTED" },
      { delta: "thinking", messageId: "message-1", type: "REASONING_MESSAGE_CONTENT" },
    ]);
  });

  it("accepts AG-UI stream results with toAGUIEventStream", async () => {
    const result = {
      toAGUIEventStream() {
        return new ReadableStream({
          start(controller) {
            controller.enqueue({ finishReason: "stop", runId: "run-1", threadId: "thread-1", type: "RUN_FINISHED" });
            controller.close();
          },
        });
      },
    };

    expect(isAGUIEventStreamResult(result)).toBe(true);
    await expect(collect(fromAGUIStreamResult(result))).resolves.toEqual([
      { finishReason: "stop", runId: "run-1", threadId: "thread-1", type: "RUN_FINISHED" },
    ]);
  });
});
