import { describe, expect, it, vi } from "vitest";
import { ClientEvent, MatrixClient, MatrixEvent, createClient, mxcUrlToHttp } from "./index";
import type { MatrixCore, MatrixCoreHost } from "better-matrix-js";

describe("matrix-js-sdk compatibility facade", () => {
  it("creates a client with matrix-js-sdk style credentials", () => {
    const client = createClient({
      accessToken: "token",
      baseUrl: "https://matrix.example",
      deviceId: "DEVICE",
      userId: "@alice:example",
    });

    expect(client.getAccessToken()).toBe("token");
    expect(client.getDeviceId()).toBe("DEVICE");
    expect(client.getUserId()).toBe("@alice:example");
    expect(client.getHomeserverUrl()).toBe("https://matrix.example/");
  });

  it("builds media download and thumbnail URLs", () => {
    expect(mxcUrlToHttp("https://matrix.example", "mxc://example.org/abc")).toBe(
      "https://matrix.example/_matrix/media/v3/download/example.org/abc"
    );
    expect(mxcUrlToHttp("https://matrix.example", "mxc://example.org/abc", 64, 64, "scale")).toBe(
      "https://matrix.example/_matrix/media/v3/thumbnail/example.org/abc?width=64&height=64&method=scale"
    );
  });

  it("adapts common sendMessage calls onto the core", async () => {
    const core = createCoreStub();
    const client = new MatrixClient({
      accessToken: "token",
      baseUrl: "https://matrix.example",
      loadCore: async (_host: MatrixCoreHost) => core,
      userId: "@alice:example",
    });

    const result = await client.sendTextMessage("!room:example", "hello");

    expect(result).toEqual({ event_id: "$sent" });
    expect(core.postMessage).toHaveBeenCalledWith({
      body: "hello",
      content: { body: "hello", msgtype: "m.text" },
      formattedBody: undefined,
      msgtype: "m.text",
      roomId: "!room:example",
    });
  });

  it("emits matrix-js-sdk style timeline and client events", async () => {
    let listener: ((event: any) => void) | undefined;
    const core = createCoreStub({
      onEvent: vi.fn((next) => {
        listener = next;
        return vi.fn();
      }),
    });
    const client = new MatrixClient({
      accessToken: "token",
      baseUrl: "https://matrix.example",
      loadCore: async () => core,
      userId: "@alice:example",
    });
    const eventSpy = vi.fn();
    const timelineSpy = vi.fn();
    client.on(ClientEvent.Event, eventSpy);
    client.on("Room.timeline", timelineSpy);

    await client.ensureCore();
    listener?.({
      event: {
        body: "hello",
        content: {},
        eventId: "$event",
        msgtype: "m.text",
        raw: {},
        roomId: "!room:example",
        sender: "@bob:example",
        type: "m.room.message",
      },
      type: "message",
    });

    expect(eventSpy.mock.calls[0]?.[0]).toBeInstanceOf(MatrixEvent);
    expect(timelineSpy).toHaveBeenCalled();
    expect(client.getRoom("!room:example")?.timeline).toHaveLength(1);
  });
});

function createCoreStub(overrides: Partial<MatrixCore> = {}): MatrixCore {
  return {
    addReaction: vi.fn(),
    applySyncResponse: vi.fn(),
    close: vi.fn(),
    createBeeperStream: vi.fn(),
    deleteMessage: vi.fn(),
    downloadEncryptedMedia: vi.fn(),
    downloadMedia: vi.fn(),
    editMessage: vi.fn(),
    fetchJoinedRooms: vi.fn(async () => ({ raw: {}, roomIds: [] })),
    fetchMessage: vi.fn(),
    fetchMessages: vi.fn(),
    fetchRoom: vi.fn(),
    getUser: vi.fn(),
    init: vi.fn(async () => ({ deviceId: "DEVICE", userId: "@alice:example" })),
    inviteUser: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    listRoomThreads: vi.fn(),
    markRead: vi.fn(),
    onEvent: vi.fn(() => vi.fn()),
    openDM: vi.fn(),
    postMediaMessage: vi.fn(),
    postMessage: vi.fn(async () => ({ eventId: "$sent", raw: {}, roomId: "!room:example" })),
    publishBeeperStream: vi.fn(),
    registerBeeperStream: vi.fn(),
    removeReaction: vi.fn(),
    sendEphemeralEvent: vi.fn(),
    setTyping: vi.fn(),
    syncOnce: vi.fn(),
    unsubscribeBeeperStream: vi.fn(),
    uploadEncryptedMedia: vi.fn(),
    uploadMedia: vi.fn(),
    whoami: vi.fn(),
    ...overrides,
  } as MatrixCore;
}
