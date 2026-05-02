import type { StreamOptions } from "chat";

export const BEEPER_STREAM_EVENT_TYPE = "com.beeper.llm";

export function buildStreamDelta(
  turnId: string,
  seq: number,
  part: Record<string, unknown>,
  targetEventId: string,
  options?: StreamOptions
): Record<string, unknown> {
  return {
    "m.relates_to": {
      event_id: targetEventId,
      rel_type: "m.reference",
    },
    ...(options?.recipientUserId ? { agent_id: options.recipientUserId } : {}),
    part,
    seq,
    turn_id: turnId,
  };
}

export function streamDescriptorType(descriptor: Record<string, unknown>): string {
  const type = descriptor.type;
  return typeof type === "string" && type.trim() ? type : BEEPER_STREAM_EVENT_TYPE;
}

export function aiMessageContent(turnId: string, parts: unknown[] = []): Record<string, unknown> {
  return {
    id: turnId,
    metadata: { turn_id: turnId },
    parts,
    role: "assistant",
  };
}

export function clearStreamContent(turnId: string, parts: unknown[] = []): Record<string, unknown> {
  return {
    "com.beeper.ai": aiMessageContent(turnId, parts),
    "com.beeper.stream": null,
  };
}
