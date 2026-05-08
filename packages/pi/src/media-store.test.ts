import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { MatrixMedia } from "@beeper/pickle";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mediaIdFromUrl, readMediaBuffer, readStoredMedia, saveMatrixAttachment } from "./media-store";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { force: true, recursive: true })));
  tempDirs.length = 0;
});

describe("media-store", () => {
  it("stores downloaded Matrix attachments with stable ids and sidecar metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "pickle-pi-media-"));
    tempDirs.push(rootDir);
    const media = {
      download: vi.fn(async () => ({ bytes: new TextEncoder().encode("hello") })),
      downloadEncrypted: vi.fn(),
    } as unknown as MatrixMedia;

    const stored = await saveMatrixAttachment({
      attachment: {
        contentType: "text/plain; charset=utf-8",
        contentUri: "mxc://example/file",
        filename: "note.txt",
        kind: "file",
        size: 5,
      },
      id: "event-file",
      media,
      rootDir,
    });

    expect(stored).toMatchObject({
      contentUri: "mxc://example/file",
      id: "event-file",
      kind: "file",
      mediaUrl: "media://local/event-file",
      mimeType: "text/plain",
      originalFilename: "note.txt",
      size: 5,
    });
    await expect(readFile(stored.path, "utf8")).resolves.toBe("hello");
    await expect(readMediaBuffer(rootDir, "event-file")).resolves.toEqual(Buffer.from("hello"));
    await expect(readStoredMedia(rootDir, "event-file")).resolves.toMatchObject({ id: "event-file", path: stored.path });
    expect(mediaIdFromUrl(stored.mediaUrl)).toBe("event-file");
    expect(media.download).toHaveBeenCalledWith({ contentUri: "mxc://example/file" });
  });
});
