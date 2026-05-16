#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { BeeperEnvironment } from "@beeper/pickle/beeper/auth";
import { accountFromOpenClawConfig, startOpenClawBeeperBridge, type CreateOpenClawBeeperBridgeOptions } from "./appservice";
import { createOpenClawBeeperAppService, loginToBeeperForOpenClaw, setupOpenClawBeeperBridge } from "./beeper-setup";
import { createDefaultConfig, defaultConfigPath, readConfig, secretToken, writeConfig } from "./config";
import { createAppserviceRegistration } from "./registration";
import type { AppserviceRegistration, OpenClawBridgeConfig } from "./types";

export interface CliIO {
  stderr: Pick<typeof process.stderr, "write">;
  stdout: Pick<typeof process.stdout, "write">;
}

export interface CliDeps {
  startBridge?: (options: CreateOpenClawBeeperBridgeOptions) => Promise<unknown>;
}

export async function runCli(argv = process.argv.slice(2), io: CliIO = process, deps: CliDeps = {}): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      io.stdout.write(helpText());
      return 0;
    }
    if (command === "init") {
      const options = parseOptions(args);
      const config = createDefaultConfig(configOverridesFromOptions(options));
      await writeConfig(config, stringOption(options, "config") ?? defaultConfigPath(config.dataDir));
      io.stdout.write(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
      return 0;
    }
    if (command === "register") {
      const options = parseOptions(args);
      const config = await loadConfig(options);
      const registration = createAppserviceRegistration(config, {
        asToken: stringOption(options, "as-token") ?? secretToken(),
        hsToken: stringOption(options, "hs-token") ?? secretToken(),
      });
      const output = stringOption(options, "output") ?? resolve(config.dataDir, "registration.json");
      await writeRegistration(output, registration);
      io.stdout.write(`${output}\n`);
      return 0;
    }
    if (command === "status") {
      const config = await loadConfig(parseOptions(args));
      io.stdout.write(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
      return 0;
    }
    if (command === "start") {
      const options = parseOptions(args);
      const config = await loadConfig(options);
      const startOptions: CreateOpenClawBeeperBridgeOptions = {
        account: accountFromOpenClawConfig(config),
        config,
      };
      if (booleanOption(options, "get-only")) startOptions.getOnly = true;
      if (booleanOption(options, "backfill")) startOptions.backfill = true;
      const backfillLimit = numberOption(options, "backfill-limit");
      if (backfillLimit !== undefined) startOptions.backfillLimit = backfillLimit;
      await (deps.startBridge ?? startOpenClawBeeperBridge)(startOptions);
      io.stdout.write("OpenClaw bridge started\n");
      return 0;
    }
    if (command === "beeper-login") {
      const options = parseOptions(args);
      const email = requiredStringOption(options, "email");
      const loginCode = stringOption(options, "login-code");
      const loginOptions: Parameters<typeof loginToBeeperForOpenClaw>[0] = {
        email,
      };
      const env = beeperEnvOption(options);
      if (env !== undefined) loginOptions.env = env;
      if (loginCode !== undefined) loginOptions.getLoginCode = () => loginCode;
      if (booleanOption(options, "create-account")) loginOptions.onlyExistingAccounts = false;
      const result = await loginToBeeperForOpenClaw(loginOptions);
      const config = createDefaultConfig({
        ...configOverridesFromOptions(options),
        ...result.config,
      });
      await writeConfig(config, stringOption(options, "config") ?? defaultConfigPath(config.dataDir));
      io.stdout.write(`${JSON.stringify(redactConfig(config), null, 2)}\n`);
      return 0;
    }
    if (command === "beeper-register") {
      const options = parseOptions(args);
      const configPath = stringOption(options, "config");
      const existingConfig = configPath ? await readConfig(configPath) : createDefaultConfig(configOverridesFromOptions(options));
      const accessToken = stringOption(options, "access-token") ?? existingConfig.accessToken;
      if (!accessToken) throw new Error("beeper-register requires --access-token or a config with accessToken");
      const registerOptions: Parameters<typeof createOpenClawBeeperAppService>[0] = {
        accessToken,
        address: stringOption(options, "registration-url") ?? existingConfig.registrationUrl,
        getOnly: booleanOption(options, "get-only"),
        postState: !booleanOption(options, "no-post-state"),
        push: booleanOption(options, "push"),
        selfHosted: !booleanOption(options, "not-self-hosted"),
      };
      const baseDomain = stringOption(options, "base-domain") ?? beeperBaseDomainOption(options);
      const bridge = stringOption(options, "bridge");
      const bridgeType = stringOption(options, "bridge-type");
      const homeserver = stringOption(options, "homeserver") ?? existingConfig.homeserver;
      const homeserverDomain = stringOption(options, "homeserver-domain");
      const username = stringOption(options, "username");
      if (baseDomain !== undefined) registerOptions.baseDomain = baseDomain;
      if (bridge !== undefined) registerOptions.bridge = bridge;
      if (bridgeType !== undefined) registerOptions.bridgeType = bridgeType;
      if (homeserver !== undefined) registerOptions.homeserver = homeserver;
      if (homeserverDomain !== undefined) registerOptions.homeserverDomain = homeserverDomain;
      if (username !== undefined) registerOptions.username = username;
      const result = await createOpenClawBeeperAppService(registerOptions);
      const config = createDefaultConfig({
        ...existingConfig,
        ...configOverridesFromOptions(options),
        ...result.config,
        accessToken,
      });
      await writeConfig(config, configPath ?? defaultConfigPath(config.dataDir));
      io.stdout.write(`${JSON.stringify({ config: redactConfig(config), init: result.init }, null, 2)}\n`);
      return 0;
    }
    if (command === "beeper-setup") {
      const options = parseOptions(args);
      const email = requiredStringOption(options, "email");
      const loginCode = stringOption(options, "login-code");
      const setupOptions: Parameters<typeof setupOpenClawBeeperBridge>[0] = {
        email,
        postState: !booleanOption(options, "no-post-state"),
        push: booleanOption(options, "push"),
        selfHosted: !booleanOption(options, "not-self-hosted"),
      };
      const address = stringOption(options, "registration-url");
      const baseDomain = stringOption(options, "base-domain") ?? beeperBaseDomainOption(options);
      const bridge = stringOption(options, "bridge");
      const bridgeType = stringOption(options, "bridge-type");
      const env = beeperEnvOption(options);
      const homeserverDomain = stringOption(options, "homeserver-domain");
      const username = stringOption(options, "username");
      if (address !== undefined) setupOptions.address = address;
      if (baseDomain !== undefined) setupOptions.baseDomain = baseDomain;
      if (bridge !== undefined) setupOptions.bridge = bridge;
      if (bridgeType !== undefined) setupOptions.bridgeType = bridgeType;
      if (env !== undefined) setupOptions.env = env;
      if (loginCode !== undefined) setupOptions.getLoginCode = () => loginCode;
      if (homeserverDomain !== undefined) setupOptions.homeserverDomain = homeserverDomain;
      if (booleanOption(options, "create-account")) setupOptions.onlyExistingAccounts = false;
      if (username !== undefined) setupOptions.username = username;
      const result = await setupOpenClawBeeperBridge(setupOptions);
      const config = createDefaultConfig({
        ...configOverridesFromOptions(options),
        ...result.config,
      });
      await writeConfig(config, stringOption(options, "config") ?? defaultConfigPath(config.dataDir));
      io.stdout.write(`${JSON.stringify({ config: redactConfig(config), init: result.init }, null, 2)}\n`);
      return 0;
    }
    io.stderr.write(`Unknown command: ${command}\n\n${helpText()}`);
    return 2;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export async function writeRegistration(path: string, registration: AppserviceRegistration): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function helpText(): string {
  return [
    "pickle-openclaw <command>",
    "",
    "Commands:",
    "  init       Write a secure OpenClaw bridge config",
    "  register   Write a Matrix appservice registration file",
    "  start      Start the OpenClaw Beeper bridge from config",
    "  status     Print the redacted effective config",
    "  beeper-login     Log in to Beeper and write Matrix credentials",
    "  beeper-register  Register the OpenClaw appservice with Beeper",
    "  beeper-setup     Log in and register the OpenClaw appservice",
    "",
    "Common options:",
    "  --config <path>",
    "  --data-dir <path>",
    "  --homeserver <url>",
    "  --gateway-url <url>",
    "  --registration-url <url>",
    "  --matrix-device-id <id>",
    "  --matrix-user-id <mxid>",
    "  --access-token <token>",
    "  --hs-token <token>",
    "  --as-token <token>",
    "  --output <path>",
    "  --email <address>",
    "  --login-code <code>",
    "  --create-account",
    "  --backfill",
    "  --backfill-limit <count>",
    "  --env <production|staging|dev|local>",
    "",
  ].join("\n");
}

function configOverridesFromOptions(options: Map<string, string | boolean>): Partial<OpenClawBridgeConfig> {
  const overrides: Partial<OpenClawBridgeConfig> = {};
  const accessToken = stringOption(options, "access-token");
  const appserviceId = stringOption(options, "appservice-id");
  const dataDir = stringOption(options, "data-dir");
  const gatewayUrl = stringOption(options, "gateway-url");
  const homeserver = stringOption(options, "homeserver");
  const matrixDeviceId = stringOption(options, "matrix-device-id");
  const matrixUserId = stringOption(options, "matrix-user-id");
  const registrationUrl = stringOption(options, "registration-url");
  if (accessToken) overrides.accessToken = accessToken;
  if (appserviceId) overrides.appserviceId = appserviceId;
  if (dataDir) overrides.dataDir = dataDir;
  if (gatewayUrl) overrides.gatewayUrl = gatewayUrl;
  if (homeserver) overrides.homeserver = homeserver;
  if (matrixDeviceId) overrides.matrixDeviceId = matrixDeviceId;
  if (matrixUserId) overrides.matrixUserId = matrixUserId;
  if (registrationUrl) overrides.registrationUrl = registrationUrl;
  return overrides;
}

async function loadConfig(options: Map<string, string | boolean>): Promise<OpenClawBridgeConfig> {
  const configPath = stringOption(options, "config");
  if (configPath) return readConfig(configPath);
  return createDefaultConfig(configOverridesFromOptions(options));
}

function redactConfig(config: OpenClawBridgeConfig): OpenClawBridgeConfig {
  return {
    ...config,
    ...(config.accessToken ? { accessToken: "<redacted>" } : {}),
    ...(config.hsToken ? { hsToken: "<redacted>" } : {}),
  };
}

function parseOptions(args: string[]): Map<string, string | boolean> {
  const options = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      options.set(key, true);
      continue;
    }
    options.set(key, next);
    index += 1;
  }
  return options;
}

function stringOption(options: Map<string, string | boolean>, key: string): string | undefined {
  const value = options.get(key);
  return typeof value === "string" ? value : undefined;
}

function requiredStringOption(options: Map<string, string | boolean>, key: string): string {
  const value = stringOption(options, key);
  if (!value) throw new Error(`Missing required option --${key}`);
  return value;
}

function booleanOption(options: Map<string, string | boolean>, key: string): boolean {
  return options.get(key) === true;
}

function numberOption(options: Map<string, string | boolean>, key: string): number | undefined {
  const value = stringOption(options, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid --${key}: ${value}`);
  return parsed;
}

function beeperEnvOption(options: Map<string, string | boolean>): BeeperEnvironment | undefined {
  const env = stringOption(options, "env");
  if (env === undefined) return undefined;
  if (env === "production" || env === "staging" || env === "dev" || env === "local") return env;
  throw new Error(`Invalid --env: ${env}`);
}

function beeperBaseDomainOption(options: Map<string, string | boolean>): string | undefined {
  const env = beeperEnvOption(options);
  if (env === "dev") return "beeper-dev.com";
  if (env === "local") return "beeper.localtest.me";
  if (env === "staging") return "beeper-staging.com";
  return undefined;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
