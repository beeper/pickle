export type MaybePromise<T> = T | Promise<T>;

export function copyBytes(value: ArrayBuffer | Uint8Array | number[]): Uint8Array {
  if (value instanceof Uint8Array) {
    return new Uint8Array(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  return new Uint8Array(value);
}

export function bytesToBase64(bytes: Uint8Array): string {
  const BufferCtor = (globalThis as { Buffer?: { from(data: Uint8Array | string, encoding?: string): Buffer } }).Buffer;
  if (BufferCtor) {
    return BufferCtor.from(bytes).toString("base64");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const BufferCtor = (globalThis as { Buffer?: { from(data: Uint8Array | string, encoding?: string): Buffer } }).Buffer;
  if (BufferCtor) {
    return new Uint8Array(BufferCtor.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
