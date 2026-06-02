import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { getBeeperAccountSettings, getBeeperChannelSettings, type OpenClawSetupConfig } from "./setup";
import { openClawBeeperBridgeId } from "./ids";
import type { OpenClawBridgeConfig } from "./types";
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/secret-input-runtime";

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
    serverEnv: overrides.serverEnv ?? "prod",
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
    const serverEnv = normalizeServerEnv(stringValue(beeper.serverEnv));
    const bridge = recordValue(beeper.bridge) as Partial<OpenClawBridgeConfig> | undefined;
    const config: Partial<OpenClawBridgeConfig> = { ...(bridge ?? {}) };
    const asToken = stringValue(beeper.asToken);
    const hsToken = stringValue(beeper.hsToken);
    if (serverEnv) config.serverEnv = serverEnv;
    if (asToken) config.asToken = asToken;
    if (hsToken) config.hsToken = hsToken;
    const dataDir = stringValue(beeper.dataDir);
    if (dataDir) config.dataDir = dataDir;
    return config;
  }
  return (record ?? {}) as Partial<OpenClawBridgeConfig>;
}

export function createConfigFromOpenClawSetup(
  cfg: OpenClawSetupConfig,
  overrides: Partial<OpenClawBridgeConfig> = {},
  accountId?: string | null,
): OpenClawBridgeConfig {
  const settings = getBeeperAccountSettings(cfg, accountId);
  return createDefaultConfig({
    ...settings.bridge,
    ...(typeof settings.asToken === "string" ? { asToken: settings.asToken } : {}),
    ...(typeof settings.hsToken === "string" ? { hsToken: settings.hsToken } : {}),
    ...(settings.serverEnv ? { serverEnv: settings.serverEnv } : {}),
    ...(settings.dataDir ? { dataDir: settings.dataDir } : {}),
    ...overrides,
  });
}

export async function createRuntimeConfigFromOpenClawSetup(
  cfg: OpenClawSetupConfig,
  overrides: Partial<OpenClawBridgeConfig> = {},
  accountId?: string | null,
): Promise<OpenClawBridgeConfig> {
  const settings = getBeeperAccountSettings(cfg, accountId);
  const accountPrefix = accountId && accountId !== "default" ? `channels.beeper.accounts.${accountId}` : "channels.beeper";
  const config = createConfigFromOpenClawSetup(cfg, overrides, accountId);
  const asToken = await resolveConfiguredSecretInputString({
    config: cfg,
    env: process.env,
    value: settings.asToken,
    path: `${accountPrefix}.asToken`,
  });
  if (asToken.value) config.asToken = asToken.value;
  const hsToken = await resolveConfiguredSecretInputString({
    config: cfg,
    env: process.env,
    value: settings.hsToken,
    path: `${accountPrefix}.hsToken`,
  });
  if (hsToken.value) config.hsToken = hsToken.value;
  return config;
}

export async function writeConfig(config: OpenClawBridgeConfig, path = defaultConfigPath(config.dataDir)): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function secretToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function normalizeServerEnv(value: string | undefined): OpenClawBridgeConfig["serverEnv"] | undefined {
  if (value === "prod" || value === "staging" || value === "dev" || value === "local") return value;
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
