import { describe, expect, it } from "vitest";
import { fromAIStreamResult, fromAIUIMessageStream, isAIUIMessageStreamResult } from "./index";

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

describe("AI SDK stream adapters", () => {
  it("passes async iterable UI message chunks through structurally", async () => {
    async function* chunks() {
      yield { delta: "hello", id: "text-1", type: "text-delta" };
    }

    await expect(collect(fromAIUIMessageStream(chunks()))).resolves.toEqual([
      { delta: "hello", id: "text-1", type: "text-delta" },
    ]);
  });

  it("converts ReadableStream UI message chunks to async iterable Matrix streams", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ id: "reasoning-1", type: "reasoning-start" });
        controller.enqueue({ delta: "thinking", id: "reasoning-1", type: "reasoning-delta" });
        controller.close();
      },
    });

    await expect(collect(fromAIUIMessageStream(stream))).resolves.toEqual([
      { id: "reasoning-1", type: "reasoning-start" },
      { delta: "thinking", id: "reasoning-1", type: "reasoning-delta" },
    ]);
  });

  it("accepts streamText-like results with toUIMessageStream", async () => {
    const result = {
      toUIMessageStream() {
        return new ReadableStream({
          start(controller) {
            controller.enqueue({ finishReason: "stop", type: "finish" });
            controller.close();
          },
        });
      },
    };

    expect(isAIUIMessageStreamResult(result)).toBe(true);
    await expect(collect(fromAIStreamResult(result))).resolves.toEqual([
      { finishReason: "stop", type: "finish" },
    ]);
  });
});
