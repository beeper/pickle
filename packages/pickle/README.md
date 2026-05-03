# Pickle

A TypeScript Matrix SDK that runs in Node, browsers, and any WASM runtime. Built on `mautrix-go` + `goolm`. E2EE included.

```sh
npm install @beeper/pickle
```

## Node

```ts
import { createMatrixClient, onMessage } from "@beeper/pickle/node";
import { createSQLiteMatrixStore } from "@beeper/pickle-state-sqlite";

const client = createMatrixClient({
  homeserver: "https://matrix.example.org",
  token: process.env.MATRIX_ACCESS_TOKEN!,
  store: await createSQLiteMatrixStore(".matrix-state/bot.db"),
  recoveryKey: process.env.MATRIX_RECOVERY_KEY, // optional, for E2EE history
});

await onMessage(client, undefined, async (event) => {
  if (event.sender.isMe) return;
  await client.messages.send({
    roomId: event.roomId,
    text: "got it",
    replyTo: event.eventId,
  });
});
```

The first awaited call boots WASM, store, and crypto. Call `await client.boot()` if you want startup failures early.

## Browser

Serve `pickle.wasm` with your static assets and persist state in IndexedDB:

```ts
import { createMatrixClient } from "@beeper/pickle";
import { createIndexedDBMatrixStore } from "@beeper/pickle-state-indexeddb";

const client = createMatrixClient({
  homeserver: "https://matrix.example.org",
  token,
  wasmUrl: "/pickle.wasm",
  store: createIndexedDBMatrixStore({ databaseName: "matrix-alice" }),
});
```

## Sending things

```ts
const { eventId } = await client.messages.send({
  roomId: "!room:example.org",
  text: "hello",
});

await client.reactions.send({ roomId: "!room:example.org", eventId, key: "👋" });
await client.messages.edit({ roomId, eventId, text: "edited" });
await client.messages.redact({ roomId, eventId });
await client.typing.set({ roomId, typing: true, timeoutMs: 5000 });
```

## Listening

```ts
import { onMessage, onReaction, onInvite, onRawEvent } from "@beeper/pickle";

await onMessage(client, { roomId }, async (event) => { /* ... */ });
await onReaction(client, { relationEventId: "$event" }, async (event) => { /* ... */ });
await onInvite(client, undefined, async (invite) => {
  await client.rooms.join({ roomIdOrAlias: invite.roomId });
});
```

Or use `client.subscribe(filter, handler, options)` directly. The first subscriber starts the sync loop; the last `stop()` ends it. Use `sub.catchUp()` to replay missed events from the stored cursor.

```ts
const sub = await client.subscribe({ kind: "message", roomId }, handler);
await sub.catchUp();
await sub.stop();
```

## Login

```ts
import { createMatrixLogin } from "@beeper/pickle";

const login = createMatrixLogin({ homeserver: "https://matrix.example.org" });
const session = await login.password({ username: "bot", password: "..." });
// or: await login.token({ token, type: "m.login.token" | "org.matrix.login.jwt" });

const client = createMatrixClient({ account: session, store, pickleKey });
```

## E2EE essentials

For encrypted bots, persist these across restarts:

- The `store` (Olm/Megolm sessions, sync cursor, crypto state)
- A stable `pickleKey` (protects local pickles — never rotate without a planned device reset)
- Optional `recoveryKey` to unlock Matrix key backup for historical messages

After boot, check status and alert on issues:

```ts
const status = await client.crypto.status();
// { keyBackupUnavailable, recoveryUnverified, pendingDecryptionCount, ... }
```

## API surface

`MatrixClient` exposes:

- **Lifecycle:** `boot`, `whoami`, `close`, `logout`
- **Send/fetch:** `messages`, `reactions`, `media`, `typing`, `receipts`, `accountData`, `toDevice`, `streams`
- **Rooms:** `rooms` (create, join, invite, kick, ban, state, threads, DMs, members)
- **Users:** `users` (profile, avatar, display name)
- **Events:** `subscribe(filter, handler)` + helpers `onMessage`, `onReaction`, `onInvite`, `onRawEvent`
- **Sync:** `sync.applyResponse({ response, since })` for serverless / external sync runners
- **E2EE:** `crypto.status()`
- **Beeper-only:** `beeper.ephemeral`, `beeper.streams`
- **Escape hatch:** `raw.request({ method, path, body })`

See [`docs/API.md`](https://github.com/beeper/pickle/blob/main/docs/API.md) for full details.

## Store ownership

Each Matrix account/device store is single-writer. Don't run two clients against the same store prefix concurrently. To run multiple bots in one process, give each its own store.

## License

MPL-2.0
