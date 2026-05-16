import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { BeeperStreamPublisher } from "./beeper-stream";

describe("Beeper stream publisher", () => {
  it("creates a target message and registers it with a Beeper stream", async () => {
    const { client, create, register, send } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_1" });

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

  it("reuses an existing target message stream descriptor", async () => {
    const { client, create, get, register, send } = createClient();
    const publisher = new BeeperStreamPublisher({
      client,
      roomId: "!room:example.com",
      targetEventId: "$existing",
      turnId: "turn_reuse",
    });

    await expect(publisher.start()).resolves.toEqual({
      descriptor: streamDescriptor,
      eventId: "$existing",
      turnId: "turn_reuse",
    });

    expect(get).toHaveBeenCalledWith({ eventId: "$existing", roomId: "!room:example.com" });
    expect(create).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("publishes callback chunks as monotonic com.beeper.llm.deltas envelopes", async () => {
    const { client, publish } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_2" });

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

  it("registers a local subscriber device with the stream", async () => {
    const { client, publish, register } = createClient();
    const subscribers = [{ deviceId: "DESKTOP", userId: "@alice:example.com" }];
    const publisher = new BeeperStreamPublisher({
      client,
      roomId: "!room:example.com",
      subscribers,
      turnId: "turn_direct",
    });

    await publisher.start();
    await publisher.publish({ delta: "hello", id: "text_turn_direct", type: "text-delta" });

    expect(register).toHaveBeenCalledWith({
      descriptor: streamDescriptor,
      eventId: "$target",
      roomId: "!room:example.com",
      subscribers,
    });
    expect(publish.mock.calls.map(([options]) => delta(options).seq)).toEqual([1, 2]);
  });

  it("does not mutate final content or sequence when publish fails", async () => {
    const { client, edit, publish } = createClient();
    publish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network down"));
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_retry" });

    await publisher.start();
    await expect(publisher.publish({ delta: "lost", id: "text_turn_retry", type: "text-delta" })).rejects.toThrow("network down");
    await publisher.publish({ delta: "ok", id: "text_turn_retry", type: "text-delta" });
    await publisher.finalize({ body: "ok" });

    expect(delta(publish.mock.calls[1]![0]).seq).toBe(2);
    expect(delta(publish.mock.calls[2]![0]).seq).toBe(2);
    expect(delta(publish.mock.calls[3]![0]).seq).toBe(3);
    expect(edit.mock.calls[0]![0].content.body).toBe("ok");
  });

  it("serializes concurrent publishes through one stream target and monotonic sequence", async () => {
    const { client, create, publish, register, send } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_concurrent" });

    await Promise.all([
      publisher.publish({ id: "text_turn_concurrent", type: "text-start" }),
      publisher.publish({ delta: "a", id: "text_turn_concurrent", type: "text-delta" }),
      publisher.publish({ delta: "b", id: "text_turn_concurrent", type: "text-delta" }),
    ]);

    expect(create).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls.map(([options]) => delta(options).seq)).toEqual([1, 2, 3, 4]);
    expect(publish.mock.calls.map(([options]) => delta(options).part.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-delta",
    ]);
  });

  it("continues the publish queue after a failed publish", async () => {
    const { client, publish } = createClient();
    publish.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network down"));
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_queue_retry" });

    await expect(publisher.publish({ id: "text_turn_queue_retry", type: "text-start" })).rejects.toThrow("network down");
    await publisher.publish({ delta: "ok", id: "text_turn_queue_retry", type: "text-delta" });

    expect(delta(publish.mock.calls[1]![0]).seq).toBe(2);
    expect(delta(publish.mock.calls[2]![0]).seq).toBe(2);
  });

  it("finalizes by publishing finish and editing com.beeper.ai while clearing the stream", async () => {
    const { client, edit, publish } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_3" });

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
    const errorPublisher = new BeeperStreamPublisher({
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
    const abortPublisher = new BeeperStreamPublisher({
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

  it("compacts oversized final Matrix content without dropping text or tool calls", async () => {
    const { client, edit } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_big" });
    const largeOutput = "x".repeat(70 * 1024);

    await publisher.start();
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

    const content = edit.mock.calls[0]![0].content;
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

  it("uses one global text budget when compacting final Matrix content", async () => {
    const { client, edit } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_global_budget" });
    const text = "x".repeat(45 * 1024);

    await publisher.start();
    await publisher.finalize({
      body: text,
      message: {
        id: "turn_global_budget",
        metadata: { turn_id: "turn_global_budget" },
        parts: [
          { state: "done", text, type: "text" },
          { state: "done", text, type: "text" },
        ],
        role: "assistant",
      },
    });

    const content = edit.mock.calls[0]![0].content;
    const ai = content["com.beeper.ai"] as Record<string, any>;
    expect(Buffer.byteLength(JSON.stringify(content))).toBeLessThanOrEqual(60 * 1024);
    expect(`${content.body}${ai.parts.map((part: any) => part.text ?? "").join("")}`).toContain("Matrix event compacted");
  });

  it("updates an existing fallback tool part when the tool name arrives late", async () => {
    const { client, edit } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_late_tool" });

    await publisher.start();
    await publisher.publish({ dynamic: true, output: "running", toolCallId: "call_1", type: "tool-output-available" });
    await publisher.publish({
      dynamic: true,
      input: { cmd: "date" },
      toolCallId: "call_1",
      toolName: "exec",
      type: "tool-input-available",
    });
    await publisher.finalize({ body: "done" });

    const ai = edit.mock.calls[0]![0].content["com.beeper.ai"] as Record<string, any>;
    expect(ai.parts[0]).toMatchObject({
      toolCallId: "call_1",
      toolName: "exec",
      type: "dynamic-tool",
    });
  });

  it("preserves abort reasons in final terminal metadata", async () => {
    const { client, edit } = createClient();
    const publisher = new BeeperStreamPublisher({ client, roomId: "!room:example.com", turnId: "turn_abort_final" });

    await publisher.start();
    await publisher.finalize({
      body: "cancelled",
      terminalPart: { reason: "user cancelled", type: "abort" },
    });

    const ai = edit.mock.calls[0]![0].content["com.beeper.ai"] as Record<string, any>;
    expect(ai.metadata.beeper_terminal_state).toEqual({
      reason: "user cancelled",
      type: "abort",
    });
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
  const get = vi.fn(async () => ({
    message: {
      attachments: [],
      class: "message",
      content: {
        "com.beeper.stream": streamDescriptor,
      },
      edited: false,
      encrypted: false,
      eventId: "$existing",
      kind: "message",
      raw: {},
      roomId: "!room:example.com",
      text: "...",
      type: "m.room.message",
    },
  }));
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
      get,
      send,
    },
  } as unknown as MatrixClient;

  return { client, create, edit, get, publish, register, send };
}

function delta(options: { content?: Record<string, unknown> }): Record<string, unknown> {
  const deltas = options.content?.["com.beeper.llm.deltas"];
  if (!Array.isArray(deltas)) throw new Error("missing com.beeper.llm.deltas");
  const [first] = deltas;
  if (!first || typeof first !== "object") throw new Error("missing stream delta");
  return first as Record<string, unknown>;
}
