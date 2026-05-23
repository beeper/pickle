# @beeper/pickle-ag-ui

Pipe an AG-UI event stream into a Matrix message via [`@beeper/pickle-chat-adapter`](https://github.com/beeper/pickle/tree/main/packages/chat-adapter).

```sh
npm install @beeper/pickle-ag-ui
```

## Usage

```ts
import { fromAGUIEventStream } from "@beeper/pickle-ag-ui";

async function* runEvents() {
  yield { type: "RUN_STARTED", threadId: "thread-1", runId: "run-1" };
  yield { type: "TEXT_MESSAGE_START", messageId: "message-1", role: "assistant" };
  yield { type: "TEXT_MESSAGE_CONTENT", messageId: "message-1", delta: "Hello" };
  yield { type: "TEXT_MESSAGE_END", messageId: "message-1" };
  yield { type: "RUN_FINISHED", threadId: "thread-1", runId: "run-1", finishReason: "stop" };
}

await matrix.stream(
  matrix.encodeThreadId({ roomId: message.raw.roomId }),
  fromAGUIEventStream(runEvents()),
);
```

The adapter handles debounced edits, or native streaming on Beeper.

## API

```ts
fromAGUIEventStream(stream)
fromAGUIStreamResult(result)
isAGUIEventStreamResult(value)
```

All three return a `MatrixStream` you hand to `matrix.stream()`.

## License

MIT
