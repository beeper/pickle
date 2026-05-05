import type { MatrixMessages } from "../client-types";
import { stripUndefined } from "../object";
import type { SendMatrixStreamOptions, SentEvent } from "../types";

export async function sendEditStream(messages: MatrixMessages, opts: SendMatrixStreamOptions): Promise<SentEvent> {
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

export function streamChunkText(chunk: string | Record<string, unknown>): string {
  if (typeof chunk === "string") return chunk;
  if (typeof chunk.text === "string") return chunk.text;
  if (typeof chunk.delta === "string") return chunk.delta;
  if (typeof chunk.markdown === "string") return chunk.markdown;
  return "";
}
