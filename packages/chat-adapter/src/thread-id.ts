import type { MatrixChatThreadRef } from "./types";

const PREFIX = "matrix";

export function encodeMatrixChatThreadRef(data: MatrixChatThreadRef): string {
  const parts = [PREFIX, encodeURIComponent(data.roomId)];
  if (data.eventId) {
    parts.push(encodeURIComponent(data.eventId));
  }
  return parts.join(":");
}

export function decodeMatrixChatThreadRef(threadId: string): MatrixChatThreadRef {
  const [prefix, roomId, eventId, ...rest] = threadId.split(":");
  if (prefix !== PREFIX || !roomId || rest.length > 0) {
    throw new Error(`Invalid Pickle thread ref: ${threadId}`);
  }
  const decoded: MatrixChatThreadRef = { roomId: decodeURIComponent(roomId) };
  if (eventId) {
    decoded.eventId = decodeURIComponent(eventId);
  }
  return decoded;
}

export function matrixChannelIdFromChatThreadId(threadId: string): string {
  const { roomId } = decodeMatrixChatThreadRef(threadId);
  return encodeMatrixChatThreadRef({ roomId });
}
