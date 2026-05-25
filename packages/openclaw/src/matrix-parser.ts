import type { MatrixMessage } from "@beeper/pickle-bridge";

export interface ParsedMatrixTextMessage {
  attachments: unknown[];
  command?: {
    args: string;
    name: string;
  };
  formattedBody?: string;
  mentions?: { room?: boolean; userIds?: string[] };
  replyQuote?: {
    body?: string;
    sender?: string;
  };
  replyToEventId?: string;
  text: string;
  threadRootEventId?: string;
}

export function parseMatrixTextMessage(
  text: string,
  content: unknown,
  msg?: Pick<MatrixMessage, "attachments" | "event" | "replyTo" | "threadRoot">,
): ParsedMatrixTextMessage {
  const contentRecord = recordValue(content);
  const newContent = recordValue(contentRecord?.["m.new_content"]);
  const messageContent = newContent ?? contentRecord;
  const relates = recordValue(contentRecord?.["m.relates_to"]);
  const effectiveText = stringValue(messageContent?.body) ?? text;
  const replyToEventId =
    stringValue(msg?.replyTo?.id) ??
    stringValue(msg?.event.replyTo) ??
    stringValue(recordValue(relates?.["m.in_reply_to"])?.event_id) ??
    (relates?.rel_type === "m.thread" ? stringValue(relates.event_id) : undefined);
  const threadRootEventId = stringValue(msg?.threadRoot?.id) ?? stringValue(msg?.event.threadRoot) ?? (relates?.rel_type === "m.thread" ? stringValue(relates.event_id) : undefined);
  const fallback = extractMatrixReplyFallback(effectiveText);
  const body = fallback.body;
  const command = parseSlashCommand(body) ?? parseSlashCommand(stripLeadingMatrixMention(body));
  const formattedBody = stripMatrixHtmlReplyFallback(stringValue(messageContent?.formatted_body) ?? stringValue(msg?.event.html));
  const mentions = normalizeMentions(messageContent?.["m.mentions"] ?? contentRecord?.["m.mentions"] ?? msg?.event.mentions);
  const attachments = normalizeMatrixAttachments(msg?.attachments ?? msg?.event.attachments ?? [], messageContent ?? content);
  return {
    attachments,
    ...(command ? { command } : {}),
    ...(formattedBody ? { formattedBody } : {}),
    ...(mentions ? { mentions } : {}),
    ...(fallback.quote ? { replyQuote: fallback.quote } : {}),
    ...(replyToEventId ? { replyToEventId } : {}),
    text: body,
    ...(threadRootEventId ? { threadRootEventId } : {}),
  };
}

function stripMatrixHtmlReplyFallback(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const stripped = html.replace(/^\s*<mx-reply>[\s\S]*?<\/mx-reply>\s*/iu, "").trim();
  return stripped || undefined;
}

function normalizeMatrixAttachments(attachments: unknown[], content: unknown): unknown[] {
  const normalized: unknown[] = attachments.flatMap((attachment) => {
    const record = recordValue(attachment);
    if (!record) return [];
    return [stripUndefined({
      contentType: record.contentType,
      contentUri: record.contentUri,
      duration: record.duration,
      encryptedFile: record.encryptedFile,
      filename: record.filename,
      height: record.height,
      kind: record.kind,
      size: record.size,
      width: record.width,
    })];
  });
  const contentUri = stringValue(recordValue(content)?.url);
  if (normalized.length === 0 && contentUri) {
    normalized.push(stripUndefined({
      contentUri,
      filename: stringValue(recordValue(content)?.filename) ?? stringValue(recordValue(content)?.body),
      kind: matrixAttachmentKind(stringValue(recordValue(content)?.msgtype)),
    }));
  }
  return normalized;
}

function matrixAttachmentKind(msgtype: string | undefined): string | undefined {
  switch (msgtype) {
    case "m.image":
      return "image";
    case "m.video":
      return "video";
    case "m.audio":
      return "audio";
    case "m.file":
      return "file";
    default:
      return undefined;
  }
}

function normalizeMentions(value: unknown): ParsedMatrixTextMessage["mentions"] | undefined {
  const record = recordValue(value);
  if (!record) return undefined;
  const mentions: { room?: boolean; userIds?: string[] } = {};
  if (record.room === true) mentions.room = true;
  if (Array.isArray(record.user_ids)) mentions.userIds = record.user_ids.filter((item): item is string => typeof item === "string");
  if (Array.isArray(record.userIds)) mentions.userIds = record.userIds.filter((item): item is string => typeof item === "string");
  return mentions.room || mentions.userIds?.length ? mentions : undefined;
}

function extractMatrixReplyFallback(text: string): {
  body: string;
  quote?: {
    body?: string;
    sender?: string;
  };
} {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  let index = 0;
  while (index < lines.length && lines[index]?.startsWith(">")) index += 1;
  const quotedLines = lines.slice(0, index).map((line) => line.replace(/^>\s?/u, ""));
  if (index > 0 && lines[index] === "") index += 1;
  const body = lines.slice(index).join("\n").trim();
  const quote = parseMatrixReplyQuote(quotedLines);
  return {
    body,
    ...(quote ? { quote } : {}),
  };
}

function parseMatrixReplyQuote(lines: string[]): { body?: string; sender?: string } | undefined {
  const text = lines.join("\n").trim();
  if (!text) return undefined;
  const firstLine = lines[0]?.trim() ?? "";
  const senderMatch = /^<([^>]+)>\s?(.*)$/su.exec(firstLine);
  const sender = senderMatch?.[1]?.trim();
  const firstBody = senderMatch?.[2] ?? firstLine;
  const rest = lines.slice(1);
  const body = [firstBody, ...rest].join("\n").trim();
  return stripUndefined({
    ...(body ? { body } : {}),
    ...(sender ? { sender } : {}),
  });
}

function parseSlashCommand(text: string): ParsedMatrixTextMessage["command"] | undefined {
  if (!text.startsWith("/") || text.startsWith("//")) return undefined;
  const match = /^\/([A-Za-z][\w-]*)(?:\s+(.*))?$/su.exec(text.trim());
  if (!match) return undefined;
  return {
    args: match[2] ?? "",
    name: match[1]!.toLowerCase(),
  };
}

function stripLeadingMatrixMention(text: string): string {
  return text.trimStart().replace(/^@[^\s:]+(?::[^\s]+)?\s+/u, "");
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }
  return input;
}
