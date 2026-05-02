import { normalizeBaseUrl } from "./utils";

export function mxcUrlToHttp(
  baseUrl: string,
  mxcUrl: string,
  width?: number,
  height?: number,
  resizeMethod?: string
): string | null {
  if (!mxcUrl?.startsWith("mxc://")) return mxcUrl || null;
  const [serverName, mediaId] = mxcUrl.slice("mxc://".length).split("/", 2);
  if (!serverName || !mediaId) return null;
  const path =
    width || height
      ? `/_matrix/media/v3/thumbnail/${serverName}/${mediaId}`
      : `/_matrix/media/v3/download/${serverName}/${mediaId}`;
  const url = new URL(path, normalizeBaseUrl(baseUrl));
  if (width) url.searchParams.set("width", String(width));
  if (height) url.searchParams.set("height", String(height));
  if (resizeMethod) url.searchParams.set("method", resizeMethod);
  return url.toString();
}

export function getHttpUriForMxc(
  baseUrl: string,
  mxcUrl: string,
  width?: number,
  height?: number,
  resizeMethod?: string
): string | null {
  return mxcUrlToHttp(baseUrl, mxcUrl, width, height, resizeMethod);
}
