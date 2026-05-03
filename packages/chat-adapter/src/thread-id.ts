import type { MatrixChatThreadRef } from "./types";

const PREFIX = "matrix";

export function encodeMatrixChatThreadRef(data: MatrixChatThreadRef): string {
  const parts = [PREFIX, encodeSegment(data.roomId)];
  if (data.eventId) {
    parts.push(encodeSegment(data.eventId));
  }
  return parts.join(":");
}

export function decodeMatrixChatThreadRef(threadId: string): MatrixChatThreadRef {
  const [prefix, roomId, eventId, ...rest] = threadId.split(":");
  if (prefix !== PREFIX || !roomId || rest.length > 0) {
    throw new Error(`Invalid Pickle thread ref: ${threadId}`);
  }
  const decoded: MatrixChatThreadRef = { roomId: decodeSegment(roomId) };
  if (eventId) {
    decoded.eventId = decodeSegment(eventId);
  }
  return decoded;
}

export function matrixChannelIdFromChatThreadId(threadId: string): string {
  const { roomId } = decodeMatrixChatThreadRef(threadId);
  return encodeMatrixChatThreadRef({ roomId });
}

function encodeSegment(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeSegment(input: string): string {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}
