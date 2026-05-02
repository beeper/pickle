import type { MatrixMediaAttachment, MatrixMessageEvent, MatrixRawEvent } from "better-matrix-js";

export function toMatrixEventJson(event: MatrixRawEvent | MatrixMessageEvent): Record<string, any> {
  const raw = typeof event.raw === "object" && event.raw ? (event.raw as Record<string, any>) : {};
  const content = "body" in event ? messageContent(event) : event.content;
  return {
    ...raw,
    content,
    event_id: event.eventId,
    origin_server_ts: event.originServerTs,
    room_id: event.roomId,
    sender: event.sender,
    type: event.type,
  };
}

function messageContent(event: MatrixMessageEvent): Record<string, any> {
  const content = { ...event.content };
  content.body ??= event.body;
  content.msgtype ??= event.msgtype;
  if (event.formattedBody) {
    content.format ??= "org.matrix.custom.html";
    content.formatted_body ??= event.formattedBody;
  }
  const attachment = event.attachments?.[0];
  if (attachment) applyAttachmentContent(content, attachment);
  return content;
}

function applyAttachmentContent(content: Record<string, any>, attachment: MatrixMediaAttachment): void {
  content.msgtype = attachment.msgtype;
  content.url ??= attachment.contentUri;
  content.file ??= attachment.encryptedFile;
  content.info ??= attachment.info;
  content.filename ??= attachment.filename;
}
