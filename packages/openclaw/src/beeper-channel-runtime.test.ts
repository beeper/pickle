import { afterEach, describe, expect, it, vi } from "vitest";
import { BeeperChannelRuntime, getBeeperChannelRuntime, setBeeperChannelRuntime } from "./beeper-channel-runtime";

function createClient() {
  return {
    appservice: {
      sendMessage: vi.fn(async () => ({ eventId: "$as" })),
    },
    messages: {
      edit: vi.fn(async () => ({ eventId: "$edit" })),
      redact: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ eventId: "$send" })),
      sendMedia: vi.fn(async () => ({ eventId: "$media" })),
    },
    reactions: {
      redact: vi.fn(async () => undefined),
      send: vi.fn(async () => ({ eventId: "$reaction" })),
    },
    typing: {
      set: vi.fn(async () => undefined),
    },
  };
}

describe("BeeperChannelRuntime", () => {
  afterEach(() => {
    setBeeperChannelRuntime(undefined);
  });

  it("wraps Pickle message, reaction, redaction, and typing primitives", async () => {
    const client = createClient();
    const runtime = new BeeperChannelRuntime({
      client: client as never,
      getAgents: () => [{ id: "codex", name: "Codex" }],
    });

    expect(runtime.listAgents()).toEqual([{ id: "codex", name: "Codex" }]);
    await expect(runtime.sendText({ replyToId: "$parent", roomId: "!room", text: "hi", threadRoot: "$thread" }))
      .resolves.toEqual({ eventId: "$send" });
    expect(client.messages.send).toHaveBeenCalledWith({
      content: { body: "hi", msgtype: "m.text" },
      replyTo: "$parent",
      roomId: "!room",
      text: "hi",
      threadRoot: "$thread",
    });

    await runtime.sendMedia({ bytes: new Uint8Array([1]), caption: "cap", filename: "a.txt", roomId: "!room" });
    expect(client.messages.sendMedia).toHaveBeenCalledWith({
      bytes: new Uint8Array([1]),
      caption: "cap",
      filename: "a.txt",
      kind: "file",
      roomId: "!room",
    });

    await runtime.edit({ eventId: "$event", roomId: "!room", text: "edited" });
    expect(client.messages.edit).toHaveBeenCalledWith({ eventId: "$event", roomId: "!room", text: "edited" });

    await runtime.redact({ eventId: "$event", reason: "oops", roomId: "!room" });
    expect(client.messages.redact).toHaveBeenCalledWith({ eventId: "$event", reason: "oops", roomId: "!room" });

    await runtime.react({ emoji: "+1", eventId: "$event", roomId: "!room" });
    expect(client.reactions.send).toHaveBeenCalledWith({ eventId: "$event", key: "+1", roomId: "!room" });

    await runtime.removeReaction({ emoji: "+1", eventId: "$event", roomId: "!room" });
    expect(client.reactions.redact).toHaveBeenCalledWith({ eventId: "$event", key: "+1", roomId: "!room" });

    await runtime.typing({ roomId: "!room", timeoutMs: 1000 });
    expect(client.typing.set).toHaveBeenCalledWith({ roomId: "!room", timeoutMs: 1000, typing: true });
  });

  it("uses the appservice ghost sender when a user id is available", async () => {
    const client = createClient();
    const runtime = new BeeperChannelRuntime({
      client: client as never,
      userId: "@agent:example",
    });

    await runtime.sendText({ replyToId: "$parent", roomId: "!room", text: "from ghost" });
    expect(client.appservice.sendMessage).toHaveBeenCalledWith({
      content: {
        body: "from ghost",
        msgtype: "m.text",
        "m.relates_to": {
          "m.in_reply_to": { event_id: "$parent" },
        },
      },
      roomId: "!room",
      userId: "@agent:example",
    });
    expect(client.messages.send).not.toHaveBeenCalled();
  });

  it("stores the active runtime for channel adapters", () => {
    const runtime = new BeeperChannelRuntime({ client: createClient() as never });
    setBeeperChannelRuntime(runtime);
    expect(getBeeperChannelRuntime()).toBe(runtime);
  });
});
