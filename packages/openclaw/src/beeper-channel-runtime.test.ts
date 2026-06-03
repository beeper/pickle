import { describe, expect, it, vi } from "vitest";
import {
  BeeperChannelRuntime,
  getBeeperChannelRuntimeForHost,
  requireBeeperChannelRuntimeForHost,
  setBeeperChannelRuntimeForHost,
} from "./beeper-channel-runtime";
import { BeeperTurnStream } from "@beeper/pickle-bridge/beeper-stream";

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

function createStreamingClient() {
  return {
    ...createClient(),
    beeper: {
      aiRunStreams: {
        appendEvent: vi.fn(),
        error: vi.fn(),
        finish: vi.fn(),
        start: vi.fn(async ({ agentId, agentName, runId }: { agentId?: string; agentName?: string; runId: string }) => ({
          body: "...",
          descriptor: { type: "com.beeper.llm", user_id: "@codex:example" },
          eventId: "$stream",
          events: [
            { runId, threadId: runId, type: "RUN_STARTED" },
            { messageId: `msg-${runId}`, role: "assistant", type: "TEXT_MESSAGE_START" },
          ],
          finalAIMessage: {},
          initialAIMessage: {},
          messageId: `msg-${runId}`,
          metadata: {
            agent: { displayName: agentName, id: agentId },
            runId,
            status: { state: "streaming" },
            threadId: runId,
          },
          raw: {},
          roomId: "!room",
          runId,
          threadId: runId,
        })),
      },
      aiRuns: {
        begin: vi.fn(async ({ agentId, agentName, runId }: { agentId?: string; agentName?: string; runId: string }) => ({
          body: "...",
          events: [
            { runId, threadId: runId, type: "RUN_STARTED" },
            { messageId: runId, role: "assistant", type: "TEXT_MESSAGE_START" },
          ],
          finalAIMessage: {},
          initialAIMessage: {
            id: runId,
            metadata: { turn_id: runId },
            parts: [],
            role: "assistant",
          },
          metadata: {
            agent: { displayName: agentName, id: agentId },
            runId,
            status: { state: "streaming" },
            threadId: runId,
          },
          messageId: runId,
          runId,
          threadId: runId,
        })),
        appendEvent: vi.fn(),
        error: vi.fn(),
        finish: vi.fn(),
      },
      streams: {
        finalizeMessage: vi.fn(),
        publishPart: vi.fn(async () => undefined),
        startMessage: vi.fn(async () => ({
          descriptor: { type: "com.beeper.llm", user_id: "@codex:example" },
          eventId: "$stream",
          roomId: "!room",
        })),
      },
    },
  };
}

function createBridge(client: ReturnType<typeof createClient> | ReturnType<typeof createStreamingClient>, queued: unknown[] = []) {
  return {
    createBeeperTurnStream: vi.fn((options) => new BeeperTurnStream({
      ...options,
      client: client as never,
    })),
    flushRemoteEvents: vi.fn(async () => undefined),
    getPortalByMXID: vi.fn(() => ({ portalKey: { id: "conversation:one", receiver: "openclaw:plugin" } })),
    queueRemoteEvent: vi.fn((_login: unknown, event: unknown) => queued.push(event)),
    uploadMedia: vi.fn((options: Parameters<ReturnType<typeof createClient>["media"]["upload"]>[0]) => client.media.upload(options)),
  };
}

describe("BeeperChannelRuntime", () => {
  it("requires bridge portal routing for outbound message operations", async () => {
    const client = createClient();
    const runtime = new BeeperChannelRuntime({
      getAgents: () => [{ id: "codex", name: "Codex" }],
    });

    expect(runtime.listAgents()).toEqual([{ id: "codex", name: "Codex" }]);
    await expect(runtime.sendText({ roomId: "!room", text: "hi" })).rejects.toThrow("requires a Pickle bridge");
    expect(client.messages.send).not.toHaveBeenCalled();
  });

  it("queues Matrix event ids as bundled bridge update targets", async () => {
    const client = createClient();
    const queued: unknown[] = [];
    const bridge = createBridge(client, queued);
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      login: { id: "openclaw:plugin" },
    });

    await runtime.edit({ eventId: "$matrix", roomId: "!room", text: "edit" });

    const event = queued[0] as {
      getTargetDBMessage: () => Array<{ id: string; mxid: string; partId: string }>;
      getTargetMessage: () => string;
      getType: () => string;
    };
    expect(event.getType()).toBe("edit");
    expect(event.getTargetMessage()).toBe("$matrix");
    expect(event.getTargetDBMessage()).toEqual([{ id: "$matrix", mxid: "$matrix", partId: "0" }]);
    expect(client.messages.edit).not.toHaveBeenCalled();
  });

  it("prefers bridge remote events for bound portal message operations", async () => {
    const client = createClient();
    const queued: unknown[] = [];
    const bridge = createBridge(client, queued);
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      getBindingByRoom: () => ({
        agentId: "codex",
        createdAt: 1,
        ghostUserId: "@codex:example",
        id: "binding",
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

    await runtime.sendText({ replyToId: "$reply", roomId: "!room", text: "threaded", threadRoot: "$thread" });
    const threadedTextEvent = queued[1] as {
      convertMessage: () => Promise<{ parts: Array<{ content: Record<string, unknown> }> }>;
    };
    expect((await threadedTextEvent.convertMessage()).parts[0]?.content["m.relates_to"]).toEqual({
      "m.in_reply_to": { event_id: "$reply" },
      "m.thread": { event_id: "$thread" },
    });

    await runtime.sendMedia({ bytes: new Uint8Array([1]), caption: "cap", filename: "a.txt", replyToId: "$reply", roomId: "!room", threadRoot: "$thread" });
    expect(bridge.uploadMedia).toHaveBeenCalledWith({
      bytes: new Uint8Array([1]),
      filename: "a.txt",
    });
    expect(client.media.upload).toHaveBeenCalledWith({
      bytes: new Uint8Array([1]),
      filename: "a.txt",
    });
    const mediaEvent = queued[2] as {
      convertMessage: () => Promise<{ parts: Array<{ content: Record<string, unknown> }> }>;
    };
    expect((await mediaEvent.convertMessage()).parts[0]?.content["m.relates_to"]).toEqual({
      "m.in_reply_to": { event_id: "$reply" },
      "m.thread": { event_id: "$thread" },
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
    const bridge = createBridge(client, queued);
    bridge.getPortalByMXID.mockImplementation((roomId: string) =>
        roomId === "!room"
          ? { portalKey: { id: "conversation:one", receiver: "openclaw:plugin" } }
          : undefined
      );
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      getBindingBySessionKey: (sessionKey) =>
        sessionKey === "agent:main:beeper:abc"
          ? {
              agentId: "main",
              createdAt: 1,
              ghostUserId: "@main:example",
              id: "binding",
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

  it("starts native streams as the bound assistant ghost", async () => {
    const client = createStreamingClient();
    const bridge = createBridge(client);
    const runtime = new BeeperChannelRuntime({
      bridge: bridge as never,
      getAgents: () => [{
        agentId: "codex",
        displayName: "Codex",
        ghostUserId: "@codex:example",
      }],
      getBindingByRoom: () => ({
        agentId: "codex",
        createdAt: 1,
        ghostUserId: "@codex:example",
        id: "binding",
        roomId: "!room",
        sessionKey: "agent:codex:desktop",
        updatedAt: 1,
      }),
      login: { id: "openclaw:plugin" },
      userId: "@bot:example",
    });

    const stream = runtime.createStreamPublisher({
      agentId: "codex",
      roomId: "!room",
      runId: "run_1",
      sessionKey: "agent:codex:desktop",
    });
    await stream.start();

    expect(client.beeper.aiRunStreams.start).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "codex",
      agentName: "Codex",
      runId: "run_1",
    }));
    expect(client.beeper.aiRunStreams.start).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        agent_id: "codex",
        agent_name: "Codex",
      }),
      userId: "@codex:example",
    }));
  });

  it("stores Beeper runtimes by OpenClaw host runtime", () => {
    const hostRuntime = {};
    const scopedRuntime = new BeeperChannelRuntime({});

    setBeeperChannelRuntimeForHost(hostRuntime, scopedRuntime);

    expect(getBeeperChannelRuntimeForHost(hostRuntime)).toBe(scopedRuntime);
    expect(requireBeeperChannelRuntimeForHost(hostRuntime)).toBe(scopedRuntime);

    setBeeperChannelRuntimeForHost(hostRuntime, undefined);
    expect(getBeeperChannelRuntimeForHost(hostRuntime)).toBeUndefined();
    expect(() => requireBeeperChannelRuntimeForHost(hostRuntime)).toThrow("Beeper channel runtime is not available");
  });
});
