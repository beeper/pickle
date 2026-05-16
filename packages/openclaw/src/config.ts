import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { OpenClawBridgeConfig } from "./types";

export const DEFAULT_APPSERVICE_ID = "pickle-openclaw";
export const DEFAULT_GHOST_LOCALPART_PREFIX = "openclaw_agent_";
export const DEFAULT_REGISTRATION_URL = "http://127.0.0.1:29391";
export const DEFAULT_SENDER_LOCALPART = "openclawbot";
export const DEFAULT_SERVICE_BOT_LOCALPART = "openclawbot";
export const DEFAULT_USER_LOCALPART_PREFIX = "openclaw_user_";

export function defaultDataDir(): string {
  return resolve(homedir(), ".openclaw", "pickle-bridge");
}

export function defaultConfigPath(dataDir = defaultDataDir()): string {
  return resolve(dataDir, "config.json");
}

export function createDefaultConfig(overrides: Partial<OpenClawBridgeConfig> = {}): OpenClawBridgeConfig {
  const dataDir = overrides.dataDir ?? process.env.PICKLE_OPENCLAW_DATA_DIR ?? defaultDataDir();
  const config: OpenClawBridgeConfig = {
    appserviceId: overrides.appserviceId ?? process.env.PICKLE_OPENCLAW_APPSERVICE_ID ?? DEFAULT_APPSERVICE_ID,
    dataDir,
    ghostLocalpartPrefix:
      overrides.ghostLocalpartPrefix ??
      process.env.PICKLE_OPENCLAW_GHOST_LOCALPART_PREFIX ??
      DEFAULT_GHOST_LOCALPART_PREFIX,
    nonFederatedRooms: overrides.nonFederatedRooms ?? envBoolean(process.env.PICKLE_OPENCLAW_NON_FEDERATED_ROOMS) ?? true,
    registrationUrl:
      overrides.registrationUrl ?? process.env.PICKLE_OPENCLAW_REGISTRATION_URL ?? DEFAULT_REGISTRATION_URL,
    senderLocalpart: overrides.senderLocalpart ?? process.env.PICKLE_OPENCLAW_SENDER_LOCALPART ?? DEFAULT_SENDER_LOCALPART,
    serviceBotLocalpart:
      overrides.serviceBotLocalpart ??
      process.env.PICKLE_OPENCLAW_SERVICE_BOT_LOCALPART ??
      DEFAULT_SERVICE_BOT_LOCALPART,
    storePath: overrides.storePath ?? process.env.PICKLE_OPENCLAW_STORE_PATH ?? resolve(dataDir, "matrix-store"),
    userLocalpartPrefix:
      overrides.userLocalpartPrefix ?? process.env.PICKLE_OPENCLAW_USER_LOCALPART_PREFIX ?? DEFAULT_USER_LOCALPART_PREFIX,
  };
  const accessToken = overrides.accessToken ?? process.env.PICKLE_OPENCLAW_ACCESS_TOKEN;
  const gatewayUrl = overrides.gatewayUrl ?? process.env.PICKLE_OPENCLAW_GATEWAY_URL;
  const homeserver = overrides.homeserver ?? process.env.PICKLE_OPENCLAW_HOMESERVER;
  const hsToken = overrides.hsToken ?? process.env.PICKLE_OPENCLAW_HS_TOKEN;
  const matrixDeviceId = overrides.matrixDeviceId ?? process.env.PICKLE_OPENCLAW_MATRIX_DEVICE_ID;
  const matrixUserId = overrides.matrixUserId ?? process.env.PICKLE_OPENCLAW_MATRIX_USER_ID;
  if (accessToken) config.accessToken = accessToken;
  if (gatewayUrl) config.gatewayUrl = gatewayUrl;
  if (homeserver) config.homeserver = homeserver;
  if (hsToken) config.hsToken = hsToken;
  if (matrixDeviceId) config.matrixDeviceId = matrixDeviceId;
  if (matrixUserId) config.matrixUserId = matrixUserId;
  if (overrides.allowedRoomIds) config.allowedRoomIds = overrides.allowedRoomIds;
  if (overrides.allowedUserIds) config.allowedUserIds = overrides.allowedUserIds;
  return config;
}

export async function readConfig(path = defaultConfigPath()): Promise<OpenClawBridgeConfig> {
  return createDefaultConfig(JSON.parse(await readFile(path, "utf8")) as Partial<OpenClawBridgeConfig>);
}

export async function writeConfig(config: OpenClawBridgeConfig, path = defaultConfigPath(config.dataDir)): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function secretToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function envBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}
