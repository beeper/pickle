import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { BeeperStreamPublisher } from "./beeper-stream";

describe("Beeper stream publisher", () => {
  it("starts one native stream message and publishes AG-UI events through native transport", async () => {
    const { client, publishPart, startMessage } = createClient();
    const subscribers = [{ deviceId: "DESKTOP", userId: "@alice:example.com" }];
    const publisher = new BeeperStreamPublisher({
      client,
      initialMessageMetadata: { model: "test" },
      roomId: "!room:example.com",
      subscribers,
      turnId: "turn_1",
      userId: "@bot:example.com",
    });

    await expect(publisher.start()).resolves.toEqual({
      descriptor: streamDescriptor,
      eventId: "$target",
      turnId: "turn_1",
    });
    await publisher.publish({ messageId: "turn_1", role: "assistant", type: "TEXT_MESSAGE_START" });
    await publisher.publish({ delta: "hello", messageId: "turn_1", type: "TEXT_MESSAGE_CONTENT" });

    expect(startMessage).toHaveBeenCalledTimes(1);
    expect(startMessage).toHaveBeenCalledWith({
      content: {
        body: "...",
        "com.beeper.ai": {
          id: "turn_1",
          metadata: { model: "test", turn_id: "turn_1" },
          parts: [],
          role: "assistant",
        },
        msgtype: "m.text",
      },
      roomId: "!room:example.com",
      streamType: "com.beeper.llm",
      subscribers,
      userId: "@bot:example.com",
    });
    expect(publishPart.mock.calls.map(([options]) => options.part)).toEqual([
      { messageId: "turn_1", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "hello", messageId: "turn_1", type: "TEXT_MESSAGE_CONTENT" },
    ]);
    for (const [options] of publishPart.mock.calls) {
      expect(options).toMatchObject({
        eventId: "$target",
        roomId: "!room:example.com",
        turnId: "turn_1",
      });
    }
  });

  it("serializes concurrent publishes through one stream target", async () => {
    const { client, publishPart, startMessage } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_concurrent" });

    await Promise.all([
      publisher.publish({ messageId: "turn_concurrent", role: "assistant", type: "TEXT_MESSAGE_START" }),
      publisher.publish({ delta: "a", messageId: "turn_concurrent", type: "TEXT_MESSAGE_CONTENT" }),
      publisher.publish({ delta: "b", messageId: "turn_concurrent", type: "TEXT_MESSAGE_CONTENT" }),
    ]);

    expect(startMessage).toHaveBeenCalledTimes(1);
    expect(publishPart.mock.calls.map(([options]) => options.part.type)).toEqual([
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_CONTENT",
    ]);
  });

  it("continues the publish queue after a failed publish", async () => {
    const { client, publishPart } = createClient();
    publishPart.mockRejectedValueOnce(new Error("network down"));
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_retry" });

    await expect(publisher.publish({ messageId: "turn_retry", role: "assistant", type: "TEXT_MESSAGE_START" })).rejects.toThrow("network down");
    await publisher.publish({ delta: "ok", messageId: "turn_retry", type: "TEXT_MESSAGE_CONTENT" });

    expect(publishPart.mock.calls.map(([options]) => options.part)).toEqual([
      { messageId: "turn_retry", role: "assistant", type: "TEXT_MESSAGE_START" },
      { delta: "ok", messageId: "turn_retry", type: "TEXT_MESSAGE_CONTENT" },
    ]);
  });

  it("finalizes by publishing a terminal part and asking native transport to clear the stream", async () => {
    const { client, finalizeMessage, publishPart } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_3" });

    await publisher.publish({ messageId: "turn_3", role: "assistant", type: "TEXT_MESSAGE_START" });
    await publisher.publish({ delta: "done", messageId: "turn_3", type: "TEXT_MESSAGE_CONTENT" });
    const result = await publisher.finalize({
      body: "done",
      message: {
        id: "turn_3",
        metadata: { turn_id: "turn_3" },
        parts: [{ state: "done", text: "done", type: "text" }],
        role: "assistant",
      },
    });

    expect(publishPart.mock.calls.at(-1)![0].part).toEqual({
      finishReason: "stop",
      runId: "turn_3",
      threadId: "turn_3",
      type: "RUN_FINISHED",
    });
    expect(finalizeMessage).toHaveBeenCalledWith({
      body: "done",
      content: {
        body: "done",
        "com.beeper.ai": {
          id: "turn_3",
          metadata: { turn_id: "turn_3" },
          parts: [{ state: "done", text: "done", type: "text" }],
          role: "assistant",
        },
        msgtype: "m.text",
      },
      eventId: "$target",
      roomId: "!room:example.com",
      topLevelContent: {
        "com.beeper.dont_render_edited": true,
      },
    });
    expect(result).toEqual({
      eventId: "$target",
      raw: {
        logicalEventId: "$target",
        raw: {},
        replacementEventId: "$edit",
      },
      roomId: "!room:example.com",
    });
  });

  it("publishes terminal error and abort parts without finalizing the message", async () => {
    const errored = createClient();
    const errorPublisher = new BeeperStreamPublisher({
      client: errored.client,
      roomId: "!room:example.com",
      turnId: "turn_error",
    });

    await errorPublisher.error(new Error("tool failed"));

    expect(errored.publishPart.mock.calls.at(-1)![0].part).toEqual({
      message: "tool failed",
      runId: "turn_error",
      type: "RUN_ERROR",
    });
    expect(errored.finalizeMessage).not.toHaveBeenCalled();

    const aborted = createClient();
    const abortPublisher = new BeeperStreamPublisher({
      client: aborted.client,
      roomId: "!room:example.com",
      turnId: "turn_abort",
    });

    await abortPublisher.abort("user cancelled");

    expect(aborted.publishPart.mock.calls.at(-1)![0].part).toEqual({
      message: "user cancelled",
      runId: "turn_abort",
      type: "RUN_ERROR",
    });
    expect(aborted.finalizeMessage).not.toHaveBeenCalled();
  });

  it("compacts oversized final Matrix content without dropping text or tool calls", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_big" });
    const largeOutput = "x".repeat(70 * 1024);

    await publisher.finalize({
      body: "final answer",
      message: {
        id: "turn_big",
        metadata: {
          model: "gpt-test",
          response_id: "resp_1",
          turn_id: "turn_big",
          usage: { context_limit: 100, prompt_tokens: 10, completion_tokens: 2 },
        },
        parts: [
          { state: "done", text: "final answer", type: "text" },
          { input: { cmd: "date" }, output: largeOutput, state: "output-available", toolCallId: "call_1", toolName: "exec", type: "dynamic-tool" },
        ],
        role: "assistant",
      },
    });

    const content = finalizeMessage.mock.calls[0]![0].content;
    const ai = content["com.beeper.ai"] as Record<string, any>;
    expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThanOrEqual(60 * 1024);
    expect(content.body).toBe("final answer");
    expect(ai.metadata).toEqual({
      turn_id: "turn_big",
      usage: { context_limit: 100, prompt_tokens: 10, completion_tokens: 2 },
    });
    expect(ai.parts).toEqual([
      { state: "done", text: "final answer", type: "text" },
      { input: { cmd: "date" }, state: "output-available", toolCallId: "call_1", toolName: "exec", type: "dynamic-tool" },
    ]);
  });

  it("preserves abort reasons in final terminal metadata", async () => {
    const { client, finalizeMessage } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_abort_final" });

    await publisher.finalize({
      body: "cancelled",
      terminalPart: { message: "user cancelled", runId: "turn_abort_final", type: "RUN_ERROR" },
    });

    const ai = finalizeMessage.mock.calls[0]![0].content["com.beeper.ai"] as Record<string, any>;
    expect(ai.metadata.beeper_terminal_state).toEqual({
      errorText: "user cancelled",
      type: "error",
    });
  });
});

const streamDescriptor = {
  device_id: "DEVICE",
  type: "com.beeper.llm",
  user_id: "@bot:example.com",
};

function createClient() {
  const startMessage = vi.fn(async () => ({ descriptor: streamDescriptor, eventId: "$target", roomId: "!room:example.com" }));
  const publishPart = vi.fn(async () => undefined);
  const finalizeMessage = vi.fn(async () => ({
    eventId: "$target",
    raw: {},
    replacementEventId: "$edit",
    roomId: "!room:example.com",
  }));
  const client = {
    beeper: {
      streams: {
        finalizeMessage,
        publishPart,
        startMessage,
      },
    },
  } as unknown as MatrixClient;

  return { client, finalizeMessage, publishPart, startMessage };
}
