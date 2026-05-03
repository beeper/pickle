import type { MatrixBeeper, MatrixMessages, MatrixStreams } from "./client-types";
import { stripUndefined } from "./object";
import type { MatrixClientOptions, SendMatrixStreamOptions, SentEvent } from "./types";

export function createMatrixStreams(options: {
  beeper: MatrixBeeper;
  clientOptions: MatrixClientOptions;
  messages: MatrixMessages;
}): MatrixStreams {
  return {
    send: (opts) => sendStream(options, opts),
  };
}

async function sendStream(
  client: {
    beeper: MatrixBeeper;
    clientOptions: MatrixClientOptions;
    messages: MatrixMessages;
  },
  opts: SendMatrixStreamOptions
): Promise<SentEvent> {
  const mode = opts.mode ?? "auto";
  if (mode !== "edits" && (mode === "beeper" || supportsBeeperFeatures(client.clientOptions))) {
    return sendBeeperStream(client, opts);
  }
  return sendEditStream(client.messages, opts);
}

async function sendEditStream(messages: MatrixMessages, opts: SendMatrixStreamOptions): Promise<SentEvent> {
  const intervalMs = opts.updateIntervalMs ?? 500;
  let message: SentEvent | null = null;
  let accumulated = opts.text ?? "";
  let lastFlushed = "";
  let lastFlushAt = 0;
  if (accumulated) {
    message = await messages.send(stripUndefined({
      roomId: opts.roomId,
      text: accumulated,
      threadRoot: opts.threadRoot,
    }));
    lastFlushed = accumulated;
    lastFlushAt = Date.now();
  }
  for await (const chunk of opts.stream) {
    const text = streamChunkText(chunk);
    if (!text) continue;
    accumulated += text;
    if (!message) {
      message = await messages.send(stripUndefined({
        roomId: opts.roomId,
        text: accumulated,
        threadRoot: opts.threadRoot,
      }));
      lastFlushed = accumulated;
      lastFlushAt = Date.now();
      continue;
    }
    if (Date.now() - lastFlushAt >= intervalMs && accumulated !== lastFlushed) {
      message = await messages.edit({
        eventId: message.eventId,
        roomId: opts.roomId,
        text: accumulated,
      });
      lastFlushed = accumulated;
      lastFlushAt = Date.now();
    }
  }
  if (!message) {
    return messages.send(stripUndefined({
      roomId: opts.roomId,
      text: "...",
      threadRoot: opts.threadRoot,
    }));
  }
  if (accumulated !== lastFlushed) {
    const replacement = await messages.edit({
      eventId: message.eventId,
      roomId: opts.roomId,
      text: accumulated,
    });
    return {
      ...replacement,
      eventId: message.eventId,
      raw: {
        logicalEventId: message.eventId,
        raw: replacement.raw,
        replacementEventId: replacement.eventId,
      },
    };
  }
  return message;
}

async function sendBeeperStream(
  client: {
    beeper: MatrixBeeper;
    messages: MatrixMessages;
  },
  opts: SendMatrixStreamOptions
): Promise<SentEvent> {
  const stream = await client.beeper.streams.create({
    roomId: opts.roomId,
    streamType: "com.beeper.llm",
  });
  const turnId = `turn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const target = await client.messages.send(stripUndefined({
    content: {
      "com.beeper.ai": { messages: [{ id: turnId, parts: [], role: "assistant" }] },
      "com.beeper.stream": stream.descriptor,
    },
    roomId: opts.roomId,
    text: opts.text ?? "...",
    threadRoot: opts.threadRoot,
  }));
  await client.beeper.streams.register({
    descriptor: stream.descriptor,
    eventId: target.eventId,
    roomId: opts.roomId,
  });
  const textId = `text_${turnId}`;
  let accumulated = opts.text ?? "";
  let seq = 1;
  await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, {
    messageId: turnId,
    messageMetadata: { turn_id: turnId },
    type: "start",
  });
  await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, {
    id: textId,
    type: "text-start",
  });
  for await (const chunk of opts.stream) {
    const text = streamChunkText(chunk);
    if (!text) continue;
    accumulated += text;
    await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, {
      delta: text,
      id: textId,
      type: "text-delta",
    });
  }
  await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, {
    id: textId,
    type: "text-end",
  });
  await publishBeeperStreamPart(client.beeper, opts.roomId, target.eventId, stream.descriptor, turnId, seq++, {
    finishReason: "stop",
    messageMetadata: { finish_reason: "stop", turn_id: turnId },
    type: "finish",
  });
  const replacement = await client.messages.edit({
    content: {
      "com.beeper.ai": {
        messages: [{ id: turnId, parts: [{ text: accumulated, type: "text" }], role: "assistant" }],
      },
      "com.beeper.stream": null,
    },
    eventId: target.eventId,
    roomId: opts.roomId,
    text: accumulated || opts.text || "...",
  });
  return {
    ...replacement,
    eventId: target.eventId,
    raw: {
      logicalEventId: target.eventId,
      raw: replacement.raw,
      replacementEventId: replacement.eventId,
    },
  };
}

async function publishBeeperStreamPart(
  beeper: MatrixBeeper,
  roomId: string,
  eventId: string,
  descriptor: Record<string, unknown>,
  turnId: string,
  seq: number,
  part: Record<string, unknown>
): Promise<void> {
  const descriptorType = typeof descriptor.type === "string" ? descriptor.type : "com.beeper.llm";
  await beeper.streams.publish({
    content: {
      [`${descriptorType}.deltas`]: [{
        data: part,
        event_id: eventId,
        sequence: seq,
        stream_id: turnId,
      }],
    },
    eventId,
    roomId,
  });
}

const BEEPER_DOMAINS = new Set([
  "beeper.com",
  "beeper-staging.com",
  "beeper-dev.com",
  "beeper.localtest.me",
]);

function isBeeperHomeserver(homeserverUrl: string): boolean {
  try {
    const hostname = new URL(homeserverUrl).hostname;
    return BEEPER_DOMAINS.has(hostname) || [...BEEPER_DOMAINS].some((domain) => hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function supportsBeeperFeatures(options: MatrixClientOptions): boolean {
  const homeserver = options.account?.homeserver ?? options.homeserver;
  return options.beeper ?? (homeserver ? isBeeperHomeserver(homeserver) : false);
}

function streamChunkText(chunk: string | Record<string, unknown>): string {
  if (typeof chunk === "string") return chunk;
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.delta === "string") return chunk.delta;
  if (typeof chunk.markdown === "string") return chunk.markdown;
  return "";
}
