import type { MatrixClient, MatrixClientEvent, MatrixMessageEvent } from "better-matrix-js";
import type { MatrixCore, MatrixCoreEvent } from "../../core/src/runtime-types";
import type { Adapter, ChatInstance, Logger, StateAdapter } from "chat";
import { describe, expect, it, vi } from "vitest";
import { MatrixAdapter } from "./adapter";
import { encodeMatrixChatThreadRef } from "./thread-id";
import type { MatrixChatThreadRef } from "./types";

const adapterConformance: Adapter<MatrixChatThreadRef, MatrixMessageEvent> =
  null as unknown as MatrixAdapter;
void adapterConformance;

function makeLogger(): Logger {
  return {
    child: vi.fn(() => makeLogger()),
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

function makeChat(state: StateAdapter = makeState()) {
  return {
    getState: vi.fn(() => state),
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

function makeState(): StateAdapter {
  const values = new Map<string, unknown>();
  return {
    acquireLock: vi.fn(async () => null),
    appendToList: vi.fn(async () => undefined),
    connect: vi.fn(async () => undefined),
    delete: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    dequeue: vi.fn(async () => null),
    disconnect: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => 0),
    extendLock: vi.fn(async () => false),
    forceReleaseLock: vi.fn(async () => undefined),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    getList: vi.fn(async () => []),
    isSubscribed: vi.fn(async () => false),
    queueDepth: vi.fn(async () => 0),
    releaseLock: vi.fn(async () => undefined),
    set: vi.fn(async (key: string, value: unknown) => {
      values.set(key, value);
    }),
    setIfNotExists: vi.fn(async (key: string, value: unknown) => {
      if (values.has(key)) {
        return false;
      }
      values.set(key, value);
      return true;
    }),
    subscribe: vi.fn(async () => undefined),
    unsubscribe: vi.fn(async () => undefined),
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
    registerBeeperStream: vi.fn(async () => undefined),
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
  const sendStream = vi.fn(async (options: Parameters<MatrixClient["streams"]["send"]>[0]) =>
    core.postMessage({
      body: "streamed",
      content: {},
      roomId: options.roomId,
      threadRootEventId: options.threadRoot,
    })
  );
  const listeners = new Set<(event: MatrixClientEvent) => void>();
  const client: MatrixClient = {
    beeper: {
      ephemeral: {
        send: core.sendEphemeralEvent,
      },
      streams: {
        create: core.createBeeperStream,
        publish: core.publishBeeperStream,
        register: core.registerBeeperStream,
      },
    },
    close: core.close,
    connect: () =>
      core.init({
        accessToken: "token",
        homeserverUrl: "https://matrix.beeper.com",
      }),
    events: {
      on: (next) => {
        listeners.add(next);
        return () => {
          listeners.delete(next);
        };
      },
      onMessage: (next) => {
        listeners.add(next as (event: MatrixClientEvent) => void);
        return () => undefined;
      },
      onReaction: (next) => {
        listeners.add(next as (event: MatrixClientEvent) => void);
        return () => undefined;
      },
    },
    media: {
      download: async (options) => {
        const result = await core.downloadMedia(options);
        return { bytes: base64ToBytes(result.bytesBase64) };
      },
      downloadEncrypted: async (options) => {
        const result = await core.downloadEncryptedMedia(options);
        return { bytes: base64ToBytes(result.bytesBase64) };
      },
      upload: core.uploadMedia as MatrixClient["media"]["upload"],
      uploadEncrypted: core.uploadEncryptedMedia as MatrixClient["media"]["uploadEncrypted"],
    },
    messages: {
      edit: (options) =>
        core.editMessage({
          body: options.text,
          content: options.content,
          formattedBody: options.html,
          mentions: options.mentions,
          messageId: options.eventId,
          roomId: options.roomId,
        }),
      get: async (options) => {
        const result = await core.fetchMessage({ messageId: options.eventId, roomId: options.roomId });
        return { message: result.message ? testMessageEvent(result.message) : null };
      },
      list: async (options) => {
        const result = await core.fetchMessages({
          cursor: options.cursor,
          direction: options.direction,
          limit: options.limit,
          roomId: options.roomId,
          threadRootEventId: options.threadRoot,
        });
        return { messages: result.messages.map(testMessageEvent), nextCursor: result.nextCursor };
      },
      redact: (options) => core.deleteMessage({ messageId: options.eventId, reason: options.reason, roomId: options.roomId }),
      send: (options) =>
        core.postMessage({
          body: options.text,
          content: options.content,
          formattedBody: options.html,
          mentions: options.mentions,
          replyToEventId: options.replyTo,
          roomId: options.roomId,
          threadRootEventId: options.threadRoot,
        }),
      sendMedia: (options) =>
        core.postMediaMessage({
          body: options.caption,
          bytesBase64: bytesToBase64(options.bytes),
          contentType: options.contentType,
          filename: options.filename,
          height: options.height,
          msgtype: `m.${options.kind}` as "m.image" | "m.video" | "m.audio" | "m.file",
          roomId: options.roomId,
          size: options.size,
          threadRootEventId: options.threadRoot,
          width: options.width,
        }),
    },
    reactions: {
      redact: (options) => core.removeReaction({ emoji: options.key, messageId: options.eventId, roomId: options.roomId }),
      send: (options) => core.addReaction({ emoji: options.key, messageId: options.eventId, roomId: options.roomId }),
    },
    rooms: {
      get: core.fetchRoom,
      invite: core.inviteUser,
      join: core.joinRoom,
      leave: core.leaveRoom,
      listJoined: core.fetchJoinedRooms,
      openDM: core.openDM,
      threads: {
        list: async (options) => {
          const result = await core.listRoomThreads(options);
          return {
            nextCursor: result.nextCursor,
            threads: result.threads.map((thread) => ({
              lastReplyTimestamp: thread.lastReplyTs,
              replyCount: thread.replyCount,
              root: testMessageEvent(thread.root),
            })),
          };
        },
      },
    },
    streams: {
      send: sendStream,
    },
    sync: {
      applyResponse: core.applySyncResponse,
      once: core.syncOnce,
      start: async () => undefined,
      stop: async () => undefined,
    },
    typing: { set: core.setTyping },
    users: { get: core.getUser },
    whoami: core.whoami,
  };
  return {
    client,
    core,
    emit(event: MatrixCoreEvent) {
      listener?.(event);
      const mapped = testClientEvent(event);
      if (mapped) {
        for (const next of listeners) next(mapped);
      }
    },
    sendStream,
  };
}

function testClientEvent(event: MatrixCoreEvent): MatrixClientEvent | null {
  if (event.type === "message") return testMessageEvent(event.event);
  if (event.type === "reaction") {
    return {
      added: event.event.added ?? true,
      class: "message",
      content: event.event.content,
      eventId: event.event.eventId,
      key: event.event.key,
      kind: "reaction",
      raw: event.event.raw,
      relatesTo: event.event.relatesToEventId,
      roomId: event.event.roomId,
      sender: { isMe: event.event.isMe ?? false, userId: event.event.sender },
      timestamp: event.event.originServerTs,
      type: event.event.type,
    };
  }
  if (event.type === "invite") return { kind: "invite", ...event.event };
  if (event.type === "crypto_status") return { kind: "crypto", state: "enabled" };
  if (event.type === "decryption_error") return { error: event.error, kind: "decryptionError" };
  if (event.type === "error") return { error: event.error, kind: "error" };
  if (event.type === "sync_status") return { kind: "sync", state: "synced" };
  return null;
}

function testMessageEvent(event: Extract<MatrixCoreEvent, { type: "message" }>["event"]): MatrixClientEvent & { kind: "message" } {
  return {
    attachments: (event.attachments ?? []).map((attachment) => ({
      contentType: attachment.info?.contentType,
      contentUri: attachment.contentUri,
      encryptedFile: attachment.encryptedFile,
      filename: attachment.filename,
      height: attachment.info?.height,
      kind: attachment.msgtype.slice(2) as "image" | "video" | "audio" | "file",
      size: attachment.info?.size,
      width: attachment.info?.width,
    })),
    class: "message",
    content: event.content,
    edited: event.isEdited ?? false,
    encrypted: event.isEncrypted ?? false,
    eventId: event.eventId,
    html: event.formattedBody,
    kind: "message",
    messageType: event.msgtype,
    raw: event.raw,
    relation: event.relation,
    replaces: event.replaces,
    replyTo: event.replyTo,
    roomId: event.roomId,
    sender: { isMe: event.isMe ?? false, userId: event.sender },
    text: event.body,
    threadRoot: event.threadRootEventId,
    timestamp: event.originServerTs,
    type: event.type,
  };
}

describe("MatrixAdapter", () => {
  it("uses Beeper as the default homeserver", async () => {
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      sync: { enabled: false },
    });

    await adapter.initialize(makeChat());

    expect(core.init).toHaveBeenCalledWith({
      accessToken: "token",
      homeserverUrl: "https://matrix.beeper.com",
    });
  });

  it("connects the injected Matrix client", async () => {
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      deviceId: "DEVICE",
      homeserver: "https://matrix.example.com",
      initialSync: "persisted",
      since: "s123",
      sync: { enabled: false },
      userId: "@bot:example.com",
    });
    await adapter.initialize(makeChat());

    expect(core.init).toHaveBeenCalledOnce();
  });

  it("parses Matrix formatted HTML and m.mentions into Chat SDK messages", async () => {
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const message = adapter.parseMessage(testMessageEvent({
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
      relation: { eventId: "$original", type: "m.replace" },
      replaces: "$original",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      type: "m.room.message",
    }));

    expect(message.text).toBe("Hello Alice");
    expect(message.isMention).toBe(true);
    expect(message.threadId).toBe(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }));
  });

  it("only derives thread ids from Matrix thread relations", async () => {
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
    });
    await adapter.initialize(makeChat());

    const edit = adapter.parseMessage(testMessageEvent({
      body: "Edited",
      content: {
        "m.relates_to": {
          event_id: "$original",
          rel_type: "m.replace",
        },
        body: "Edited",
        msgtype: "m.text",
      },
      eventId: "$edit",
      msgtype: "m.text",
      raw: {},
      relation: { eventId: "$original", type: "m.replace" },
      replaces: "$original",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      type: "m.room.message",
    }));

    const threadReply = adapter.parseMessage(testMessageEvent({
      body: "Reply",
      content: {
        "m.relates_to": {
          event_id: "$root",
          rel_type: "m.thread",
        },
        body: "Reply",
        msgtype: "m.text",
      },
      eventId: "$reply",
      msgtype: "m.text",
      raw: {},
      relation: { eventId: "$root", type: "m.thread" },
      threadRootEventId: "$root",
      roomId: "!room:example.com",
      sender: "@alice:example.com",
      type: "m.room.message",
    }));

    expect(edit.threadId).toBe(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }));
    expect(threadReply.threadId).toBe(
      encodeMatrixChatThreadRef({ eventId: "$root", roomId: "!room:example.com" })
    );
  });

  it("posts formatted text with Matrix mentions and media attachments", async () => {
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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
    const { client, core } = makeCore({
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
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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
    const { client, core, emit } = makeCore();
    const chat = makeChat();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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
    const { client, core, emit } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      inviteAutoJoin: { inviterAllowlist: ["@alice:example.com"] },
      sync: { enabled: false },
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
      const { client, core, emit } = makeCore({
        joinRoom: vi.fn()
          .mockRejectedValueOnce(new Error("M_LIMIT_EXCEEDED (HTTP 429): Too Many Requests"))
          .mockResolvedValueOnce({ raw: {}, roomId: "!room:example.com" }),
      });
      const adapter = new MatrixAdapter({
        token: "token",
      client,
        homeserver: "https://matrix.example.com",
        inviteAutoJoin: { inviterAllowlist: ["@alice:example.com"] },
        sync: { enabled: false },
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
    const { client, core, emit } = makeCore();
    const chat = makeChat();
    const adapter = new MatrixAdapter({
      token: "token",
      commandPrefix: "/",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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

  it("delegates Beeper homeserver streams to the core stream API", async () => {
    const { client, sendStream } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.beeper.com",
      sync: { enabled: false },
    });
    await adapter.initialize(makeChat());

    async function* chunks(): AsyncIterable<string | { text: string; type: "markdown_text" }> {
      yield "hel";
      yield { text: "lo", type: "markdown_text" };
    }

    const result = await adapter.stream(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }), chunks());

    expect(result.id).toBe("$message");
    expect(sendStream).toHaveBeenCalledWith(expect.objectContaining({
      mode: "beeper",
      roomId: "!room:example.com",
    }));
    await expect(collectAsyncIterable(sendStream.mock.calls[0]![0].stream)).resolves.toEqual([
      "hel",
      { text: "lo", type: "markdown_text" },
    ]);
  });

  it("delegates non-Beeper streams to core edit fallback mode", async () => {
    const { client, sendStream } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
    });
    await adapter.initialize(makeChat());

    async function* chunks(): AsyncIterable<string> {
      yield "hel";
      yield "lo";
    }

    await adapter.stream(encodeMatrixChatThreadRef({ roomId: "!room:example.com" }), chunks(), {
      updateIntervalMs: 25,
    });

    expect(sendStream).toHaveBeenCalledWith(expect.objectContaining({
      mode: "edits",
      roomId: "!room:example.com",
      updateIntervalMs: 25,
    }));
    await expect(collectAsyncIterable(sendStream.mock.calls[0]![0].stream)).resolves.toEqual(["hel", "lo"]);
  });

  it("posts and edits Chat SDK plan objects as Matrix markdown", async () => {
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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
    const { client, core } = makeCore();
    const adapter = new MatrixAdapter({
      token: "token",
      client,
      homeserver: "https://matrix.example.com",
      sync: { enabled: false },
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

function base64ToBytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

async function collectAsyncIterable<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}
