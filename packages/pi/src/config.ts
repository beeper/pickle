import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { PicklePiConfig } from "./types";

export const DEFAULT_APP_SERVICE_ID = "pickle-pi";
export const DEFAULT_GHOST_LOCALPART = "pi";
export const DEFAULT_SERVICE_BOT_LOCALPART = "pickle_pi";

export function defaultDataDir(): string {
  return resolve(homedir(), ".pi", "pickle-pi");
}

export function defaultConfigPath(dataDir = defaultDataDir()): string {
  return resolve(dataDir, "config.json");
}

export function createDefaultConfig(overrides: Partial<PicklePiConfig> = {}): PicklePiConfig {
  const dataDir = overrides.dataDir ?? process.env.PICKLE_PI_DATA_DIR ?? defaultDataDir();
  const config: PicklePiConfig = {
    appserviceId: overrides.appserviceId ?? process.env.PICKLE_PI_APPSERVICE_ID ?? DEFAULT_APP_SERVICE_ID,
    dataDir,
    ghostLocalpart: overrides.ghostLocalpart ?? process.env.PICKLE_PI_GHOST_LOCALPART ?? DEFAULT_GHOST_LOCALPART,
    serviceBotLocalpart:
      overrides.serviceBotLocalpart ?? process.env.PICKLE_PI_SERVICE_BOT_LOCALPART ?? DEFAULT_SERVICE_BOT_LOCALPART,
    storePath: overrides.storePath ?? process.env.PICKLE_PI_STORE_PATH ?? resolve(dataDir, "matrix-store"),
  };
  const homeserver = overrides.homeserver ?? process.env.PICKLE_PI_HOMESERVER;
  const accessToken = overrides.accessToken ?? process.env.PICKLE_PI_ACCESS_TOKEN;
  const pickleKey = overrides.pickleKey ?? process.env.PICKLE_PI_PICKLE_KEY;
  const recoveryKey = overrides.recoveryKey ?? process.env.PICKLE_PI_RECOVERY_KEY;
  if (homeserver) config.homeserver = homeserver;
  if (accessToken) config.accessToken = accessToken;
  if (pickleKey) config.pickleKey = pickleKey;
  if (recoveryKey) config.recoveryKey = recoveryKey;
  if (overrides.allowedRoomIds) config.allowedRoomIds = overrides.allowedRoomIds;
  if (overrides.allowedUserIds) config.allowedUserIds = overrides.allowedUserIds;
  return config;
}

export async function readConfig(path = defaultConfigPath()): Promise<PicklePiConfig> {
  const json = JSON.parse(await readFile(path, "utf8")) as Partial<PicklePiConfig>;
  return createDefaultConfig(json);
}

export async function writeConfig(config: PicklePiConfig, path = defaultConfigPath(config.dataDir)): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function secretToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
