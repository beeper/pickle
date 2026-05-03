# @beeper/pickle-ai-sdk

Pipe an [AI SDK](https://sdk.vercel.ai) UI message stream straight into a Matrix message via [`@beeper/pickle-chat-adapter`](https://github.com/beeper/Pickle/tree/main/packages/chat-adapter).

```sh
npm install @beeper/pickle-ai-sdk
```

## Usage

```ts
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { fromAIStreamResult } from "@beeper/pickle-ai-sdk";

bot.onNewMention(async (thread, message) => {
  await thread.subscribe();

  const result = streamText({ model: openai("gpt-4o"), prompt: message.text });

  await matrix.stream(
    matrix.encodeThreadId({ roomId: message.raw.roomId }),
    fromAIStreamResult(result),
  );
});
```

The adapter handles debounced edits — or native streaming on Beeper.

## API

```ts
fromAIStreamResult(result)        // anything with .toUIMessageStream()
fromAIUIMessageStream(stream)     // already have a UI message stream?
isAIUIMessageStreamResult(value)  // type guard
```

All three return a `MatrixStream` you hand to `matrix.stream()`. Split out so the chat adapter doesn't pull the AI SDK in unless you need it.

## License

MIT
