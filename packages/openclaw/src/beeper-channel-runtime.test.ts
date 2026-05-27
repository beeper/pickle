import { describe, expect, it, vi } from "vitest";
import {
  BeeperChannelRuntime,
  getBeeperChannelRuntimeForHost,
  requireBeeperChannelRuntimeForHost,
  setBeeperChannelRuntimeForHost,
} from "./beeper-channel-runtime";

function createClient() {
  return {
    appservice: {
      sendMessage: vi.fn(async () => ({ eventId: "$as" })),
    },
    media: {
      upload: vi.fn(async () => ({ contentUri: "mxc://example/media", raw: {} })),
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
  it("requires bridge portal routing for outbound message operations", async () => {
    const client = createClient();
    const runtime = new BeeperChannelRuntime({
      client: client as never,
      getAgents: () => [{ id: "codex", name: "Codex" }],
    });

    expect(runtime.listAgents()).toEqual([{ id: "codex", name: "Codex" }]);
    await expect(runtime.sendText({ roomId: "!room", text: "hi" })).rejects.toThrow("requires a Pickle bridge");
    expect(client.messages.send).not.toHaveBeenCalled();
  });

  it("rejects non-OpenClaw message ids for bridge mutation actions", async () => {
    const client = createClient();
    const bridge = {
      flushRemoteEvents: vi.fn(async () => undefined),
      getPortalByMXID: vi.fn(() => ({ portalKey: { id: "session:one", receiver: "openclaw:plugin" } })),
      queueRemoteEvent: vi.fn(),
    };
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      client: client as never,
      login: { id: "openclaw:plugin" },
    });

    await expect(runtime.edit({ eventId: "$matrix", roomId: "!room", text: "edit" }))
      .rejects.toThrow("can only target OpenClaw bridge message ids");
    expect(client.messages.edit).not.toHaveBeenCalled();
  });

  it("prefers bridge remote events for bound portal message operations", async () => {
    const client = createClient();
    const queued: unknown[] = [];
    const bridge = {
      flushRemoteEvents: vi.fn(async () => undefined),
      getPortalByMXID: vi.fn(() => ({ portalKey: { id: "session:one", receiver: "openclaw:plugin" } })),
      queueRemoteEvent: vi.fn((_login: unknown, event: unknown) => queued.push(event)),
    };
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      client: client as never,
      getBindingByRoom: () => ({
        agentId: "codex",
        createdAt: 1,
        ghostUserId: "@codex:example",
        id: "binding",
        kind: "session",
        owner: "bridge",
        roomId: "!room",
        sessionKey: "session_1",
        updatedAt: 1,
      }),
      login: { id: "openclaw:plugin" },
      userId: "@bot:example",
    });

    const sent = await runtime.sendText({ roomId: "!room", text: "from agent" });
    expect(sent.eventId).toMatch(/^openclaw:message:/u);
    expect(client.appservice.sendMessage).not.toHaveBeenCalled();
    expect(bridge.queueRemoteEvent).toHaveBeenCalledOnce();
    expect(bridge.flushRemoteEvents).toHaveBeenCalledOnce();
    const messageEvent = queued[0] as {
      convertMessage: () => Promise<{ parts: Array<{ content: Record<string, unknown> }> }>;
      getID: () => string;
      getSender: () => { sender: string };
      getType: () => string;
    };
    expect(messageEvent.getType()).toBe("message");
    expect(messageEvent.getSender()).toEqual({ isFromMe: true, sender: "@codex:example" });
    expect((await messageEvent.convertMessage()).parts[0]?.content).toEqual({ body: "from agent", msgtype: "m.text" });

    await runtime.sendMedia({ bytes: new Uint8Array([1]), caption: "cap", filename: "a.txt", roomId: "!room" });
    expect(client.media.upload).toHaveBeenCalledWith({
      bytes: new Uint8Array([1]),
      filename: "a.txt",
    });

    await runtime.edit({ eventId: sent.eventId, roomId: "!room", text: "edited" });
    await runtime.react({ emoji: "+1", eventId: sent.eventId, roomId: "!room" });
    await runtime.removeReaction({ emoji: "+1", eventId: sent.eventId, roomId: "!room" });
    await runtime.redact({ eventId: sent.eventId, roomId: "!room" });
    await runtime.typing({ roomId: "!room", timeoutMs: 5000 });
    await runtime.readReceipt({ eventId: sent.eventId, roomId: "!room" });
    await runtime.deliveryReceipt({ eventId: sent.eventId, roomId: "!room" });
    await runtime.markUnread({ eventId: sent.eventId, roomId: "!room", unread: true });

    expect(queued.slice(1).map((event) => (event as { getType: () => string }).getType())).toEqual([
      "message",
      "edit",
      "reaction",
      "reaction_remove",
      "message_remove",
      "typing",
      "read_receipt",
      "delivery_receipt",
      "mark_unread",
    ]);
    expect(client.messages.edit).not.toHaveBeenCalled();
    expect(client.reactions.send).not.toHaveBeenCalled();
    expect(client.messages.redact).not.toHaveBeenCalled();
    expect(client.typing.set).not.toHaveBeenCalled();
  });

  it("routes OpenClaw session targets through their bound Beeper portal", async () => {
    const client = createClient();
    const queued: unknown[] = [];
    const bridge = {
      flushRemoteEvents: vi.fn(async () => undefined),
      getPortalByMXID: vi.fn((roomId: string) =>
        roomId === "!room"
          ? { portalKey: { id: "session:one", receiver: "openclaw:plugin" } }
          : undefined
      ),
      queueRemoteEvent: vi.fn((_login: unknown, event: unknown) => queued.push(event)),
    };
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      client: client as never,
      getBindingBySessionKey: (sessionKey) =>
        sessionKey === "agent:main:beeper:abc"
          ? {
              agentId: "main",
              createdAt: 1,
              ghostUserId: "@main:example",
              id: "binding",
              kind: "session",
              owner: "bridge",
              roomId: "!room",
              sessionKey,
              updatedAt: 1,
            }
          : undefined,
      login: { id: "openclaw:plugin" },
      userId: "@bot:example",
    });

    await runtime.sendText({ roomId: "main:beeper:abc", text: "from message tool" });

    expect(bridge.getPortalByMXID).toHaveBeenCalledWith("!room");
    const messageEvent = queued[0] as {
      getSender: () => { sender: string };
    };
    expect(messageEvent.getSender()).toEqual({ isFromMe: true, sender: "@main:example" });
  });

  it("stores Beeper runtimes by OpenClaw host runtime", () => {
    const hostRuntime = {};
    const scopedRuntime = new BeeperChannelRuntime({ client: createClient() as never });

    setBeeperChannelRuntimeForHost(hostRuntime, scopedRuntime);

    expect(getBeeperChannelRuntimeForHost(hostRuntime)).toBe(scopedRuntime);
    expect(requireBeeperChannelRuntimeForHost(hostRuntime)).toBe(scopedRuntime);

    setBeeperChannelRuntimeForHost(hostRuntime, undefined);
    expect(getBeeperChannelRuntimeForHost(hostRuntime)).toBeUndefined();
    expect(() => requireBeeperChannelRuntimeForHost(hostRuntime)).toThrow("Beeper channel runtime is not available");
  });
});
