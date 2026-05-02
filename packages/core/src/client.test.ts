import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatrixClient } from "./client";

interface RuntimeCall {
  coreId: string;
  operation: string;
  payload: Record<string, unknown>;
}

const originalCreate = globalThis.__matrixCoreCreate;
const originalCall = globalThis.__matrixCoreCall;

afterEach(() => {
  globalThis.__matrixCoreCreate = originalCreate;
  globalThis.__matrixCoreCall = originalCall;
});

describe("createMatrixClient", () => {
  it("maps the public message API to the runtime contract", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      mark_read: {},
      post_media_message: { eventId: "$media", raw: {}, roomId: "!room:example.com" },
      post_message: { eventId: "$message", raw: {}, roomId: "!room:example.com" },
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await client.connect();
    await client.messages.send({
      html: "<strong>Hello</strong>",
      mentions: { userIds: ["@alice:example.com"] },
      replyTo: "$parent",
      roomId: "!room:example.com",
      text: "Hello",
      threadRoot: "$thread",
    });
    await client.messages.sendMedia({
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "text/plain",
      filename: "note.txt",
      kind: "file",
      roomId: "!room:example.com",
    });
    await client.messages.markRead({ eventId: "$message", roomId: "!room:example.com" });

    expect(calls.map((call) => call.operation)).toEqual([
      "init",
      "post_message",
      "post_media_message",
      "mark_read",
    ]);
    expect(calls[1]?.payload).toMatchObject({
      body: "Hello",
      formattedBody: "<strong>Hello</strong>",
      replyToEventId: "$parent",
      roomId: "!room:example.com",
      threadRootEventId: "$thread",
    });
    expect(calls[2]?.payload).toMatchObject({
      bytesBase64: "AQID",
      contentType: "text/plain",
      filename: "note.txt",
      msgtype: "m.file",
      roomId: "!room:example.com",
    });
    expect(calls[3]?.payload).toEqual({ eventId: "$message", roomId: "!room:example.com" });
  });

  it("maps runtime events to ergonomic client events", async () => {
    installRuntime({ init: { deviceId: "DEVICE", userId: "@bot:example.com" } });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const listener = vi.fn();
    client.events.on(listener);
    await client.connect();

    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          body: "Hello",
          content: { body: "Hello", msgtype: "m.text" },
          eventId: "$message",
          formattedBody: "<strong>Hello</strong>",
          isEncrypted: true,
          isMe: false,
          msgtype: "m.text",
          originServerTs: 123,
          raw: {},
          roomId: "!room:example.com",
          sender: "@alice:example.com",
          threadRootEventId: "$thread",
          type: "m.room.message",
        },
        type: "message",
      })
    );

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted: true,
        eventId: "$message",
        html: "<strong>Hello</strong>",
        kind: "message",
        roomId: "!room:example.com",
        sender: { isMe: false, userId: "@alice:example.com" },
        text: "Hello",
        threadRoot: "$thread",
      })
    );
  });

  it("delegates sync loop lifetime to the runtime", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      start_sync: {},
      stop_sync: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    await client.connect();

    await client.sync.start({ retryDelayMs: 250, timeoutMs: 12_345 });
    await client.sync.stop();

    expect(calls.map((call) => call.operation)).toEqual(["init", "start_sync", "stop_sync"]);
    expect(calls[1]?.payload).toEqual({ retryDelayMs: 250, timeoutMs: 12_345 });
  });

  it("maps the public crypto status API to the runtime contract", async () => {
    const calls = installRuntime({
      get_crypto_status: {
        deviceId: "DEVICE",
        hasRecoveryKey: true,
        keyBackupVersion: "1",
        pendingDecryptionCount: 2,
        state: "recovery_key_loaded",
        storeBacked: true,
        userId: "@bot:example.com",
      },
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await client.connect();

    await expect(client.crypto.status()).resolves.toEqual({
      deviceId: "DEVICE",
      hasRecoveryKey: true,
      keyBackupVersion: "1",
      pendingDecryptionCount: 2,
      state: "recoveryKeyLoaded",
      storeBacked: true,
      userId: "@bot:example.com",
    });
    expect(calls.map((call) => call.operation)).toEqual(["init", "get_crypto_status"]);
    expect(calls[1]?.payload).toEqual({});
  });

  it("maps the public own profile API to the runtime contract", async () => {
    const calls = installRuntime({
      get_own_avatar_url: { avatarUrl: "mxc://example/avatar" },
      get_own_display_name: { displayName: "Bot", raw: {} },
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      set_own_avatar_url: {},
      set_own_display_name: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await client.connect();
    await expect(client.users.getOwnDisplayName()).resolves.toEqual({ displayName: "Bot", raw: {} });
    await client.users.setOwnDisplayName({ displayName: "New Bot" });
    await expect(client.users.getOwnAvatarUrl()).resolves.toEqual({ avatarUrl: "mxc://example/avatar" });
    await client.users.setOwnAvatarUrl({ avatarUrl: "mxc://example/new-avatar" });

    expect(calls.map((call) => call.operation)).toEqual([
      "init",
      "get_own_display_name",
      "set_own_display_name",
      "get_own_avatar_url",
      "set_own_avatar_url",
    ]);
    expect(calls[2]?.payload).toEqual({ displayName: "New Bot" });
    expect(calls[4]?.payload).toEqual({ avatarUrl: "mxc://example/new-avatar" });
  });

  it("streams with Matrix edits on non-Beeper homeservers", async () => {
    const calls = installRuntime({
      edit_message: { eventId: "$edit", raw: {}, roomId: "!room:example.com" },
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      post_message: { eventId: "$message", raw: {}, roomId: "!room:example.com" },
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    await client.connect();

    await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks("hel", "lo"),
    });

    expect(calls.map((call) => call.operation)).toEqual(["init", "post_message", "edit_message"]);
    expect(calls[1]?.payload).toEqual({
      body: "hel",
      roomId: "!room:example.com",
    });
    expect(calls[2]?.payload).toEqual({
      body: "hello",
      messageId: "$message",
      roomId: "!room:example.com",
    });
  });

  it("streams with Beeper stream events on Beeper homeservers", async () => {
    const calls = installRuntime({
      create_beeper_stream: {
        descriptor: {
          device_id: "DEVICE",
          type: "com.beeper.llm",
          user_id: "@bot:example.com",
        },
      },
      edit_message: { eventId: "$edit", raw: {}, roomId: "!room:example.com" },
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      post_message: { eventId: "$message", raw: {}, roomId: "!room:example.com" },
      publish_beeper_stream: {},
      register_beeper_stream: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.beeper.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    await client.connect();

    await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks("hel", { text: "lo", type: "markdown_text" }),
      threadRoot: "$thread",
    });

    expect(calls.map((call) => call.operation)).toEqual([
      "init",
      "create_beeper_stream",
      "post_message",
      "register_beeper_stream",
      "publish_beeper_stream",
      "publish_beeper_stream",
      "publish_beeper_stream",
      "publish_beeper_stream",
      "publish_beeper_stream",
      "publish_beeper_stream",
      "edit_message",
    ]);
    expect(calls[2]?.payload).toMatchObject({
      body: "...",
      roomId: "!room:example.com",
      threadRootEventId: "$thread",
    });
    expect(calls[3]?.payload).toMatchObject({
      eventId: "$message",
      roomId: "!room:example.com",
    });
    expect(calls[4]?.payload).toMatchObject({
      eventId: "$message",
      roomId: "!room:example.com",
    });
    expect(calls[10]?.payload).toMatchObject({
      body: "hello",
      messageId: "$message",
      roomId: "!room:example.com",
    });
  });

  it("uses explicit Beeper capability for non-Beeper hostnames", async () => {
    const calls = installRuntime({
      create_beeper_stream: {
        descriptor: {
          device_id: "DEVICE",
          type: "com.beeper.llm",
          user_id: "@bot:example.com",
        },
      },
      edit_message: { eventId: "$edit", raw: {}, roomId: "!room:example.com" },
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      post_message: { eventId: "$message", raw: {}, roomId: "!room:example.com" },
      publish_beeper_stream: {},
      register_beeper_stream: {},
    });
    const client = createMatrixClient({
      beeper: true,
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    await client.connect();

    await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks("hello"),
    });

    expect(calls.map((call) => call.operation)).toContain("create_beeper_stream");
    expect(calls.map((call) => call.operation)).toContain("publish_beeper_stream");
  });
});

async function* chunks(
  ...values: Array<string | Record<string, unknown>>
): AsyncIterable<string | Record<string, unknown>> {
  for (const value of values) {
    yield value;
  }
}

function installRuntime(responses: Record<string, unknown>): RuntimeCall[] {
  const calls: RuntimeCall[] = [];
  globalThis.__matrixCoreCreate = () => "core-1";
  globalThis.__matrixCoreCall = async (coreId, operation, payload) => {
    calls.push({ coreId, operation, payload: JSON.parse(payload) as Record<string, unknown> });
    return JSON.stringify(responses[operation] ?? {});
  };
  return calls;
}
