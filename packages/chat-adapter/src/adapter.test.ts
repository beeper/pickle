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
    removeReaction: vi.fn(async () => undefined),
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

  it("applies webhook sync payloads through the Matrix core", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const response = await adapter.handleWebhook(
      new Request("https://bot.example.com/matrix", {
        body: JSON.stringify({
          response: {
            next_batch: "next",
            rooms: { join: {} },
          },
          since: "prev",
        }),
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(core.applySyncResponse).toHaveBeenCalledWith({
      response: {
        next_batch: "next",
        rooms: { join: {} },
      },
      since: "prev",
    });
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

  it("rejects non-POST webhook requests", async () => {
    const { core } = makeCore();
    const adapter = new MatrixAdapter({
      accessToken: "token",
      core,
      homeserverUrl: "https://matrix.example.com",
      polling: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const response = await adapter.handleWebhook(new Request("https://bot.example.com/matrix"));

    expect(response.status).toBe(405);
    expect(core.applySyncResponse).not.toHaveBeenCalled();
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
