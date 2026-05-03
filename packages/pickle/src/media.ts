import { base64ToBytes, bytesToBase64 } from "./bytes";
import type { MatrixMedia } from "./client-types";
import { stripUndefined } from "./object";
import type { MatrixCore } from "./runtime-types";
import type {
  SendMediaMessageOptions,
  SentEvent,
  UploadEncryptedMediaResult,
  UploadMediaOptions,
  UploadMediaResult,
} from "./types";

export function createMatrixMedia(core: () => MatrixCore | Promise<MatrixCore>): MatrixMedia {
  return {
    download: async (opts) => {
      const runtime = await core();
      if (runtime.callBytesResult && runtime.supportsByteCalls?.()) {
        return { bytes: await runtime.callBytesResult("download_media_bytes", opts) };
      }
      const result = await runtime.downloadMedia(opts);
      return { bytes: base64ToBytes(result.bytesBase64) };
    },
    downloadThumbnail: async (opts) => {
      const runtime = await core();
      if (runtime.callBytesResult && runtime.supportsByteCalls?.()) {
        return { bytes: await runtime.callBytesResult("download_media_thumbnail_bytes", opts) };
      }
      const result = await runtime.downloadMediaThumbnail(opts);
      return { bytes: base64ToBytes(result.bytesBase64) };
    },
    downloadEncrypted: async (opts) => {
      const runtime = await core();
      if (runtime.callBytesResult && runtime.supportsByteCalls?.()) {
        return { bytes: await runtime.callBytesResult("download_encrypted_media_bytes", opts) };
      }
      const result = await runtime.downloadEncryptedMedia(opts);
      return { bytes: base64ToBytes(result.bytesBase64) };
    },
    upload: async (opts) => uploadMediaBytes(await core(), opts),
    uploadEncrypted: async (opts) => uploadEncryptedMediaBytes(await core(), opts),
  };
}

export async function postMediaMessageBytes(
  core: MatrixCore,
  opts: SendMediaMessageOptions
): Promise<SentEvent> {
  const payload = stripUndefined({
    body: opts.caption,
    contentType: opts.contentType,
    duration: opts.duration,
    filename: opts.filename,
    height: opts.height,
    msgtype: opts.kind ? `m.${opts.kind}` as "m.image" | "m.video" | "m.audio" | "m.file" : undefined,
    roomId: opts.roomId,
    size: opts.size,
    threadRootEventId: opts.threadRoot,
    width: opts.width,
  });
  if (core.callBytesJson && core.supportsByteCalls?.()) {
    return core.callBytesJson("post_media_message_bytes", payload, opts.bytes);
  }
  return core.postMediaMessage({ ...payload, bytesBase64: bytesToBase64(opts.bytes) });
}

async function uploadMediaBytes(core: MatrixCore, opts: UploadMediaOptions): Promise<UploadMediaResult> {
  const payload = stripUndefined({
    contentType: opts.contentType,
    filename: opts.filename,
  });
  if (core.callBytesJson && core.supportsByteCalls?.()) {
    return core.callBytesJson("upload_media_bytes", payload, opts.bytes);
  }
  return core.uploadMedia({ ...payload, bytesBase64: bytesToBase64(opts.bytes) });
}

async function uploadEncryptedMediaBytes(
  core: MatrixCore,
  opts: UploadMediaOptions
): Promise<UploadEncryptedMediaResult> {
  const payload = stripUndefined({
    contentType: opts.contentType,
    filename: opts.filename,
  });
  if (core.callBytesJson && core.supportsByteCalls?.()) {
    return core.callBytesJson("upload_encrypted_media_bytes", payload, opts.bytes);
  }
  return core.uploadEncryptedMedia({ ...payload, bytesBase64: bytesToBase64(opts.bytes) });
}
