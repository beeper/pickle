# @better-matrix-js/chat-adapter

[Chat SDK](https://www.npmjs.com/package/chat) adapter for Matrix. Build a Matrix bot the same way you'd build a Slack or Discord bot.

```sh
npm install chat better-matrix-js @better-matrix-js/chat-adapter @chat-adapter/state-redis
```

## Usage

```ts
import { Chat } from "chat";
import { createRedisState } from "@chat-adapter/state-redis";
import { createMatrixAdapter } from "@better-matrix-js/chat-adapter";

const matrix = createMatrixAdapter({
  token: process.env.MATRIX_ACCESS_TOKEN!,
  // Defaults to https://matrix.beeper.com
  recoveryKey: process.env.MATRIX_RECOVERY_KEY,    // optional, enables E2EE
  inviteAutoJoin: { inviterAllowlist: ["@me:example.org"] },
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

That's it. The adapter subscribes automatically and forwards future Matrix events into Chat SDK threads.

For E2EE bots, keep both Chat SDK state and Matrix client state durable. `recoveryKey` lets the bot restore backed-up room keys, while `pickleKey` protects the local crypto pickles; keep `pickleKey` stable for the lifetime of the Matrix device.

## Login with password

If you don't have an access token yet:

```ts
import { createMatrixLogin } from "better-matrix-js";

const { accessToken } = await createMatrixLogin({
  homeserver: "https://matrix.example.org",
  initialDeviceDisplayName: "my bot",
}).password({
  username: "bot",
  password: process.env.MATRIX_PASSWORD!,
});
```

There's also `.token()` for token / JWT login.

## Streaming responses (AI bots)

Stream markdown into a Matrix message with progressive edits. Pass any async iterable of AI-SDK-shaped chunks:

```ts
await matrix.stream(
  matrix.encodeThreadId({ roomId }),
  agentStream(message.text),
);

async function* agentStream(prompt: string) {
  yield { type: "markdown_text", text: "Thinking…\n\n" };
  for (const word of answer.split(" ")) {
    yield { type: "markdown_text", text: word + " " };
  }
  yield { type: "finish", finishReason: "stop" };
}
```

On Beeper homeservers this uses Beeper native streaming events; elsewhere it falls back to debounced Matrix edits. To wire the AI SDK directly, see [`@better-matrix-js/ai-sdk`](https://github.com/batuhan/better-matrix-js/tree/main/packages/ai-sdk).

## Serverless / webhook sync

If you run `/sync` outside the adapter, for example from `MatrixSyncDurableObject`, disable the built-in poller and feed responses in:

```ts
const matrix = createMatrixAdapter({
  /* … */,
  sync: { enabled: false },
});

await matrix.handleSyncResponse({ response, since });
```

In this mode the external sync runner owns the cursor. Do not also let the adapter run live sync for the same Matrix account.

For encrypted rooms, keep webhook application single-writer for each Matrix device. The external sync runner should deliver raw Matrix JSON to `handleSyncResponse`; the adapter does not decrypt or unwrap custom webhook envelopes itself.

## Thread IDs

Chat SDK thread IDs encode `{ roomId, eventId? }`. Use the helpers when you need to cross between Matrix room IDs and Chat SDK thread IDs:

```ts
matrix.encodeThreadId({ roomId: "!room:example.org" });
matrix.decodeThreadId(threadId); // => { roomId, eventId? }
matrix.channelIdFromThreadId(threadId);
```

## Config reference

```ts
createMatrixAdapter({
  token,                                        // required
  homeserver,                                   // optional, defaults to Beeper
  client | createClient | wasmModule | wasmBytes | wasmUrl, // optional
  recoveryKey | pickleKey,                      // optional, for E2EE
  inviteAutoJoin: { inviterAllowlist },         // optional
  roomAllowlist,                                // optional
  sync: { enabled },
  typingTimeoutMs,
  commandPrefix,
});
```

## Matrix-specific support

| Chat SDK feature | Matrix adapter support |
| --- | --- |
| Messages, replies, reactions, threads | Supported. |
| Streaming responses | Beeper native streaming on Beeper homeservers; Matrix edit fallback elsewhere. |
| Ephemeral messages | Beeper-only. Non-Beeper homeservers reject this operation. |
| Cards and actions | Non-interactive cards can be rendered as text; interactive cards/actions throw clearly. |
| Native modals | Unsupported because Matrix has no equivalent native surface. |
| Scheduled messages | Unsupported; schedule work in your app and send later. |
| URL previews | Unsupported by design; send explicit text or rendered content instead. |

## License

MIT
