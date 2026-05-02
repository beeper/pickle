export function normalizeBaseUrl(baseUrl?: string): string {
  if (!baseUrl) throw new Error("baseUrl is required");
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

export function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
