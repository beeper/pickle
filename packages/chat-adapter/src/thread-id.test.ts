import { describe, expect, it } from "vitest";
import { decodeMatrixChatThreadRef, encodeMatrixChatThreadRef, matrixChannelIdFromChatThreadId } from "./thread-id";

describe("Matrix thread IDs", () => {
  it("round-trips room IDs", () => {
    const threadId = encodeMatrixChatThreadRef({ roomId: "!abc:example.com" });
    expect(decodeMatrixChatThreadRef(threadId)).toEqual({ roomId: "!abc:example.com" });
  });

  it("round-trips thread root event IDs", () => {
    const threadId = encodeMatrixChatThreadRef({
      eventId: "$event:example.com",
      roomId: "!abc:example.com",
    });
    expect(decodeMatrixChatThreadRef(threadId)).toEqual({
      eventId: "$event:example.com",
      roomId: "!abc:example.com",
    });
  });

  it("derives channel IDs", () => {
    const threadId = encodeMatrixChatThreadRef({
      eventId: "$event:example.com",
      roomId: "!abc:example.com",
    });
    expect(matrixChannelIdFromChatThreadId(threadId)).toBe(
      encodeMatrixChatThreadRef({ roomId: "!abc:example.com" })
    );
  });
});

