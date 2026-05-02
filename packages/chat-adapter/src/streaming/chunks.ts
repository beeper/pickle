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
  return streamParts(chunk)[0] ?? {};
}

export function streamParts(chunk: StreamChunk | Record<string, unknown>): Record<string, unknown>[] {
  if (!isStreamChunk(chunk)) {
    return [chunk];
  }
  switch (chunk.type) {
    case "markdown_text":
      return [{ delta: chunk.text, type: "text-delta" }];
    case "task_update":
      return taskUpdateParts(chunk);
    case "plan_update":
      return [{
        data: { title: chunk.title },
        transient: true,
        type: "data-plan-update",
      }];
  }
}

function taskUpdateParts(chunk: Extract<StreamChunk, { type: "task_update" }>): Record<string, unknown>[] {
  const toolName = toolNameFromTitle(chunk.title);
  const title = chunk.title || toolName;
  if (chunk.status === "complete") {
    return [
      toolInputStartPart(chunk.id, toolName, title),
      {
        output: chunk.output ?? "complete",
        providerExecuted: true,
        toolCallId: chunk.id,
        type: "tool-output-available",
      },
    ];
  }
  if (chunk.status === "error") {
    return [
      toolInputStartPart(chunk.id, toolName, title),
      {
        errorText: chunk.output ?? "Tool failed",
        providerExecuted: true,
        toolCallId: chunk.id,
        type: "tool-output-error",
      },
    ];
  }
  return [
    toolInputStartPart(chunk.id, toolName, title),
    {
      dynamic: true,
      input: {
        status: chunk.status,
        ...(chunk.output ? { note: chunk.output } : {}),
      },
      providerExecuted: true,
      title,
      toolCallId: chunk.id,
      toolName,
      type: "tool-input-available",
    },
  ];
}

function toolInputStartPart(toolCallId: string, toolName: string, title: string): Record<string, unknown> {
  return {
    dynamic: true,
    providerExecuted: true,
    title,
    toolCallId,
    toolName,
    type: "tool-input-start",
  };
}

function toolNameFromTitle(title: string): string {
  const normalized = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "tool";
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
