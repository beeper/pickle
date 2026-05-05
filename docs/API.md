# API Reference

The full `@beeper/pickle` surface. Start with the [Pickle README](../packages/pickle) for quickstart.

## Lifecycle

```ts
const client = createMatrixClient(options);   // sync, inert
await client.boot();                           // optional, surfaces startup failures
await client.whoami();                         // confirms identity
await client.close();                          // shuts down sync runner + WASM
await client.logout();                         // server-side device logout + close
```

The first awaited Matrix call lazily boots WASM, the store, account identity, and crypto.

## Account

```ts
type MatrixAccount = {
  homeserver: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  metadata?: Record<string, unknown>;
};
```

`deviceId` is server-assigned and immutable for a given access token. Persist `userId`, `deviceId`, and `accessToken` from your first login — or pass `account: session` from `@beeper/pickle/auth`.

## Login

```ts
import { loginWithMatrixPassword, loginWithMatrixToken } from "@beeper/pickle/auth";

const passwordSession = await loginWithMatrixPassword({ homeserver, username, password });
const tokenSession = await loginWithMatrixToken({ homeserver, token, type: "m.login.token" }); // or "org.matrix.login.jwt"
```

## CLI / one-shot use

Send and exit. The `/sync` loop only starts when you subscribe:

```ts
const client = createMatrixClient({ account, store, pickleKey });
await client.messages.send({ roomId, text: "done" });
await client.close();
```

## Live subscriptions

```ts
const sub = await client.subscribe(
  { kind: "message", roomId },
  async (event) => {
    if (event.kind !== "message" || event.sender.isMe) return;
    await client.messages.send({ roomId: event.roomId, text: "ack", replyTo: event.eventId });
  },
  { timeoutMs: 30_000, retryDelayMs: 1_000 }, // optional
);

await sub.catchUp();   // replay missed events from stored cursor
await sub.stop();      // last subscriber stops the runner
await sub.done;        // resolves once the runner is fully stopped
```

Subscriptions are future-only by default. Multiple subscribers share one `/sync` runner.

### Helpers

Thin wrappers over `subscribe`:

```ts
import { onInvite, onMessage, onRawEvent, onReaction } from "@beeper/pickle";

await onMessage(client, { roomId }, handler);
await onReaction(client, { relationEventId }, handler);
await onInvite(client, undefined, handler);
await onRawEvent(client, { roomId }, handler); // raw Matrix JSON
```

## Serverless apply

When `/sync` runs elsewhere (cron, webhook, separate worker), feed responses in:

```ts
await client.sync.applyResponse({ response, since });
```

**Single-writer rule:** exactly one component advances an encrypted Matrix device cursor. Don't run `subscribe(...)` and `applyResponse(...)` for the same account at the same time.

## Raw requests

Escape hatch for Matrix endpoints without a typed wrapper:

```ts
const result = await client.raw.request({
  method: "POST",
  path: "/_matrix/client/v3/rooms/!room:example/send/m.room.message/txn",
  body: { msgtype: "m.text", body: "hello" },
});
```

Path is relative to the homeserver.

## E2EE

Encrypted bots need:

- A durable `store` (Olm/Megolm sessions, sync cursor, crypto state)
- A stable `pickleKey` — keep it constant for the device's lifetime
- Optional `recoveryKey` to unlock Matrix key backup for historical messages

```ts
const client = createMatrixClient({
  account,
  store,
  pickleKey: process.env.MATRIX_PICKLE_KEY!,
  recoveryKey: process.env.MATRIX_RECOVERY_KEY,
});

const status = await client.crypto.status();
// alert on: keyBackupUnavailable, recoveryUnverified, pendingDecryptionCount > 0
```

If `pickleKey` is omitted, the runtime falls back to the access token. That's fine for one-off bots; production E2EE should always set `pickleKey` explicitly so token rotation doesn't brick local crypto.

## Store ownership

Each account/device store is single-writer. To run multiple bots in one process, give each its own store. Storage adapters persist fast-boot state (account material, crypto state, sync cursors, small caches) — they're not a full timeline database.

## Beeper

Beeper-only behavior lives under `client.beeper.*` and is only used by the Chat SDK adapter when the homeserver is Beeper or `beeper: true` is passed.

For Beeper account login, use the Beeper auth helper. It sends the email login code, exchanges it for a Beeper JWT, then logs into Matrix and verifies `/account/whoami`.

```ts
import { createBeeperLogin } from "@beeper/pickle/beeper/auth";

const account = await createBeeperLogin({
  email,
  env: "production",
  getLoginCode: () => readCodeFromUser(),
});
```

Standard Matrix homeservers reject Beeper-only operations with a clear error.

## Unsupported

- URL previews (send rendered content explicitly)
