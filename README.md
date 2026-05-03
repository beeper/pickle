# Pickle

A TypeScript Matrix SDK that runs anywhere. Built on `mautrix-go` + `goolm` compiled to WebAssembly. **E2EE works out of the box.** No `matrix-js-sdk`, no Rust sidecar, no Node FFI.

## Packages

| Package | What it does |
| --- | --- |
| [`@beeper/pickle`](packages/pickle) | Matrix SDK: login, sync, rooms, messages, reactions, threads, media, E2EE. |
| [`@beeper/pickle-chat-adapter`](packages/chat-adapter) | Build Matrix bots using the [Chat SDK](https://www.npmjs.com/package/chat). |
| [`@beeper/pickle-ai-sdk`](packages/ai-sdk) | Pipe AI SDK streams into Matrix messages. |
| [`@beeper/pickle-state-file`](packages/state-file) · [`-sqlite`](packages/state-sqlite) · [`-indexeddb`](packages/state-indexeddb) · [`-memory`](packages/state-memory) · [`-simple`](packages/state-simple) | State adapters for Node, browsers, and custom backends. |

## Install

```sh
npm install @beeper/pickle @beeper/pickle-state-sqlite
```

## A Node bot in 20 lines

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
    text: `echo: ${event.text}`,
    replyTo: event.eventId,
  });
});
```

That's a working E2EE-capable Matrix bot. The first awaited method boots WASM, store, and crypto lazily — call `await client.boot()` if you want startup failures up front.

## With the Chat SDK

Same bot, written as a [Chat SDK](https://www.npmjs.com/package/chat) adapter — gets you Slack/Discord/Teams parity and shared bot logic across platforms:

```sh
npm install chat @beeper/pickle @beeper/pickle-chat-adapter
```

```ts
import { Chat } from "chat";
import { createMatrixAdapter } from "@beeper/pickle-chat-adapter";

const matrix = createMatrixAdapter({
  homeserver: "https://matrix.example.org",
  token: process.env.MATRIX_ACCESS_TOKEN!,
});

const bot = new Chat({ adapters: { matrix }, state });

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`echo: ${message.text}`);
});

await bot.initialize();
```

## What works

- Node bots and browser apps
- Login (password, token, JWT) and Beeper registration
- `/sync` long polling with shared subscriptions and catch-up
- Send / edit / redact, replies, mentions, reactions, threads, typing, receipts
- Encrypted media upload and download
- Full E2EE (Olm, Megolm, cross-signing, key backup, recovery key)
- Beeper native streaming + ephemeral events
- Streaming AI responses (debounced edits everywhere; native on Beeper)

## What's not supported

- URL previews (send rendered content explicitly)

## Examples

- [`examples/dummybridge-bot`](examples/dummybridge-bot) — full-featured Node bot using Pickle directly.
- [`examples/beeper-streaming-smoke`](examples/beeper-streaming-smoke) — Chat SDK adapter streaming rich markdown.

## Develop

```sh
pnpm install
pnpm build       # TS + Go WASM
pnpm test
pnpm typecheck
```

Live Matrix smoke tests live in [`e2e`](e2e) and are opt-in because they need
real accounts.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the release flow.

## License

See [LICENSE](LICENSE).
