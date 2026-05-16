import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import type { MatrixAttachment, MatrixMedia } from "@beeper/pickle";

export interface StoredMedia {
  contentUri?: string;
  encryptedFile?: MatrixAttachment["encryptedFile"];
  id: string;
  kind: MatrixAttachment["kind"] | "text";
  mimeType?: string;
  path: string;
  mediaUrl: string;
  originalFilename?: string;
  size: number;
}

export interface SaveMediaBufferOptions {
  rootDir: string;
  buffer: Uint8Array;
  mimeType?: string;
  originalFilename?: string;
  id?: string;
  mediaUrlPrefix?: string;
  matrixAttachment?: MatrixAttachment;
}

export async function saveMediaBuffer(options: SaveMediaBufferOptions): Promise<StoredMedia> {
  const root = resolve(options.rootDir);
  await mkdir(root, { recursive: true });
  const id = safeMediaId(options.id ?? randomUUID());
  const mimeType = normalizeMimeType(options.mimeType ?? options.matrixAttachment?.contentType);
  const filePath = resolveMediaBufferPath(root, id);
  await writeFile(filePath, Buffer.from(options.buffer), { mode: 0o600 });
  const stored: StoredMedia = {
    id,
    kind: options.matrixAttachment?.kind ?? kindFromMime(mimeType),
    path: filePath,
    mediaUrl: `${options.mediaUrlPrefix ?? "media://local/"}${id}`,
    size: options.buffer.byteLength,
  };
  if (mimeType) stored.mimeType = mimeType;
  if (options.originalFilename ?? options.matrixAttachment?.filename) {
    stored.originalFilename = basename((options.originalFilename ?? options.matrixAttachment?.filename) as string);
  }
  if (options.matrixAttachment?.contentUri) stored.contentUri = options.matrixAttachment.contentUri;
  if (options.matrixAttachment?.encryptedFile) stored.encryptedFile = options.matrixAttachment.encryptedFile;
  await writeFile(metadataPath(root, id), JSON.stringify(stored, null, 2), { mode: 0o600 });
  return stored;
}

export async function saveMatrixAttachment(options: {
  attachment: MatrixAttachment;
  id?: string;
  media: MatrixMedia;
  mediaUrlPrefix?: string;
  rootDir: string;
}): Promise<StoredMedia> {
  const downloaded = options.attachment.encryptedFile
    ? await options.media.downloadEncrypted({ file: options.attachment.encryptedFile })
    : options.attachment.contentUri
      ? await options.media.download({ contentUri: options.attachment.contentUri })
      : undefined;
  if (!downloaded) throw new Error("Matrix attachment is missing contentUri or encryptedFile");
  return saveMediaBuffer({
    buffer: downloaded.bytes,
    matrixAttachment: options.attachment,
    rootDir: options.rootDir,
    ...(options.id ? { id: options.id } : {}),
    ...(options.mediaUrlPrefix ? { mediaUrlPrefix: options.mediaUrlPrefix } : {}),
  });
}

export async function readMediaBuffer(rootDir: string, id: string): Promise<Buffer> {
  const media = await readStoredMedia(rootDir, id);
  return readFile(media.path);
}

export async function readStoredMedia(rootDir: string, id: string): Promise<StoredMedia> {
  const root = resolve(rootDir);
  const safeId = safeMediaId(id);
  const raw = await readFile(metadataPath(root, safeId), "utf8");
  const media = JSON.parse(raw) as StoredMedia;
  return {
    ...media,
    id: safeId,
    path: assertInside(root, resolve(root, basename(media.path))),
  };
}

export function resolveMediaBufferPath(rootDir: string, id: string): string {
  const root = resolve(rootDir);
  const safeId = safeMediaId(id);
  return assertInside(root, resolve(root, safeId));
}

export function mediaIdFromUrl(value: string): string | undefined {
  const index = value.lastIndexOf("/");
  return index === -1 ? undefined : safeMediaId(value.slice(index + 1));
}

export function normalizeMimeType(value: string | undefined): string | undefined {
  const normalized = value?.split(";")[0]?.trim().toLowerCase();
  return normalized || undefined;
}

export function kindFromMime(mimeType: string | undefined): MatrixAttachment["kind"] | "text" {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return "file";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("text/") || normalized === "application/json") return "text";
  return "file";
}

function metadataPath(root: string, id: string): string {
  return assertInside(root, resolve(root, `${id}.json`));
}

function safeMediaId(id: string): string {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 180);
  if (!safe || safe === "." || safe === "..") throw new Error("Invalid media id");
  return safe;
}

function assertInside(root: string, target: string): string {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}/`)) {
    throw new Error("Resolved media path escapes media root");
  }
  return resolvedTarget;
}
