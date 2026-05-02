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
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
  // homeserverUrl defaults to "https://matrix.beeper.com"
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

### Raw Matrix core (no Chat SDK)

```ts
import { createFileMatrixStore } from "@better-matrix-js/state-file";
import { loadMatrixCoreFromNodePackage } from "better-matrix-js/node";

const core = await loadMatrixCoreFromNodePackage({
  host: { store: createFileMatrixStore(".matrix-store") },
});

await core.init({
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
  homeserverUrl: "https://matrix.example.org",
});

await core.postMessage({ roomId: "!room:example.org", body: "hello" });
```

### Cloudflare Worker

See [`examples/cloudflare-worker`](examples/cloudflare-worker). The recipe: one Durable Object per Matrix account holds the core + crypto store, a second one (`MatrixSyncDurableObject`) long-polls `/sync` and webhooks the response back. Worker bundles are ~4 MB compressed because of the Go WASM payload.

### State adapters

Use `@better-matrix-js/state-memory` for tests, `@better-matrix-js/state-file` or `@better-matrix-js/state-sqlite` in Node, `@better-matrix-js/state-indexeddb` in browsers, and `@better-matrix-js/cloudflare` for Durable Object or KV storage. For anything custom, wrap a simple getter/setter with `@better-matrix-js/state-simple`.

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
