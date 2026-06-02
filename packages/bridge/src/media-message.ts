import type { MatrixClient, UploadMediaResult } from "@beeper/pickle";
import type { ConvertedMessagePart } from "./types";

export type BridgeMediaKind = "image" | "video" | "audio" | "file";

export interface BridgeMediaUploadClient {
  media: Pick<MatrixClient["media"], "upload">;
}

export interface BridgeMediaMessageOptions {
  bytes: Uint8Array;
  caption?: string;
  filename?: string;
  kind?: BridgeMediaKind;
}

export interface BridgeUploadedMediaMessage {
  content: Record<string, unknown>;
  part: ConvertedMessagePart;
  upload: UploadMediaResult;
}

export async function uploadBridgeMediaMessage(
  client: BridgeMediaUploadClient,
  options: BridgeMediaMessageOptions,
): Promise<BridgeUploadedMediaMessage> {
  const upload = await client.media.upload({
    bytes: options.bytes,
    ...(options.filename !== undefined ? { filename: options.filename } : {}),
  });
  const content = bridgeMediaMessageContent({
    contentUri: upload.contentUri,
    kind: options.kind ?? "file",
    ...(options.caption !== undefined ? { caption: options.caption } : {}),
    ...(options.filename !== undefined ? { filename: options.filename } : {}),
  });
  return {
    content,
    part: {
      content,
      type: "m.room.message",
    },
    upload,
  };
}

export function bridgeMediaMessageContent(options: {
  caption?: string;
  contentUri: string;
  filename?: string;
  kind: BridgeMediaKind;
}): Record<string, unknown> {
  return {
    body: options.caption ?? options.filename ?? "attachment",
    msgtype: mediaMsgtype(options.kind),
    url: options.contentUri,
    ...(options.filename ? { filename: options.filename } : {}),
  };
}

function mediaMsgtype(kind: BridgeMediaKind): string {
  if (kind === "image") return "m.image";
  if (kind === "video") return "m.video";
  if (kind === "audio") return "m.audio";
  return "m.file";
}
