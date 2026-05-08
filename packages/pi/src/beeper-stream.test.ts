import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { createBeeperStreamPublisher } from "./beeper-stream";

describe("Beeper stream publisher", () => {
  it("creates a target message and registers it with a Beeper stream", async () => {
    const { client, create, register, send } = createClient();
    const publisher = createBeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_1" });

    await expect(publisher.start()).resolves.toEqual({
      descriptor: streamDescriptor,
      eventId: "$target",
      turnId: "turn_1",
    });

    expect(create).toHaveBeenCalledWith({
      roomId: "!room:example.com",
      streamType: "com.beeper.llm",
    });
    expect(send).toHaveBeenCalledWith({
      content: {
        body: "...",
        "com.beeper.ai": {
          id: "turn_1",
          metadata: { turn_id: "turn_1" },
          parts: [],
          role: "assistant",
        },
        "com.beeper.stream": streamDescriptor,
        msgtype: "m.text",
      },
      messageType: "m.text",
      roomId: "!room:example.com",
      text: "...",
    });
    expect(register).toHaveBeenCalledWith({
      descriptor: streamDescriptor,
      eventId: "$target",
      roomId: "!room:example.com",
    });
  });

  it("publishes callback chunks as monotonic com.beeper.llm.deltas envelopes", async () => {
    const { client, publish } = createClient();
    const publisher = createBeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_2" });

    await publisher.start();
    await publisher.publish({ id: "text_turn_2", type: "text-start" });
    await publisher.publish({ delta: "hello", id: "text_turn_2", type: "text-delta" });

    expect(publish).toHaveBeenCalledTimes(3);
    expect(publish.mock.calls.map(([options]) => delta(options).seq)).toEqual([1, 2, 3]);
    expect(publish.mock.calls.map(([options]) => delta(options).part)).toEqual([
      {
        messageId: "turn_2",
        messageMetadata: { turn_id: "turn_2" },
        type: "start",
      },
      { id: "text_turn_2", type: "text-start" },
      { delta: "hello", id: "text_turn_2", type: "text-delta" },
    ]);
    for (const [options] of publish.mock.calls) {
      expect(options).toMatchObject({
        content: {
          "com.beeper.llm.deltas": [
            {
              "m.relates_to": { event_id: "$target", rel_type: "m.reference" },
              target_event: "$target",
              turn_id: "turn_2",
            },
          ],
        },
        eventId: "$target",
        roomId: "!room:example.com",
      });
    }
  });

  it("finalizes by publishing finish and editing com.beeper.ai while clearing the stream", async () => {
    const { client, edit, publish } = createClient();
    const publisher = createBeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_3" });

    await publisher.start();
    await publisher.publish({ id: "text_turn_3", type: "text-start" });
    await publisher.publish({ delta: "done", id: "text_turn_3", type: "text-delta" });
    await publisher.publish({ id: "text_turn_3", type: "text-end" });
    await publisher.finalize({
      body: "done",
      message: {
        id: "turn_3",
        metadata: { turn_id: "turn_3" },
        parts: [{ state: "done", text: "done", type: "text" }],
        role: "assistant",
      },
    });

    expect(delta(publish.mock.calls.at(-1)![0]).part).toEqual({
      finishReason: "stop",
      messageMetadata: { finish_reason: "stop", turn_id: "turn_3" },
      type: "finish",
    });
    expect(delta(publish.mock.calls.at(-1)![0]).seq).toBe(5);
    expect(edit).toHaveBeenCalledWith({
      content: {
        body: "done",
        "com.beeper.ai": {
          id: "turn_3",
          metadata: { turn_id: "turn_3" },
          parts: [{ state: "done", text: "done", type: "text" }],
          role: "assistant",
        },
        "com.beeper.stream": null,
        msgtype: "m.text",
      },
      eventId: "$target",
      messageType: "m.text",
      roomId: "!room:example.com",
      text: "done",
      topLevelContent: {
        "com.beeper.dont_render_edited": true,
        "com.beeper.stream": null,
      },
    });
  });

  it("publishes terminal error and abort parts without finalizing the message", async () => {
    const errored = createClient();
    const errorPublisher = createBeeperStreamPublisher({
      client: errored.client,
      roomId: "!room:example.com",
      turnId: "turn_error",
    });

    await errorPublisher.start();
    await errorPublisher.error(new Error("tool failed"));

    expect(delta(errored.publish.mock.calls.at(-1)![0]).part).toEqual({
      errorText: "tool failed",
      type: "error",
    });
    expect(errored.edit).not.toHaveBeenCalled();

    const aborted = createClient();
    const abortPublisher = createBeeperStreamPublisher({
      client: aborted.client,
      roomId: "!room:example.com",
      turnId: "turn_abort",
    });

    await abortPublisher.start();
    await abortPublisher.abort("user cancelled");

    expect(delta(aborted.publish.mock.calls.at(-1)![0]).part).toEqual({
      reason: "user cancelled",
      type: "abort",
    });
    expect(aborted.edit).not.toHaveBeenCalled();
  });
});

const streamDescriptor = {
  device_id: "DEVICE",
  type: "com.beeper.llm",
  user_id: "@bot:example.com",
};

function createClient() {
  const create = vi.fn(async () => ({ descriptor: streamDescriptor }));
  const register = vi.fn(async () => undefined);
  const publish = vi.fn(async () => undefined);
  const send = vi.fn(async () => ({ eventId: "$target", raw: {}, roomId: "!room:example.com" }));
  const edit = vi.fn(async () => ({ eventId: "$edit", raw: {}, roomId: "!room:example.com" }));
  const client = {
    beeper: {
      streams: {
        create,
        publish,
        register,
      },
    },
    messages: {
      edit,
      send,
    },
  } as unknown as MatrixClient;

  return { client, create, edit, publish, register, send };
}

function delta(options: { content?: Record<string, unknown> }): Record<string, unknown> {
  const deltas = options.content?.["com.beeper.llm.deltas"];
  if (!Array.isArray(deltas)) throw new Error("missing com.beeper.llm.deltas");
  const [first] = deltas;
  if (!first || typeof first !== "object") throw new Error("missing stream delta");
  return first as Record<string, unknown>;
}
