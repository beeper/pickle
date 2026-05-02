# better-matrix-js

TypeScript Matrix SDK that runs in Node, Cloudflare Workers, browsers, and any WASM runtime. Built on `mautrix-go` + `goolm`, compiled to WebAssembly. E2EE included.

```sh
npm install better-matrix-js
```

## Node

Use the Node entrypoint and a durable store. File or SQLite storage is enough for a single-process bot; production deployments can provide any `MatrixStore` implementation.

```ts
import { createMatrixClient } from "better-matrix-js/node";
import { createFileMatrixStore } from "@better-matrix-js/state-file";

const client = createMatrixClient({
  homeserver: "https://matrix.example.org",
  token: process.env.MATRIX_ACCESS_TOKEN!,
  store: createFileMatrixStore(".matrix-state/my-account"),
  recoveryKey: process.env.MATRIX_RECOVERY_KEY,
});

client.events.onMessage(async (event) => {
  if (event.sender.isMe) return;
  await client.messages.send({
    roomId: event.roomId,
    text: "Got it.",
    replyTo: event.eventId,
  });
});

await client.connect();
await client.sync.start();
```

Send directly through the explicit namespaces:

```ts
const { eventId } = await client.messages.send({
  roomId: "!room:example.org",
  text: "hello world",
});

await client.reactions.send({ roomId: "!room:example.org", eventId, key: "hi" });
```

## Cloudflare Workers

Cloudflare Workers need the generic entrypoint plus an explicit WASM module import.

```ts
import "better-matrix-js/wasm_exec.js";
import wasmModule from "better-matrix-js/matrix-core.wasm";
import { createMatrixClient } from "better-matrix-js";
import { createDurableObjectMatrixStore } from "@better-matrix-js/cloudflare";

const client = createMatrixClient({
  homeserver,
  token: accessToken,
  store: createDurableObjectMatrixStore(state.storage),
  wasmModule,
});

await client.connect();
```

For sync, use `MatrixSyncDurableObject` from `@better-matrix-js/cloudflare` and forward the response into `client.sync.applyResponse({ response, since })`. See [`examples/cloudflare-worker`](https://github.com/batuhan/better-matrix-js/tree/main/examples/cloudflare-worker).

## State

Pass a store as `store`. The store persists Matrix sync state and E2EE crypto state, so use durable storage for any real account.

```ts
import { createMatrixStore } from "@better-matrix-js/state-simple";
import { createMemoryMatrixStore } from "@better-matrix-js/state-memory";
import { createFileMatrixStore } from "@better-matrix-js/state-file";
import { createSQLiteMatrixStore } from "@better-matrix-js/state-sqlite";
import { createDurableObjectMatrixStore } from "@better-matrix-js/cloudflare";

const memory = createMemoryMatrixStore(); // tests and local experiments
const filesystem = createFileMatrixStore(".matrix-state/alice");
const sqlite = await createSQLiteMatrixStore(".matrix-state/alice.db");
const durableObject = createDurableObjectMatrixStore(state.storage);

const custom = createMatrixStore({
  get: (key) => backend.get(key),
  set: (key, value) => backend.set(key, value),
  delete: (key) => backend.delete(key),
  keys: () => backend.keys(), // optional; otherwise an index key is maintained
});
```

Browser apps can use IndexedDB:

```ts
import { createIndexedDBMatrixStore } from "@better-matrix-js/state-indexeddb";

const client = createMatrixClient({
  homeserver,
  token,
  wasmUrl: "/matrix-core.wasm",
  store: createIndexedDBMatrixStore({ databaseName: "matrix-alice" }),
});
```

## Browser / other runtimes

Pass any of `wasmModule`, `wasmBytes`, or `wasmUrl` to `createMatrixClient()`, plus a `store` implementing the `MatrixStore` interface. For browser apps, serve `matrix-core.wasm` with your static assets and use `@better-matrix-js/state-indexeddb` so sync and E2EE state survive page reloads.

## Live sync vs serverless applyResponse

Use `client.sync.start()` when the same process can keep a long-lived `/sync` request open. In serverless runtimes, run `/sync` elsewhere and call `client.sync.applyResponse({ response, since })` for each response. Do not run both for the same account at the same time; only one component should advance a Matrix account cursor.

## E2EE storage and keys

Encrypted accounts need durable Matrix storage. The store contains Olm/Megolm session state and the sync cursor, while `pickleKey` protects local pickles and `recoveryKey` unlocks Matrix key backup. Keep `pickleKey` stable for a device; rotate it only with a planned device reset or store migration.

Recommended bot onboarding:

1. Log in once and persist the returned `userId`, `deviceId`, and access token.
2. Pick a stable high-entropy `pickleKey` and store it with the bot secret material.
3. Pass a durable `store`, `userId`, `deviceId`, access token, and `pickleKey` on every boot.
4. Pass `recoveryKey` when the bot must decrypt historical encrypted messages from key backup.
5. Check `await client.crypto.status()` after `connect()` and alert on `keyBackupUnavailable`, `recoveryUnverified`, or a nonzero `pendingDecryptionCount`.

If `pickleKey` is omitted, the runtime currently falls back to the access token for compatibility with one-off bots. Treat that as development-only. Production encrypted bots should always set `pickleKey` explicitly so token rotation does not make local crypto state unreadable.

## What it does

Login (password, token, JWT), `/sync` long polling, send/edit/delete messages, formatted HTML, mentions, replies, reactions, read receipts, threads, typing, media (encrypted upload/download), DMs, joined-room listing, invites, and the full mautrix E2EE pipeline (Olm/Megolm, cross-signing, key backup, recovery key).

## API surface

`MatrixClient` exposes one explicit lifecycle plus namespaces: `connect`, `close`, `events`, `messages`, `reactions`, `rooms`, `media`, `users`, `typing`, and `sync`.

## License

MPL-2.0
