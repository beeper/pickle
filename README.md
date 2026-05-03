# better-matrix-js

A TypeScript Matrix SDK that runs anywhere. Node, Cloudflare Workers, browsers, any WASM runtime.

Built on `mautrix-go` + `goolm` compiled to WebAssembly. No `matrix-js-sdk`, no Rust crypto sidecar, no Node FFI. End-to-end encryption works out of the box.

## Packages

| Package | What it is |
| --- | --- |
| [`better-matrix-js`](packages/core) | Matrix core. Login, sync, rooms, messages, reactions, threads, media, E2EE. |
| [`@better-matrix-js/chat-adapter`](packages/chat-adapter) | [Chat SDK](https://www.npmjs.com/package/chat) adapter on top of the core. |
| [`@better-matrix-js/cloudflare`](packages/cloudflare) | KV / Durable Object state + a long-poll sync Durable Object for Workers. |
| [`@better-matrix-js/ai-sdk`](packages/ai-sdk) | Adapt AI SDK UI message streams into the chat-adapter `stream()` API. |

## Quick start

### Node bot (Chat SDK)

```sh
npm install chat better-matrix-js @better-matrix-js/chat-adapter @chat-adapter/state-redis
```

```ts
import { Chat } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";
import { createMatrixAdapter } from "@better-matrix-js/chat-adapter";

const matrix = createMatrixAdapter({
  token: process.env.MATRIX_ACCESS_TOKEN!,
  // homeserver defaults to "https://matrix.beeper.com"
  recoveryKey: process.env.MATRIX_RECOVERY_KEY,
});

const bot = new Chat({
  adapters: { matrix },
  state: createRedisState({ url: process.env.REDIS_URL! }),
});

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`echo: ${message.text}`);
});

await bot.initialize();
```

For Node bots, use a durable Chat SDK state adapter and a durable Matrix store. E2EE bots must keep their Matrix crypto store across restarts; changing `pickleKey` or losing the store makes existing encrypted device state unreadable.

### Raw Matrix core (no Chat SDK)

```ts
import { createMatrixClient, onMessage } from "better-matrix-js/node";
import { createFileMatrixStore } from "@better-matrix-js/state-file";

const client = createMatrixClient({
  homeserver: "https://matrix.example.org",
  token: process.env.MATRIX_ACCESS_TOKEN!,
  store: createFileMatrixStore(".matrix-store"),
  recoveryKey: process.env.MATRIX_RECOVERY_KEY,
});

await onMessage(client, undefined, async (event) => {
  if (event.sender.isMe) return;
  await client.messages.send({
    roomId: event.roomId,
    text: "Got it.",
    replyTo: event.eventId,
  });
});
```

### Cloudflare Worker

See [`examples/cloudflare-worker`](examples/cloudflare-worker). The recipe: one Durable Object per Matrix account holds the core + crypto store, a second one (`MatrixSyncDurableObject`) long-polls `/sync` and webhooks the response back. Worker bundles are ~4 MB compressed because of the Go WASM payload.

Use `MatrixSyncDurableObject` for live sync and feed each webhook body to `client.sync.applyResponse({ response, since })` in the account Durable Object. The sync Durable Object owns the `/sync` cursor; the account Durable Object owns Matrix client state, crypto state, and bot behavior.

### State adapters

Use `@better-matrix-js/state-memory` for tests, `@better-matrix-js/state-file` or `@better-matrix-js/state-sqlite` in Node, `@better-matrix-js/state-indexeddb` in browsers, and `@better-matrix-js/cloudflare` for Durable Object or KV storage. For anything custom, wrap a simple getter/setter with `@better-matrix-js/state-simple`.

Docker-backed storage smoke tests are available for service-style stores:

```sh
pnpm test:docker
pnpm test:docker:down
```

The Redis smoke uses `@better-matrix-js/state-simple` against a real Redis container
to prove the minimal Matrix store contract works with external server-side storage.

Browser apps should load `matrix-core.wasm` with `wasmUrl`, `wasmBytes`, or a bundler-provided `wasmModule`, and should persist Matrix state in IndexedDB.

## Feature support matrix

| Feature | Support |
| --- | --- |
| Node bots | Supported via `better-matrix-js/node` and file, SQLite, or custom stores. |
| Browser apps | Supported with explicit WASM loading and IndexedDB-backed state. |
| Cloudflare Workers | Supported with Durable Object state and `MatrixSyncDurableObject`. |
| Live `/sync` loop | Supported with `client.subscribe(filter, handler)` in long-lived runtimes. |
| Serverless sync | Supported by applying webhooked responses with `applyResponse`. |
| E2EE | Supported when the crypto store, `pickleKey`, and optional `recoveryKey` are durable. |
| Beeper ephemeral events | Supported only on Beeper homeservers. |
| Native streaming | Uses Beeper native stream events on Beeper; falls back to Matrix edits elsewhere. |
| Chat SDK cards/actions | Fallback text only; no native interactive Matrix surface is exposed. |
| Chat SDK native modals | Not supported by Matrix. |
| Chat SDK scheduled messages | Not supported by Matrix. |
| URL previews | Intentionally unsupported; bots should render links explicitly. |

## Examples

- [`examples/cloudflare-worker`](examples/cloudflare-worker) — minimal Worker with both Durable Objects wired up.
- [`examples/beeper-streaming-smoke`](examples/beeper-streaming-smoke) — Node bot that streams rich AI-style markdown into Matrix rooms.

## Develop

```sh
pnpm install
pnpm build      # compiles TS + builds matrix-core.wasm via Go
pnpm test       # unit tests
pnpm typecheck
```

## Publish

Always publish with pnpm so workspace ranges get rewritten:

```sh
pnpm check
pnpm publish:packages
```

## License

Core and Cloudflare packages: MPL-2.0. Chat adapter and AI SDK packages: MIT.
