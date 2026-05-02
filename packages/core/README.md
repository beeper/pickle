# better-matrix-js

TypeScript Matrix SDK that runs in Node, Cloudflare Workers, browsers, and any WASM runtime. Built on `mautrix-go` + `goolm`, compiled to WebAssembly. E2EE included.

```sh
npm install better-matrix-js
```

## Node

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

Pass any of `wasmModule`, `wasmBytes`, or `wasmUrl` to `createMatrixClient()`, plus a `store` implementing the `MatrixStore` interface.

## What it does

Login (password, token, JWT), `/sync` long polling, send/edit/delete messages, formatted HTML, mentions, replies, reactions, read receipts, threads, typing, media (encrypted upload/download), DMs, joined-room listing, invites, and the full mautrix E2EE pipeline (Olm/Megolm, cross-signing, key backup, recovery key).

## API surface

`MatrixClient` exposes one explicit lifecycle plus namespaces: `connect`, `close`, `events`, `messages`, `reactions`, `rooms`, `media`, `users`, `typing`, and `sync`.

## License

MPL-2.0
