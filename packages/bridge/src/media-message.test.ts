import { describe, expect, it, vi } from "vitest";
import { bridgeMediaMessageContent, uploadBridgeMediaMessage } from "./media-message";

describe("bridge media messages", () => {
  it("uploads bytes and returns a Matrix media message part", async () => {
    const upload = vi.fn(async () => ({ contentUri: "mxc://example/file", raw: { ok: true } }));

    await expect(uploadBridgeMediaMessage({
      media: { upload },
    }, {
      bytes: new Uint8Array([1, 2, 3]),
      caption: "caption",
      filename: "a.png",
      kind: "image",
    })).resolves.toEqual({
      content: {
        body: "caption",
        filename: "a.png",
        msgtype: "m.image",
        url: "mxc://example/file",
      },
      part: {
        content: {
          body: "caption",
          filename: "a.png",
          msgtype: "m.image",
          url: "mxc://example/file",
        },
        type: "m.room.message",
      },
      upload: { contentUri: "mxc://example/file", raw: { ok: true } },
    });
    expect(upload).toHaveBeenCalledWith({
      bytes: new Uint8Array([1, 2, 3]),
      filename: "a.png",
    });
  });

  it("maps media kinds to Matrix msgtypes", () => {
    expect(bridgeMediaMessageContent({ contentUri: "mxc://x", kind: "video" })).toMatchObject({ msgtype: "m.video" });
    expect(bridgeMediaMessageContent({ contentUri: "mxc://x", kind: "audio" })).toMatchObject({ msgtype: "m.audio" });
    expect(bridgeMediaMessageContent({ contentUri: "mxc://x", kind: "file" })).toMatchObject({ body: "attachment", msgtype: "m.file" });
  });
});
