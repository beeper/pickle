import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { getBeeperChannelSettings, type OpenClawSetupConfig } from "./setup";
import { openClawBeeperBridgeId } from "./ids";
import type { OpenClawBridgeConfig } from "./types";

export const DEFAULT_APPSERVICE_ID = "sh-openclaw";
export const DEFAULT_GHOST_LOCALPART_PREFIX = "openclaw_agent_";
export const DEFAULT_REGISTRATION_URL = "websocket";
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
  const matrixDeviceId = overrides.matrixDeviceId ?? process.env.PICKLE_OPENCLAW_MATRIX_DEVICE_ID;
  const config: OpenClawBridgeConfig = {
    appserviceId:
      overrides.appserviceId ??
      process.env.PICKLE_OPENCLAW_APPSERVICE_ID ??
      process.env.PICKLE_OPENCLAW_APP_SERVICE_ID ??
      DEFAULT_APPSERVICE_ID,
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
  const asToken = overrides.asToken ?? process.env.PICKLE_OPENCLAW_AS_TOKEN;
  const baseDomain = overrides.baseDomain ?? process.env.PICKLE_OPENCLAW_BASE_DOMAIN;
  const beeperEnv = overrides.beeperEnv ?? envBeeperEnv(process.env.PICKLE_OPENCLAW_BEEPER_ENV);
  const bridgeManagerToken = overrides.bridgeManagerToken ?? process.env.PICKLE_OPENCLAW_BRIDGE_MANAGER_TOKEN;
  const openClawDeviceId = process.env.PICKLE_OPENCLAW_DEVICE_ID ?? process.env.OPENCLAW_DEVICE_ID;
  const bridgeId = overrides.bridgeId ?? process.env.PICKLE_OPENCLAW_BRIDGE_ID ?? (openClawDeviceId ? openClawBeeperBridgeId(openClawDeviceId) : undefined);
  const homeserver = overrides.homeserver ?? process.env.PICKLE_OPENCLAW_HOMESERVER;
  const homeserverDomain = overrides.homeserverDomain ?? process.env.PICKLE_OPENCLAW_HOMESERVER_DOMAIN;
  const hsToken = overrides.hsToken ?? process.env.PICKLE_OPENCLAW_HS_TOKEN;
  const matrixUserId = overrides.matrixUserId ?? process.env.PICKLE_OPENCLAW_MATRIX_USER_ID;
  const backfillLimit = overrides.backfillLimit ?? envNumber(process.env.PICKLE_OPENCLAW_BACKFILL_LIMIT);
  const contactVisibility = overrides.contactVisibility ?? envContactVisibility(process.env.PICKLE_OPENCLAW_CONTACT_VISIBILITY);
  const importSources = overrides.importSources ?? envImportSources(process.env.PICKLE_OPENCLAW_IMPORT_SOURCES);
  const approvalBehavior = overrides.approvalBehavior ?? envApprovalBehavior(process.env.PICKLE_OPENCLAW_APPROVAL_BEHAVIOR);
  const bridgeManagerPostState = overrides.bridgeManagerPostState ?? envBoolean(process.env.PICKLE_OPENCLAW_BRIDGE_MANAGER_POST_STATE);
  const allowedRoomIds = overrides.allowedRoomIds ?? envStringList(process.env.PICKLE_OPENCLAW_ALLOW_ROOMS);
  const allowedUserIds = overrides.allowedUserIds ?? envStringList(process.env.PICKLE_OPENCLAW_ALLOW_USERS);
  if (accessToken) config.accessToken = accessToken;
  if (asToken) config.asToken = asToken;
  if (baseDomain) config.baseDomain = baseDomain;
  if (beeperEnv) config.beeperEnv = beeperEnv;
  if (bridgeId) config.bridgeId = bridgeId;
  if (bridgeManagerToken) config.bridgeManagerToken = bridgeManagerToken;
  if (homeserver) config.homeserver = homeserver;
  if (homeserverDomain) config.homeserverDomain = homeserverDomain;
  if (hsToken) config.hsToken = hsToken;
  if (matrixDeviceId) config.matrixDeviceId = matrixDeviceId;
  if (matrixUserId) config.matrixUserId = matrixUserId;
  if (backfillLimit !== undefined) config.backfillLimit = backfillLimit;
  if (contactVisibility !== undefined) config.contactVisibility = contactVisibility;
  if (importSources !== undefined) config.importSources = importSources;
  if (approvalBehavior !== undefined) config.approvalBehavior = approvalBehavior;
  if (bridgeManagerPostState !== undefined) config.bridgeManagerPostState = bridgeManagerPostState;
  if (allowedRoomIds) config.allowedRoomIds = allowedRoomIds;
  if (allowedUserIds) config.allowedUserIds = allowedUserIds;
  return config;
}

export async function readConfig(path = defaultConfigPath()): Promise<OpenClawBridgeConfig> {
  return createDefaultConfig(JSON.parse(await readFile(path, "utf8")) as Partial<OpenClawBridgeConfig>);
}

export function createConfigFromOpenClawSetup(
  cfg: OpenClawSetupConfig,
  overrides: Partial<OpenClawBridgeConfig> = {},
): OpenClawBridgeConfig {
  const settings = getBeeperChannelSettings(cfg);
  return createDefaultConfig({
    ...settings,
    ...overrides,
  });
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

function envNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function envContactVisibility(value: string | undefined): OpenClawBridgeConfig["contactVisibility"] | undefined {
  if (value === "agents" || value === "agents-and-users" || value === "none") return value;
  return undefined;
}

function envImportSources(value: string | undefined): OpenClawBridgeConfig["importSources"] | undefined {
  const sources = envStringList(value);
  if (!sources) return undefined;
  if (sources.every((source) => source === "dashboard" || source === "tui" || source === "channels" || source === "archived")) {
    return sources as OpenClawBridgeConfig["importSources"];
  }
  return undefined;
}

function envStringList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value.split(",").map((entry) => entry.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function envApprovalBehavior(value: string | undefined): OpenClawBridgeConfig["approvalBehavior"] | undefined {
  if (value === "native" || value === "disabled") return value;
  return undefined;
}

function envBeeperEnv(value: string | undefined): OpenClawBridgeConfig["beeperEnv"] | undefined {
  if (value === "production" || value === "staging" || value === "dev" || value === "local") return value;
  return undefined;
}
