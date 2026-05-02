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
  accessToken: process.env.MATRIX_ACCESS_TOKEN!,
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

That's it. The adapter starts long-polling `/sync` automatically and forwards Matrix events into Chat SDK threads.

## Login with password

If you don't have an access token yet:

```ts
import { loginMatrix } from "@better-matrix-js/chat-adapter";

const { accessToken } = await loginMatrix({
  homeserverUrl: "https://matrix.example.org",
  username: "bot",
  password: process.env.MATRIX_PASSWORD!,
  initialDeviceDisplayName: "my bot",
});
```

There's also `loginMatrixWithToken()` for token / JWT login.

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

On Beeper homeservers this uses Beeper's native streaming events; elsewhere it falls back to debounced edits. To wire the AI SDK directly, see [`@better-matrix-js/ai-sdk`](https://github.com/batuhan/better-matrix-js/tree/main/packages/ai-sdk).

## Serverless / webhook sync

If you run `/sync` outside the worker (e.g. from a Durable Object), disable the built-in poller and feed responses in:

```ts
const matrix = createMatrixAdapter({
  /* … */,
  polling: { enabled: false },
});

await matrix.handleSyncResponse({ response, since });
```

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
  accessToken,                                  // required
  homeserverUrl,                                // required
  core | createCore | wasmModule | wasmBytes | wasmUrl, // pick one
  recoveryKey | recoveryCode | pickleKey,       // optional, for E2EE
  inviteAutoJoin: { inviterAllowlist },         // optional
  roomAllowlist,                                // optional
  polling: { enabled, retryDelayMs, timeoutMs },
  typingTimeoutMs,
  commandPrefix,
});
```

## License

MIT
