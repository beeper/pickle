import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { getBeeperChannelSettings, type OpenClawSetupConfig } from "./setup";
import { openClawBeeperBridgeId } from "./ids";
import type { OpenClawBridgeConfig } from "./types";

export const DEFAULT_APPSERVICE_ID = "sh-openclaw";
export const DEFAULT_REGISTRATION_URL = "websocket";

export function defaultDataDir(): string {
  return resolve(homedir(), ".openclaw", "pickle-bridge");
}

export function defaultConfigPath(dataDir = defaultDataDir()): string {
  return resolve(dataDir, "config.json");
}

export function createDefaultConfig(overrides: Partial<OpenClawBridgeConfig> = {}): OpenClawBridgeConfig {
  const dataDir = overrides.dataDir ?? process.env.PICKLE_OPENCLAW_DATA_DIR ?? defaultDataDir();
  const openClawDeviceId = process.env.PICKLE_OPENCLAW_DEVICE_ID ?? process.env.OPENCLAW_DEVICE_ID;
  const bridgeId =
    overrides.bridgeId ??
    (openClawDeviceId ? openClawBeeperBridgeId(openClawDeviceId) : undefined);
  const config: OpenClawBridgeConfig = {
    appserviceId:
      overrides.appserviceId ??
      bridgeId ??
      DEFAULT_APPSERVICE_ID,
    dataDir,
    beeperEnv: overrides.beeperEnv ?? envBeeperEnv(process.env.PICKLE_OPENCLAW_BEEPER_ENV) ?? "production",
  };
  const asToken = overrides.asToken;
  const homeserver = overrides.homeserver;
  const homeserverDomain = overrides.homeserverDomain;
  const hsToken = overrides.hsToken;
  const matrixDeviceId = overrides.matrixDeviceId;
  const matrixUserId = overrides.matrixUserId;
  if (asToken) config.asToken = asToken;
  if (bridgeId) config.bridgeId = bridgeId;
  if (homeserver) config.homeserver = homeserver;
  if (homeserverDomain) config.homeserverDomain = homeserverDomain;
  if (hsToken) config.hsToken = hsToken;
  if (matrixDeviceId) config.matrixDeviceId = matrixDeviceId;
  if (matrixUserId) config.matrixUserId = matrixUserId;
  return config;
}

export async function readConfig(path = defaultConfigPath()): Promise<OpenClawBridgeConfig> {
  return createDefaultConfig(configInput(JSON.parse(await readFile(path, "utf8"))));
}

function configInput(input: unknown): Partial<OpenClawBridgeConfig> {
  const record = recordValue(input);
  const beeper = recordValue(recordValue(record?.channels)?.beeper);
  if (beeper) {
    const beeperEnv = envBeeperEnv(stringValue(beeper.beeperEnv));
    const bridge = recordValue(beeper.bridge) as Partial<OpenClawBridgeConfig> | undefined;
    const config: Partial<OpenClawBridgeConfig> = { ...(bridge ?? {}) };
    if (beeperEnv) config.beeperEnv = beeperEnv;
    const dataDir = stringValue(beeper.dataDir);
    if (dataDir) config.dataDir = dataDir;
    return config;
  }
  return (record ?? {}) as Partial<OpenClawBridgeConfig>;
}

export function createConfigFromOpenClawSetup(
  cfg: OpenClawSetupConfig,
  overrides: Partial<OpenClawBridgeConfig> = {},
): OpenClawBridgeConfig {
  const settings = getBeeperChannelSettings(cfg);
  return createDefaultConfig({
    ...settings.bridge,
    ...(settings.beeperEnv ? { beeperEnv: settings.beeperEnv } : {}),
    ...(settings.dataDir ? { dataDir: settings.dataDir } : {}),
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

function envBeeperEnv(value: string | undefined): OpenClawBridgeConfig["beeperEnv"] | undefined {
  if (value === "production" || value === "staging" || value === "dev" || value === "local") return value;
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
