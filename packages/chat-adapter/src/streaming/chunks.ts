import type { StreamChunk } from "chat";

export function streamChunkText(chunk: string | StreamChunk | Record<string, unknown>): string {
  if (typeof chunk === "string") {
    return chunk;
  }
  if (isStreamChunk(chunk) && chunk.type === "markdown_text") {
    return chunk.text;
  }
  if (readString(chunk, "type") === "text-delta") {
    return readString(chunk, "text") ?? readString(chunk, "delta") ?? readString(chunk, "textDelta") ?? "";
  }
  return "";
}

export function streamPart(chunk: StreamChunk | Record<string, unknown>): Record<string, unknown> {
  if (!isStreamChunk(chunk)) {
    return chunk;
  }
  switch (chunk.type) {
    case "markdown_text":
      return { delta: chunk.text, type: "text-delta" };
    case "task_update":
      return {
        data: {
          call_id: chunk.id,
          output: chunk.output,
          progress: chunk.output,
          status: chunk.status,
          tool_name: chunk.title,
        },
        id: chunk.id,
        transient: chunk.status === "pending" || chunk.status === "in_progress",
        type: "data-tool-progress",
      };
    case "plan_update":
      return {
        data: { title: chunk.title },
        transient: true,
        type: "data-plan-update",
      };
  }
}

export function normalizeStreamPart(part: Record<string, unknown>, defaultTextId: string): Record<string, unknown> {
  const type = readString(part, "type");
  if (
    (type === "text-start" || type === "text-delta" || type === "text-end") &&
    !readString(part, "id")
  ) {
    return { ...part, id: defaultTextId };
  }
  return part;
}

export function isStreamChunk(value: unknown): value is StreamChunk {
  const type = readString(value, "type");
  return type === "markdown_text" || type === "task_update" || type === "plan_update";
}

export function readString(record: unknown, key: string): string | undefined {
  if (!record || typeof record !== "object") {
    return undefined;
  }
  const value = (record as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}
