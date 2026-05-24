# @beeper/pickle-chat-adapter

[Chat SDK](https://www.npmjs.com/package/chat) adapter for Matrix. Same bot, same code, runs on Matrix, Slack, Discord, Teams.

```sh
npm install chat @beeper/pickle @beeper/pickle-chat-adapter
```

## Usage

```ts
import { Chat } from "chat";
import { createMatrixAdapter } from "@beeper/pickle-chat-adapter";

const matrix = createMatrixAdapter({
  homeserver: "https://matrix.example.org", // defaults to https://matrix.beeper.com
  token: process.env.MATRIX_ACCESS_TOKEN!,
  recoveryKey: process.env.MATRIX_RECOVERY_KEY, // optional, enables E2EE history
  inviteAutoJoin: { inviterAllowlist: ["@me:example.org"] },
});

const bot = new Chat({ adapters: { matrix }, state });

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();
  await thread.post(`echo: ${message.text}`);
});

await bot.initialize();
```

That's it. The adapter logs in, subscribes, and forwards Matrix events into Chat SDK threads.

## Login with password

```ts
import { loginWithMatrixPassword } from "@beeper/pickle/auth";

const { accessToken } = await loginWithMatrixPassword({
  homeserver: "https://matrix.example.org",
  initialDeviceDisplayName: "my bot",
  username: "bot",
  password: process.env.MATRIX_PASSWORD!,
});
```

Use `loginWithMatrixToken()` from `@beeper/pickle/auth` for token / JWT login.

## Streaming responses

Stream markdown into a Matrix message with progressive edits. Pass any async iterable of AG-UI events:

```ts
await matrix.stream(matrix.encodeThreadId({ roomId }), agentStream(message.text));

async function* agentStream(prompt: string) {
  yield { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" };
  yield { type: "TEXT_MESSAGE_START", messageId: "message-1", role: "assistant" };
  for (const word of answer.split(" ")) {
    yield { type: "TEXT_MESSAGE_CONTENT", messageId: "message-1", delta: word + " " };
  }
  yield { type: "TEXT_MESSAGE_END", messageId: "message-1" };
  yield { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1", finishReason: "stop" };
}
```

On Beeper homeservers this uses native streaming events; elsewhere it falls back to debounced edits. Wire AG-UI event streams directly with [`@beeper/pickle-ag-ui`](https://github.com/beeper/pickle/tree/main/packages/ag-ui).

## Thread IDs

Chat SDK thread IDs encode `{ roomId, eventId? }`:

```ts
matrix.encodeThreadId({ roomId: "!room:example.org" });
matrix.decodeThreadId(threadId); // { roomId, eventId? }
matrix.channelIdFromThreadId(threadId);
```

## Config

```ts
createMatrixAdapter({
  token,                                // required (or pass `client` / `createClient`)
  homeserver,                           // defaults to Beeper
  recoveryKey, pickleKey,               // E2EE
  inviteAutoJoin: { inviterAllowlist },
  roomAllowlist,
  sync: { enabled },                    // false = caller drives sync via handleSyncResponse
  typingTimeoutMs,
  commandPrefix,
});
```

For E2EE bots: keep `pickleKey` stable for the device, persist Matrix state with a durable store, and persist Chat SDK state too.

## Matrix-specific behavior

| Chat SDK feature | Matrix support |
| --- | --- |
| Messages, replies, reactions, threads | ✅ |
| Streaming | ✅ Beeper-native on Beeper, edit fallback elsewhere |
| Ephemeral messages | Beeper-only |
| Cards / actions | Non-interactive cards render as text; interactive throw |
| Native modals | ❌ no equivalent in Matrix |
| Scheduled messages | ❌ schedule in your app |
| URL previews | ❌ send rendered content explicitly |

## License

MIT
