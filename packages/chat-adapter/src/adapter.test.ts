import type { MatrixCore, MatrixCoreEvent } from "better-matrix-js";
import type { ChatInstance, Logger } from "chat";
import { describe, expect, it, vi } from "vitest";
import { MatrixAdapter } from "./adapter";
import { encodeMatrixChatThreadRef } from "./thread-id";

function makeLogger(): Logger {
  return {
    child: vi.fn(() => makeLogger()),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function makeChat() {
  return {
    getLogger: vi.fn(() => makeLogger()),
    processMessage: vi.fn(),
    processReaction: vi.fn(),
    processSlashCommand: vi.fn(),
  } as unknown as ChatInstance & {
    processMessage: ReturnType<typeof vi.fn>;
    processReaction: ReturnType<typeof vi.fn>;
    processSlashCommand: ReturnType<typeof vi.fn>;
  };
}

function makeCore(overrides: Partial<MatrixCore> = {}) {
  let listener: ((event: MatrixCoreEvent) => void) | null = null;
  const core: MatrixCore = {
    addReaction: vi.fn(async () => ({ eventId: "$reaction", raw: {}, roomId: "!room:example.com" })),
    applySyncResponse: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    createBeeperStream: vi.fn(async () => ({
      descriptor: {
        device_id: "DEVICE",
        type: "com.beeper.llm",
        user_id: "@bot:example.com",
      },
    })),
    deleteMessage: vi.fn(async () => undefined),
    downloadEncryptedMedia: vi.fn(async () => ({ bytesBase64: bytesToBase64(new Uint8Array([4, 5, 6])) })),
    downloadMedia: vi.fn(async () => ({ bytesBase64: bytesToBase64(new Uint8Array([1, 2, 3])) })),
    editMessage: vi.fn(async () => ({ eventId: "$edit", raw: {}, roomId: "!room:example.com" })),
    fetchJoinedRooms: vi.fn(async () => ({ raw: {}, roomIds: [] })),
    fetchMessage: vi.fn(async () => ({ message: null })),
    fetchMessages: vi.fn(async () => ({ messages: [] })),
    fetchRoom: vi.fn(async () => ({
      encrypted: true,
      id: "!room:example.com",
      isDM: false,
      joinRule: "public",
      memberCount: 3,
      name: "General",
      topic: "Room topic",
      visibility: "workspace",
    })),
    getUser: vi.fn(async () => ({
      avatarUrl: "mxc://example.com/avatar",
      displayName: "Alice",
      raw: {},
      userId: "@alice:example.com",
    })),
    init: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@bot:example.com" })),
    inviteUser: vi.fn(async () => undefined),
    joinRoom: vi.fn(async () => ({ raw: {}, roomId: "!room:example.com" })),
    leaveRoom: vi.fn(async () => undefined),
    listRoomThreads: vi.fn(async () => ({ threads: [] })),
    markRead: vi.fn(async () => undefined),
    onEvent: vi.fn((next) => {
      listener = next;
      return () => {
        listener = null;
      };
    }),
    openDM: vi.fn(async () => ({ raw: {}, roomId: "!dm:example.com" })),
    postMediaMessage: vi.fn(async () => ({ eventId: "$media", raw: {}, roomId: "!room:example.com" })),
    postMessage: vi.fn(async () => ({ eventId: "$message", raw: {}, roomId: "!room:example.com" })),
    publishBeeperStream: vi.fn(async () => undefined),
    removeReaction: vi.fn(async () => undefined),
    sendEphemeralEvent: vi.fn(async () => ({ eventId: "$ephemeral", raw: {}, roomId: "!room:example.com" })),
    setTyping: vi.fn(async () => undefined),
    syncOnce: vi.fn(async () => undefined),
    uploadEncryptedMedia: vi.fn(async () => ({
      contentUri: "mxc://example.com/encrypted",
      file: {
        hashes: { sha256: "hash" },
        iv: "iv",
        key: {
          alg: "A256CTR",
          ext: true,
          k: "key",
          key_ops: ["encrypt", "decrypt"],
          kty: "oct",
        },
        url: "mxc://example.com/encrypted",
        v: "v2",
      },
      raw: {},
    })),
    uploadMedia: vi.fn(async () => ({ contentUri: "mxc://example.com/upload", raw: {} })),
    unsubscribeBeeperStream: vi.fn(async () => undefined),
    whoami: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@bot:example.com" })),
    ...overrides,
  };
  return {
    core,
    emit(event: MatrixCoreEvent) {
      listener?.(event);
    },
  };
}

describe("MatrixAdapter", () => {
  it("parses Matrix formatted HTML and m.mentions into Chat SDK messages", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const message = adapter.parseMessage({
      body: "Hello Alice",
      content: {
        "m.mentions": { user_ids: ["@bot:example.com"] },
        body: "Hello Alice",
        format: "org.matrix.custom.html",
        formatted_body: "<p>Hello <strong>Alice</strong></p>",
        msgtype: "m.text",
      },
      eventId: "$event",
      formattedBody: "<p>Hello <strong>Alice</strong></p>",
      msgtype: "m.text",
      raw: {},
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      type: "m.room.message",
    });

    expect(message.text).toBe("Hello Alice");
    expect(message.isMention).toBe(true);
    expect(message.threadId).toBe(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }));
  });

  it("posts formatted text with Matrix mentions and media attachments", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const threadId = encodeMatrixChatThreadRef({ roomId: "!room:example.com" });
    const result = await adapter.postMessage(threadId, {
      attachments: [
        {
          data: Buffer.from("hello"),
          mimeType: "text/plain",
          name: "note.txt",
          size: 5,
          type: "file",
        },
      ],
      markdown: "hi <@(@alice:example.com)>",
    });

    expect(result.id).toBe("$message");
    expect(core.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hi @alice",
        mentions: { userIds: ["@alice:example.com"] },
        roomId: "!room:example.com",
      })
    );
    expect(core.postMediaMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "note.txt",
        bytesBase64: Buffer.from("hello").toString("base64"),
        contentType: "text/plain",
        filename: "note.txt",
        msgtype: "m.file",
        roomId: "!room:example.com",
        size: 5,
      })
    );
  });

  it("maps Chat SDK listThreads to Matrix room threads", async () => {
    const { core } = makeCore({
      listRoomThreads: vi.fn(async () => ({
        nextCursor: "next",
        threads: [
          {
            lastReplyTs: 1_700_000_000_000,
            replyCount: 2,
            root: {
              body: "root",
              content: { body: "root", msgtype: "m.text" },
              eventId: "$root",
              msgtype: "m.text",
              raw: {},
              roomId: "!room:example.com",
              sender: "@alice:example.com",
              type: "m.room.message",
            },
          },
        ],
      })),
    });
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const result = await adapter.listThreads(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }), {
      cursor: "cursor",
      limit: 10,
    });

    expect(core.listRoomThreads).toHaveBeenCalledWith({
      cursor: "cursor",
      limit: 10,
      roomId: "!room:example.com",
    });
    expect(result.nextCursor).toBe("next");
    expect(result.threads[0]?.id).toBe(
      encodeMatrixChatThreadRef({ eventId: "$root", roomId: "!room:example.com" })
    );
    expect(result.threads[0]?.replyCount).toBe(2);
  });

  it("dispatches reaction removals from Matrix redactions", async () => {
    const { core, emit } = makeCore();
    const chat = makeChat();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(chat);

    emit({
      event: {
        added: false,
        content: {},
        eventId: "$redaction",
        key: "👍",
        raw: {},
        relatesToEventId: "$message",
        roomId: "!room:example.com",
        sender: "@alice:example.com",
        type: "m.reaction",
      },
      type: "reaction",
    });

    expect(chat.processReaction).toHaveBeenCalledWith(
      expect.objectContaining({
        added: false,
        messageId: "$message",
        rawEmoji: "👍",
      }),
      undefined
    );
  });

  it("auto-joins allowed invites", async () => {
    const { core, emit } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      inviteAutoJoin: { inviterAllowlist: ["@alice:example.com"] },
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    emit({
      event: {
        inviter: "@alice:example.com",
        raw: {},
        roomId: "!room:example.com",
      },
      type: "invite",
    });

    expect(core.joinRoom).toHaveBeenCalledWith({ roomIdOrAlias: "!room:example.com" });
  });

  it("retries transient auto-join failures", async () => {
    vi.useFakeTimers();
    try {
      const { core, emit } = makeCore({
        joinRoom: vi.fn()
          .mockRejectedValueOnce(new Error("M_LIMIT_EXCEEDED (HTTP 429): Too Many Requests"))
          .mockResolvedValueOnce({ raw: {}, roomId: "!room:example.com" }),
      });
      const adapter = new MatrixAdapter({
        accessToken: "token",
        core,
        homeserverUrl: "https://matrix.example.com",
        inviteAutoJoin: { inviterAllowlist: ["@alice:example.com"] },
        polling: { enabled: false },
      });
      await adapter.initialize(makeChat());

      emit({
        event: {
          inviter: "@alice:example.com",
          raw: {},
          roomId: "!room:example.com",
        },
        type: "invite",
      });

      await vi.waitFor(() => expect(core.joinRoom).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(1000);
      await vi.waitFor(() => expect(core.joinRoom).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });

  it("dispatches slash commands from Matrix messages", async () => {
    const { core, emit } = makeCore();
    const chat = makeChat();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      commandPrefix: "/",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(chat);

    emit({
      event: {
        body: "/status verbose",
        content: { body: "/status verbose", msgtype: "m.text" },
        eventId: "$cmd",
        isMe: false,
        msgtype: "m.text",
        raw: {},
        roomId: "!room:example.com",
        sender: "@alice:example.com",
        type: "m.room.message",
      },
      type: "message",
    });

    expect(chat.processMessage).toHaveBeenCalledOnce();
    expect(chat.processSlashCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: encodeMatrixChatThreadRef({ roomId: "!room:example.com" }),
        command: "/status",
        text: "verbose",
        triggerId: "$cmd",
      }),
      undefined
    );
  });

  it("applies sync responses directly through the Matrix core", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    await adapter.handleSyncResponse({
      response: {
        next_batch: "next",
        rooms: { join: {} },
      },
      since: "prev",
    });

    expect(core.applySyncResponse).toHaveBeenCalledWith({
      response: {
        next_batch: "next",
        rooms: { join: {} },
      },
      since: "prev",
    });
  });

  it("streams Beeper homeserver chunks as Beeper Desktop stream deltas", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.beeper.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    async function* chunks(): AsyncIterable<string | { text: string; type: "markdown_text" }> {
      yield "hel";
      yield { text: "lo", type: "markdown_text" };
    }

    const result = await adapter.stream(
      encodeMatrixChatThreadRef({ roomId: "!room:example.com" }),
      chunks()
    );

    expect(result.id).toBe("$message");
    expect(core.createBeeperStream).toHaveBeenCalledWith({
      roomId: "!room:example.com",
      streamType: "com.beeper.llm",
    });
    expect(core.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "...",
        content: {
          "com.beeper.stream": {
            device_id: "DEVICE",
            type: "com.beeper.llm",
            user_id: "@bot:example.com",
          },
        },
      })
    );
    expect(core.publishBeeperStream).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          "com.beeper.llm.deltas": [
            expect.objectContaining({
              "m.relates_to": {
                event_id: "$message",
                rel_type: "m.reference",
              },
              part: { messageId: expect.any(String), messageMetadata: { turn_id: expect.any(String) }, type: "start" },
              seq: 1,
              turn_id: expect.any(String),
            }),
          ],
        },
        eventId: "$message",
        roomId: "!room:example.com",
      })
    );
    expect(core.publishBeeperStream).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          "com.beeper.llm.deltas": [
            expect.objectContaining({
              part: { id: expect.any(String), type: "text-start" },
              seq: 2,
              turn_id: expect.any(String),
            }),
          ],
        },
        eventId: "$message",
        roomId: "!room:example.com",
      })
    );
    expect(core.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hello",
        content: { "com.beeper.dont_render_edited": true, "com.beeper.stream": null },
        messageId: "$message",
      })
    );
  });

  it("passes raw AI SDK stream parts through to Beeper", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.beeper-dev.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    async function* chunks(): AsyncIterable<Record<string, unknown>> {
      yield { id: "reasoning-1", type: "reasoning-start" };
      yield { delta: "thinking", id: "reasoning-1", type: "reasoning-delta" };
      yield {
        input: { path: "/tmp/a" },
        toolCallId: "call-1",
        toolName: "read_file",
        type: "tool-input-available",
      };
    }

    await adapter.stream(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }), chunks());

    expect(core.publishBeeperStream).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          "com.beeper.llm.deltas": [
            expect.objectContaining({
              part: { id: "reasoning-1", type: "reasoning-start" },
            }),
          ],
        },
      })
    );
    expect(core.publishBeeperStream).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          "com.beeper.llm.deltas": [
            expect.objectContaining({
              part: {
                input: { path: "/tmp/a" },
                toolCallId: "call-1",
                toolName: "read_file",
                type: "tool-input-available",
              },
            }),
          ],
        },
      })
    );
  });

  it("maps Chat SDK task and plan stream chunks to Beeper data parts", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.beeper-staging.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    async function* chunks() {
      yield { id: "task-1", status: "in_progress", title: "Search", type: "task_update" } as const;
      yield { title: "Reading results", type: "plan_update" } as const;
    }

    await adapter.stream(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }), chunks());

    expect(core.publishBeeperStream).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          "com.beeper.llm.deltas": [
            expect.objectContaining({
              part: expect.objectContaining({
                data: expect.objectContaining({ call_id: "task-1", tool_name: "Search" }),
                id: "task-1",
                type: "data-tool-progress",
              }),
            }),
          ],
        },
      })
    );
    expect(core.publishBeeperStream).toHaveBeenCalledWith(
      expect.objectContaining({
        content: {
          "com.beeper.llm.deltas": [
            expect.objectContaining({
              part: {
                data: { title: "Reading results" },
                transient: true,
                type: "data-plan-update",
              },
            }),
          ],
        },
      })
    );
  });

  it("streams non-Beeper homeservers with debounced Matrix edits", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    async function* chunks(): AsyncIterable<string> {
      yield "hel";
      yield "lo";
    }

    await adapter.stream(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }), chunks());

    expect(core.sendEphemeralEvent).not.toHaveBeenCalled();
    expect(core.publishBeeperStream).not.toHaveBeenCalled();
    expect(core.postMessage).toHaveBeenCalledWith(expect.objectContaining({ body: "hel" }));
    expect(core.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "hello",
        messageId: "$message",
      })
    );
  });

  it("posts and edits Chat SDK plan objects as Matrix markdown", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());
    const threadId = encodeMatrixChatThreadRef({ roomId: "!room:example.com" });
    const plan = {
      tasks: [
        { id: "1", status: "complete", title: "Inspect" },
        { details: { markdown: "Use Beeper stream events" }, id: "2", status: "in_progress", title: "Implement" },
      ],
      title: "Matrix work",
    };

    await adapter.postObject(threadId, "plan", plan);
    await adapter.editObject(threadId, "$message", "plan", plan);

    expect(core.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Matrix work"),
        formattedBody: expect.stringContaining("<strong>Matrix work</strong>"),
      })
    );
    expect(core.editMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        formattedBody: expect.stringContaining("checked"),
        messageId: "$message",
      })
    );
  });

  it("maps Matrix profiles to Chat SDK user info", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    await expect(adapter.getUser("@alice:example.com")).resolves.toEqual({
      avatarUrl: "mxc://example.com/avatar",
      fullName: "Alice",
      isBot: false,
      userId: "@alice:example.com",
      userName: "alice",
    });
    expect(core.getUser).toHaveBeenCalledWith({ userId: "@alice:example.com" });
  });

  it("rehydrates Matrix attachments with authenticated media downloads", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const attachment = adapter.rehydrateAttachment({
      fetchMetadata: { matrixContentUri: "mxc://example.com/plain" },
      name: "plain.bin",
      type: "file",
    });
    const bytes = await attachment.fetchData?.();

    expect(core.downloadMedia).toHaveBeenCalledWith({ contentUri: "mxc://example.com/plain" });
    expect([...new Uint8Array(bytes as Uint8Array)]).toEqual([1, 2, 3]);
  });
});

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}
