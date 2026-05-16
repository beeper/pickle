import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatrixClient } from "./client";
import { onInvite, onMessage, onRawEvent, onReaction } from "./helpers";

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
    const sub = await client.subscribe({}, listener);

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
    await sub.stop();
  });

  it("maps raw and generic sync events through subscriptions", async () => {
    installRuntime({ init: { deviceId: "DEVICE", userId: "@bot:example.com" }, start_sync: {}, stop_sync: {} });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const accountData = vi.fn();
    const deviceList = vi.fn();
    const presence = vi.fn();
    const raw = vi.fn();
    const typing = vi.fn();
    const accountSub = await client.subscribe({ kind: "accountData" }, accountData);
    const deviceSub = await client.subscribe({ kind: "deviceList" }, deviceList);
    const presenceSub = await client.subscribe({ kind: "presence" }, presence);
    const rawSub = await onRawEvent(client, { roomId: "!room:example.com" }, raw);
    const typingSub = await client.subscribe({ kind: "typing" }, typing);

    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          class: "accountData",
          content: { direct: {} },
          raw: { content: { direct: {} } },
          type: "m.direct",
        },
        type: "account_data",
      })
    );
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          class: "raw",
          content: { body: "hello" },
          eventId: "$event",
          raw: { event_id: "$event" },
          roomId: "!room:example.com",
          section: "room_timeline",
          sender: "@alice:example.com",
          nextBatch: "s124",
          type: "m.room.message",
        },
        nextBatch: "s124",
        since: "s123",
        type: "raw_event",
      })
    );
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          class: "typing",
          content: { user_ids: ["@alice:example.com"] },
          raw: { content: { user_ids: ["@alice:example.com"] } },
          roomId: "!room:example.com",
          section: "room_ephemeral",
          type: "m.typing",
        },
        type: "typing",
      })
    );
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          class: "presence",
          content: { presence: "online" },
          raw: { content: { presence: "online" } },
          section: "presence",
          sender: "@alice:example.com",
          type: "m.presence",
        },
        type: "presence",
      })
    );
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          class: "deviceList",
          content: { changed: ["@alice:example.com"], left: [] },
          raw: { changed: ["@alice:example.com"], left: [] },
          section: "device_lists",
          type: "m.device_list",
        },
        type: "device_list",
      })
    );

    expect(accountData).toHaveBeenCalledWith(expect.objectContaining({
      content: { direct: {} },
      kind: "accountData",
      type: "m.direct",
    }));
    expect(typing).toHaveBeenCalledWith(expect.objectContaining({
      content: { user_ids: ["@alice:example.com"] },
      kind: "typing",
      roomId: "!room:example.com",
      type: "m.typing",
    }));
    expect(presence).toHaveBeenCalledWith(expect.objectContaining({
      content: { presence: "online" },
      kind: "presence",
      sender: { isMe: false, userId: "@alice:example.com" },
      type: "m.presence",
    }));
    expect(deviceList).toHaveBeenCalledWith(expect.objectContaining({
      content: { changed: ["@alice:example.com"], left: [] },
      kind: "deviceList",
      type: "m.device_list",
    }));
    expect(raw).toHaveBeenCalledWith(expect.objectContaining({
      event: expect.objectContaining({
        eventId: "$event",
        kind: "raw",
        nextBatch: "s124",
        roomId: "!room:example.com",
        since: "s123",
      }),
      raw: { event_id: "$event" },
      source: {
        kind: "raw",
        roomId: "!room:example.com",
        type: "m.room.message",
      },
    }));
    await accountSub.stop();
    await deviceSub.stop();
    await presenceSub.stop();
    await rawSub.stop();
    await typingSub.stop();
  });

  it("maps Beeper stream updates through subscriptions", async () => {
    installRuntime({ init: { deviceId: "DEVICE", userId: "@bot:example.com" }, start_sync: {}, stop_sync: {} });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const stream = vi.fn();
    const sub = await client.subscribe({ kind: "stream", roomId: "!room:example.com" }, stream);

    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          content: {
            "com.beeper.llm.deltas": [{
              part: { delta: "hi", id: "text", type: "text-delta" },
              seq: 1,
              target_event: "$message",
              turn_id: "turn_1",
            }],
            event_id: "$message",
            room_id: "!room:example.com",
          },
          eventId: "$message",
          raw: {},
          roomId: "!room:example.com",
          sender: "@bot:example.com",
        },
        type: "beeper_stream_update",
      })
    );

    expect(stream).toHaveBeenCalledWith(expect.objectContaining({
      class: "toDevice",
      content: expect.objectContaining({ event_id: "$message" }),
      eventId: "$message",
      kind: "stream",
      roomId: "!room:example.com",
      sender: { isMe: false, userId: "@bot:example.com" },
      type: "com.beeper.stream.update",
    }));
    await sub.stop();
  });

  it("keeps pure event helpers as thin subscription filters", async () => {
    installRuntime({ init: { deviceId: "DEVICE", userId: "@bot:example.com" }, start_sync: {}, stop_sync: {} });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const message = vi.fn();
    const reaction = vi.fn();
    const invite = vi.fn();
    const messageSub = await onMessage(client, { roomId: "!room:example.com" }, message);
    const reactionSub = await onReaction(client, { roomId: "!room:example.com" }, reaction);
    const inviteSub = await onInvite(client, undefined, invite);

    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          body: "Hello",
          content: { body: "Hello", msgtype: "m.text" },
          eventId: "$message",
          msgtype: "m.text",
          raw: {},
          roomId: "!room:example.com",
          sender: "@alice:example.com",
          type: "m.room.message",
        },
        type: "message",
      })
    );
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          content: {},
          eventId: "$reaction",
          key: "+1",
          raw: {},
          relatesToEventId: "$message",
          roomId: "!room:example.com",
          sender: "@alice:example.com",
          type: "m.reaction",
        },
        type: "reaction",
      })
    );
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: { raw: {}, roomId: "!invite:example.com" },
        type: "invite",
      })
    );

    expect(message).toHaveBeenCalledWith(expect.objectContaining({ eventId: "$message", kind: "message" }));
    expect(reaction).toHaveBeenCalledWith(expect.objectContaining({ eventId: "$reaction", kind: "reaction" }));
    expect(invite).toHaveBeenCalledWith(expect.objectContaining({ kind: "invite", roomId: "!invite:example.com" }));
    await messageSub.stop();
    await reactionSub.stop();
    await inviteSub.stop();
  });

  it("shares one sync runner across multiple subscribers", async () => {
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

    const first = await client.subscribe({ kind: "message" }, () => undefined);
    const second = await client.subscribe({ kind: "reaction" }, () => undefined);
    await first.stop();
    await second.stop();

    expect(calls.map((call) => call.operation)).toEqual(["init", "start_sync", "stop_sync"]);
    await expect(first.done).resolves.toBeUndefined();
    await expect(second.done).resolves.toBeUndefined();
  });

  it("boots without starting sync or delivering app events", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await expect(client.boot()).resolves.toEqual({
      deviceId: "DEVICE",
      userId: "@bot:example.com",
    });
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          body: "Ignored",
          content: { body: "Ignored", msgtype: "m.text" },
          eventId: "$ignored",
          msgtype: "m.text",
          raw: {},
          roomId: "!room:example.com",
          sender: "@alice:example.com",
          type: "m.room.message",
        },
        type: "message",
      })
    );

    expect(calls.map((call) => call.operation)).toEqual(["init"]);
  });

  it("rejects subscription done when a handler fails", async () => {
    installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      start_sync: {},
      stop_sync: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const failure = new Error("handler failed");
    const sub = await client.subscribe({ kind: "message" }, () => {
      throw failure;
    });

    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          body: "Hello",
          content: { body: "Hello", msgtype: "m.text" },
          eventId: "$message",
          msgtype: "m.text",
          raw: {},
          roomId: "!room:example.com",
          sender: "@alice:example.com",
          type: "m.room.message",
        },
        type: "message",
      })
    );

    await expect(sub.done).rejects.toThrow("handler failed");
    await sub.stop();
  });

  it("rejects subscription done when the core emits an unrecoverable error", async () => {
    installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      start_sync: {},
      stop_sync: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const sub = await client.subscribe({}, () => undefined);

    globalThis.__matrixCoreEmit?.("core-1", JSON.stringify({ error: "sync died", type: "error" }));

    await expect(sub.done).rejects.toThrow("sync died");
    await sub.stop();
  });

  it("delegates subscription lifetime to the runtime", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      sync_once: {},
      start_sync: {},
      stop_sync: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const sub = await client.subscribe({ kind: "message" }, () => undefined);
    await sub.catchUp();
    await sub.stop();

    expect(calls.map((call) => call.operation)).toEqual(["init", "start_sync", "sync_once", "stop_sync"]);
    expect(calls[1]?.payload).toEqual({});
    expect(calls[2]?.payload).toEqual({ replayMissed: true });
  });

  it("passes sync tuning through subscribe without exposing sync.start", async () => {
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

    const sub = await client.subscribe({}, () => undefined, {
      retryDelayMs: 250,
      timeoutMs: 5000,
    });
    await sub.stop();

    expect(calls.map((call) => call.operation)).toEqual(["init", "start_sync", "stop_sync"]);
    expect(calls[1]?.payload).toEqual({
      retryDelayMs: 250,
      timeoutMs: 5000,
    });
  });

  it("can subscribe to externally applied sync without starting live sync", async () => {
    const calls = installRuntime({
      apply_sync_response: {},
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      stop_sync: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const listener = vi.fn();

    const sub = await client.subscribe({}, listener, { live: false });
    await client.sync.applyResponse({ response: { next_batch: "s1" } });
    globalThis.__matrixCoreEmit?.(
      "core-1",
      JSON.stringify({
        event: {
          body: "Webhook",
          content: { body: "Webhook", msgtype: "m.text" },
          eventId: "$webhook",
          raw: {},
          roomId: "!room:example.com",
          sender: "@alice:example.com",
          type: "m.room.message",
        },
        type: "message",
      })
    );
    await sub.stop();

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$webhook",
      kind: "message",
    }));
    expect(calls.map((call) => call.operation)).toEqual(["init", "apply_sync_response", "stop_sync"]);
  });

  it("delivers catchUp events only to the calling subscription", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      start_sync: {},
      stop_sync: {},
      sync_once: async () => {
        globalThis.__matrixCoreEmit?.(
          "core-1",
          JSON.stringify({
            event: {
              body: "Missed",
              content: { body: "Missed", msgtype: "m.text" },
              eventId: "$missed",
              msgtype: "m.text",
              raw: {},
              roomId: "!room:example.com",
              sender: "@alice:example.com",
              type: "m.room.message",
            },
            type: "message",
          })
        );
        return {};
      },
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const first = vi.fn();
    const second = vi.fn();
    const firstSub = await client.subscribe({ kind: "message" }, first);
    const secondSub = await client.subscribe({ kind: "message" }, second);

    await firstSub.catchUp();

    expect(calls.map((call) => call.operation)).toEqual(["init", "start_sync", "sync_once"]);
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ eventId: "$missed" }));
    expect(second).not.toHaveBeenCalled();
    await firstSub.stop();
    await secondSub.stop();
  });

  it("filters events by sender, relation, and thread", async () => {
    installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      start_sync: {},
      stop_sync: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });
    const listener = vi.fn();
    const sub = await client.subscribe({
      kind: "message",
      relationEventId: "$thread",
      sender: "@alice:example.com",
      threadRoot: "$thread",
    }, listener);

    for (const [eventId, sender, threadRoot] of [
      ["$wrong-sender", "@bob:example.com", "$thread"],
      ["$wrong-thread", "@alice:example.com", "$other"],
      ["$match", "@alice:example.com", "$thread"],
    ]) {
      globalThis.__matrixCoreEmit?.(
        "core-1",
        JSON.stringify({
          event: {
            body: "Hello",
            content: { body: "Hello", msgtype: "m.text" },
            eventId,
            msgtype: "m.text",
            raw: {},
            relation: { eventId: threadRoot, type: "m.thread" },
            roomId: "!room:example.com",
            sender,
            threadRootEventId: threadRoot,
            type: "m.room.message",
          },
          type: "message",
        })
      );
    }

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ eventId: "$match" }));
    await sub.stop();
  });

  it("maps account data, to-device, receipts, and raw requests to core operations", async () => {
    const calls = installRuntime({
      get_account_data: { content: { theme: "dark" }, raw: { theme: "dark" }, type: "m.preference" },
      get_room_account_data: { content: { muted: true }, raw: { muted: true }, type: "m.room.preference" },
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      raw_request: { body: { ok: true }, headers: {}, raw: { ok: true }, status: 200 },
      send_receipt: {},
      send_to_device: { raw: {} },
      set_account_data: {},
      set_room_account_data: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await expect(client.accountData.get({ eventType: "m.preference" })).resolves.toEqual({
      content: { theme: "dark" },
      raw: { theme: "dark" },
      type: "m.preference",
    });
    await client.accountData.set({ content: { theme: "light" }, eventType: "m.preference" });
    await expect(client.accountData.getRoom({
      eventType: "m.room.preference",
      roomId: "!room:example.com",
    })).resolves.toEqual({
      content: { muted: true },
      raw: { muted: true },
      type: "m.room.preference",
    });
    await client.accountData.setRoom({
      content: { muted: false },
      eventType: "m.room.preference",
      roomId: "!room:example.com",
    });
    await client.toDevice.send({
      content: { hello: true },
      deviceId: "DEVICE2",
      eventType: "m.test",
      userId: "@alice:example.com",
    });
    await client.receipts.send({
      eventId: "$event",
      receiptType: "m.read.private",
      roomId: "!room:example.com",
      threadId: "$thread",
    });
    await client.raw.request({
      body: { include: true },
      method: "POST",
      path: "/_matrix/client/v3/custom",
      query: { q: "1" },
    });

    expect(calls.map((call) => call.operation)).toEqual([
      "init",
      "get_account_data",
      "set_account_data",
      "get_room_account_data",
      "set_room_account_data",
      "send_to_device",
      "send_receipt",
      "raw_request",
    ]);
    expect(calls[5]?.payload).toEqual({
      content: { hello: true },
      deviceId: "DEVICE2",
      eventType: "m.test",
      userId: "@alice:example.com",
    });
    expect(calls[6]?.payload).toEqual({
      eventId: "$event",
      receiptType: "m.read.private",
      roomId: "!room:example.com",
      threadId: "$thread",
    });
    expect(calls[7]?.payload).toEqual({
      body: { include: true },
      method: "POST",
      path: "/_matrix/client/v3/custom",
      query: { q: "1" },
    });
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

  it("maps logout to the runtime contract", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      logout: {},
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await client.logout();

    expect(calls.map((call) => call.operation)).toEqual(["init", "logout"]);
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
    const sent = await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks("hel", "lo"),
    });

    expect(sent.eventId).toBe("$message");
    expect(sent.raw).toEqual({
      logicalEventId: "$message",
      raw: {},
      replacementEventId: "$edit",
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
    const sent = await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks("hel", { text: "lo", type: "markdown_text" }),
      threadRoot: "$thread",
    });

    expect(sent.eventId).toBe("$message");
    expect(sent.raw).toEqual({
      logicalEventId: "$message",
      raw: {},
      replacementEventId: "$edit",
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
      content: {
        "com.beeper.ai": {
          id: expect.any(String),
          parts: [],
          role: "assistant",
        },
        "com.beeper.stream": {
          type: "com.beeper.llm",
        },
      },
      roomId: "!room:example.com",
      threadRootEventId: "$thread",
    });
    expect(calls[3]?.payload).toMatchObject({
      eventId: "$message",
      roomId: "!room:example.com",
    });
    expect(calls[4]?.payload).toMatchObject({
      content: {
        "com.beeper.llm.deltas": [{
          part: {
            messageMetadata: expect.any(Object),
            type: "start",
          },
          seq: 1,
          target_event: "$message",
          turn_id: expect.any(String),
        }],
      },
      eventId: "$message",
      roomId: "!room:example.com",
    });
    expect(calls[10]?.payload).toMatchObject({
      body: "hello",
      content: {
        "com.beeper.ai": {
          id: expect.any(String),
          parts: [{ text: "hello", type: "text" }],
          role: "assistant",
        },
        "com.beeper.stream": null,
      },
      messageId: "$message",
      roomId: "!room:example.com",
      topLevelContent: {
        "com.beeper.dont_render_edited": true,
        "com.beeper.stream": null,
      },
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
    await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks("hello"),
    });

    expect(calls.map((call) => call.operation)).toContain("create_beeper_stream");
    expect(calls.map((call) => call.operation)).toContain("publish_beeper_stream");
  });

  it("keeps accumulated UI message parts in the Beeper final edit", async () => {
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

    await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks(
        { id: "reasoning", type: "reasoning-start" },
        { delta: "thinking", id: "reasoning", type: "reasoning-delta" },
        { id: "reasoning", type: "reasoning-end" },
        { data: { stage: 1 }, id: "status", type: "data-status" },
        { sourceId: "src-1", title: "Docs", type: "source-url", url: "https://example.com" },
        { id: "text", type: "text-start" },
        { delta: "hello", id: "text", type: "text-delta" },
        { id: "text", type: "text-end" },
      ),
    });

    const edit = calls.find((call) => call.operation === "edit_message")?.payload;
    expect(edit).toMatchObject({
      body: "hello",
      content: {
        "com.beeper.ai": {
          parts: [
            { state: "done", text: "thinking", type: "reasoning" },
            { data: { stage: 1 }, id: "status", type: "data-status" },
            { sourceId: "src-1", title: "Docs", type: "source-url", url: "https://example.com" },
            { state: "done", text: "hello", type: "text" },
          ],
          role: "assistant",
        },
      },
      topLevelContent: {
        "com.beeper.dont_render_edited": true,
      },
    });
  });

  it("lets callers override the Beeper final AI message", async () => {
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

    await client.streams.send({
      finalAIMessage: {
        id: "final",
        parts: [{ text: "override", type: "text" }],
        role: "assistant",
      },
      finalText: "override",
      roomId: "!room:example.com",
      stream: chunks("ignored"),
    });

    const edit = calls.find((call) => call.operation === "edit_message")?.payload;
    expect(edit).toMatchObject({
      body: "override",
      content: {
        "com.beeper.ai": {
          id: "final",
          parts: [{ text: "override", type: "text" }],
          role: "assistant",
        },
      },
    });
  });

  it("normalizes generic stream chunk shapes", async () => {
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

    await client.streams.send({
      roomId: "!room:example.com",
      stream: chunks({ delta: "hel" }, { markdown: "lo" }, { ignored: true }),
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

  it("sends placeholder text for empty streams", async () => {
    const calls = installRuntime({
      init: { deviceId: "DEVICE", userId: "@bot:example.com" },
      post_message: { eventId: "$message", raw: {}, roomId: "!room:example.com" },
    });
    const client = createMatrixClient({
      homeserver: "https://matrix.example.com",
      token: "token",
      wasmModule: {} as WebAssembly.Module,
    });

    await client.streams.send({ roomId: "!room:example.com", stream: chunks() });

    expect(calls.map((call) => call.operation)).toEqual(["init", "post_message"]);
    expect(calls[1]?.payload).toEqual({
      body: "...",
      roomId: "!room:example.com",
    });
  });
});

async function* chunks(
  ...values: Array<string | Record<string, unknown>>
): AsyncIterable<string | Record<string, unknown>> {
  for (const value of values) {
    yield value;
  }
}

function installRuntime(responses: Record<string, unknown | (() => unknown | Promise<unknown>)>): RuntimeCall[] {
  const calls: RuntimeCall[] = [];
  globalThis.__matrixCoreCreate = () => "core-1";
  globalThis.__matrixCoreCall = async (coreId, operation, payload) => {
    calls.push({ coreId, operation, payload: JSON.parse(payload) as Record<string, unknown> });
    const response = responses[operation];
    return JSON.stringify(typeof response === "function" ? await response() : response ?? {});
  };
  return calls;
}
