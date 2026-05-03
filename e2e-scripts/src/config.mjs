import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const SDK_ROOT = process.env.MATRIX_E2E_SDK_ROOT
  ? resolve(process.env.MATRIX_E2E_SDK_ROOT)
  : resolve(ROOT, "../matrix-chat-sdk");
export const OUT_DIR = process.env.MATRIX_E2E_OUT_DIR
  ? resolve(process.env.MATRIX_E2E_OUT_DIR)
  : resolve(ROOT, ".out");
export const STORE_DIR = resolve(OUT_DIR, "stores");
export const ACCOUNTS_PATH = resolve(OUT_DIR, "accounts.json");

export const HOMESERVER_URL =
  process.env.MATRIX_E2E_HOMESERVER_URL ?? "https://matrix-client.matrix.org";
export const BEEPER_DOMAIN =
  process.env.MATRIX_E2E_BEEPER_DOMAIN ?? new URL(HOMESERVER_URL).hostname;

export const RUN_ID =
  process.env.MATRIX_E2E_RUN_ID ??
  `${Date.now()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0")}`;

export async function ensureOutDirs() {
  await mkdir(STORE_DIR, { recursive: true });
}

export function sdkDist(path) {
  return resolve(SDK_ROOT, path);
}
