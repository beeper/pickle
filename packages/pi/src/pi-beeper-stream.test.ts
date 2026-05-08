import type { MatrixClient } from "@beeper/pickle";
import { describe, expect, it, vi } from "vitest";
import { createPiBeeperStreamBridge } from "./pi-beeper-stream";

describe("PiBeeperStreamBridge", () => {
  it("publishes mapped Pi callback events and finalizes on assistant message end", async () => {
    const { client, edit, publish } = createClient();
    const bridge = createPiBeeperStreamBridge({ client, roomId: "!room:example.com", turnId: "turn_pi" });

    await bridge.handlePiEvent({ message: { role: "assistant" }, type: "message_start" });
    await bridge.handlePiEvent({
      assistantMessageEvent: { delta: "hello", type: "text_delta" },
      message: { role: "assistant" },
      type: "message_update",
    });
    await bridge.handlePiEvent({ message: { role: "assistant" }, type: "message_end" });

    expect(publish.mock.calls.map(([options]) => delta(options).part.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.objectContaining({
        "com.beeper.ai": expect.objectContaining({
          parts: [{ state: "done", text: "hello", type: "text" }],
        }),
      }),
      eventId: "$target",
      roomId: "!room:example.com",
      text: "hello",
    }));
  });

  it("publishes actual Pi tool execution callbacks", async () => {
    const { client, publish } = createClient();
    const bridge = createPiBeeperStreamBridge({ client, roomId: "!room:example.com", turnId: "turn_tool" });

    await bridge.handlePiEvent({
      args: { cmd: "pwd" },
      toolCallId: "call_1",
      toolName: "bash",
      type: "tool_execution_start",
    });
    await bridge.handlePiEvent({
      partialResult: "running",
      toolCallId: "call_1",
      toolName: "bash",
      type: "tool_execution_update",
    });
    await bridge.handlePiEvent({
      isError: false,
      result: "done",
      toolCallId: "call_1",
      toolName: "bash",
      type: "tool_execution_end",
    });

    expect(publish.mock.calls.map(([options]) => delta(options).part)).toMatchObject([
      { type: "start" },
      { input: { cmd: "pwd" }, toolCallId: "call_1", toolName: "bash", type: "tool-input-available" },
      { output: "running", preliminary: true, toolCallId: "call_1", toolName: "bash", type: "tool-output-available" },
      { output: "done", toolCallId: "call_1", toolName: "bash", type: "tool-output-available" },
    ]);
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
    beeper: { streams: { create, publish, register } },
    messages: { edit, send },
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
