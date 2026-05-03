# better-matrix-js API Overview

`better-matrix-js` is a Matrix client SDK built around one lifecycle model:

- `createMatrixClient(options)` is synchronous and inert.
- First awaited Matrix method lazily boots WASM, store, account identity, and crypto.
- `client.boot()` exists when an app wants startup failures early.
- Live events only flow through `client.subscribe(filter, handler)`.
- Serverless sync payloads enter through `client.sync.applyResponse({ response, since })`.

There is no public `connect()`, `events`, `sync.start()`, `sync.once()`, or `sync.stop()`.

## Migration Stance

This SDK has not had a stable public release. The v1 API intentionally deletes old generated shapes instead of preserving aliases. Treat stale examples that mention `connect()`, root `events`, or public `sync.start()` as obsolete.

## Account Objects

Use `MatrixAccount` as the serializable account/session shape:

```ts
type MatrixAccount = {
  homeserver: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  metadata?: Record<string, unknown>;
};
```

`deviceId` is immutable identity returned by Matrix login/whoami. Do not generate or edit it as a runtime option for an existing access token.

```ts
const login = createMatrixLogin({ homeserver: "https://matrix.example.com" });
const account = await login.token({ token: process.env.MATRIX_LOGIN_TOKEN! });

const client = createMatrixClient({
  account,
  pickleKey: process.env.MATRIX_PICKLE_KEY!,
  store,
});

await client.whoami();
```

## CLI Usage Without Sync

Request-style programs can send/fetch and exit without subscribing:

```ts
const client = createMatrixClient({ account, store, pickleKey });

await client.messages.send({
  roomId: "!room:example.com",
  text: "done",
});

await client.close();
```

No `/sync` loop is started by construction, `boot()`, `whoami()`, send, fetch, or pagination.

## Live Subscriptions

Use one root live primitive:

```ts
const sub = await client.subscribe({ kind: "message", roomId }, async (event) => {
  if (event.kind !== "message" || event.sender.isMe) return;
  await client.messages.send({
    roomId: event.roomId,
    text: "ack",
    replyTo: event.eventId,
  });
});

await sub.stop();
await sub.done;
```

The first subscriber starts the internal sync runner. Stopping the last subscriber stops it. Multiple subscribers share one runner.

## Catch-Up

Subscriptions are future-only by default. A reused account does not replay stored-cursor backlog unless the caller asks:

```ts
const sub = await client.subscribe({ kind: "message" }, onMessage);
await sub.catchUp();
```

`catchUp()` replays missed events from the stored cursor through that subscription.

## Helper Functions

Pure helpers are thin wrappers over `client.subscribe`:

```ts
import { onInvite, onMessage, onRawEvent, onReaction } from "better-matrix-js";

await onMessage(client, { roomId }, handler);
await onReaction(client, { relationEventId: "$event" }, handler);
await onInvite(client, undefined, handler);
await onRawEvent(client, { roomId }, handler);
```

They are not separate event systems.

## Serverless Apply

When `/sync` is owned by another process, pass raw Matrix sync JSON to the client:

```ts
await client.sync.applyResponse({ response, since });
```

Only one writer should advance an encrypted Matrix device cursor and crypto store at a time. In serverless deployments, serialize work through a Durable Object, a lock, or another single-writer mechanism.

Live mode owns the cursor inside `client.subscribe(...)`. Webhook mode owns the cursor in the external sync producer and applies the payload to the account client. Cloudflare mode should use one sync Durable Object to poll Matrix and one account Durable Object to apply responses and run bot code.

## Raw Requests

Use `client.raw.request` for advanced Matrix endpoints without adding throwaway wrappers:

```ts
const result = await client.raw.request({
  method: "POST",
  path: "/_matrix/client/v3/rooms/!room:example/send/m.room.message/txn",
  body: { msgtype: "m.text", body: "hello" },
});
```

The path must be relative to the homeserver.

## E2EE Storage

Encrypted bots should always use durable storage and a stable `pickleKey`:

```ts
const client = createMatrixClient({
  account,
  store,
  pickleKey: process.env.MATRIX_PICKLE_KEY!,
  recoveryKey: process.env.MATRIX_RECOVERY_KEY,
});
```

`recoveryKey` unlocks Matrix key backup for historical encrypted messages. `pickleKey` protects local crypto state and must remain stable for the device/store pair.

## Unsupported Chat SDK Features

Matrix has no native portable equivalent for Chat SDK modals, scheduled messages, or interactive cards/actions. The adapter may render plain text only when that does not imply unsupported interactivity; otherwise it should throw clearly.

## Beeper

Beeper is first-class, but non-standard behavior stays explicit. Native stream events and ephemeral sends live under `client.beeper.*`, and the Chat SDK adapter only uses them when the homeserver is Beeper or `beeper: true` is configured. Standard Matrix homeservers use Matrix edit-based streaming and reject Beeper-only ephemeral sends.
