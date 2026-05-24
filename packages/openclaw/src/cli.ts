#!/usr/bin/env node
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import type { BeeperEnvironment } from "@beeper/pickle/beeper/auth";
import { accountFromOpenClawConfig, startOpenClawBeeperBridge, type CreateOpenClawBeeperBridgeOptions } from "./appservice";
import { createOpenClawBeeperAppService, loginToBeeperForOpenClaw, setupOpenClawBeeperBridge } from "./beeper-setup";
import { createDefaultConfig, defaultConfigPath, readConfig, secretToken, writeConfig } from "./config";
import { createOpenClawRuntimeFromLogin, userLoginFromOpenClawConfig } from "./connector";
import type { OpenClawGatewayRuntime } from "./openclaw-runtime";
import { createAppserviceRegistration } from "./registration";
import type { AppserviceRegistration, OpenClawBridgeConfig } from "./types";

export interface CliIO {
  stderr: Pick<typeof process.stderr, "write">;
  stdin?: NodeJS.ReadableStream;
  stdout: Pick<typeof process.stdout, "write">;
}

export interface CliDeps {
  createAppService?: typeof createOpenClawBeeperAppService;
  loginToBeeper?: typeof loginToBeeperForOpenClaw;
  runtimeFactory?: (config: OpenClawBridgeConfig) => OpenClawGatewayRuntime;
  setupBridge?: typeof setupOpenClawBeeperBridge;
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
        asToken: stringOption(options, "as-token") ?? config.asToken ?? secretToken(),
        hsToken: stringOption(options, "hs-token") ?? config.hsToken ?? secretToken(),
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
    if (command === "features") {
      const options = parseOptions(args);
      const config = await loadConfig(options);
      const runtime = deps.runtimeFactory?.(config) ?? runtimeFromConfig(config);
      try {
        io.stdout.write(`${JSON.stringify(await runtime.featureSnapshot(), null, 2)}\n`);
      } finally {
        await runtime.close();
      }
      return 0;
    }
    if (command === "rpc") {
      const { paramsText, positional } = splitOptionsAndPositionals(args);
      const options = parseOptions(args);
      const method = positional[0];
      if (!method) throw new Error("rpc requires a Gateway method name");
      const params = paramsText !== undefined ? parseJsonParam(paramsText) : parseJsonParam(positional[1] ?? "{}");
      const config = await loadConfig(options);
      const runtime = deps.runtimeFactory?.(config) ?? runtimeFromConfig(config);
      try {
        io.stdout.write(`${JSON.stringify(await runtime.call(method, params), null, 2)}\n`);
      } finally {
        await runtime.close();
      }
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
      else loginOptions.getLoginCode = () => promptForLoginCode(io);
      const result = await (deps.loginToBeeper ?? loginToBeeperForOpenClaw)(loginOptions);
      const config = createDefaultConfig({
        ...configOverridesFromOptions(options),
        ...beeperRuntimeOverridesFromOptions(options),
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
      const bridgeManagerToken = stringOption(options, "bridge-manager-token");
      const bridgeType = stringOption(options, "bridge-type");
      const homeserver = stringOption(options, "homeserver") ?? existingConfig.homeserver;
      const homeserverDomain = stringOption(options, "homeserver-domain");
      const username = stringOption(options, "username");
      if (baseDomain !== undefined) registerOptions.baseDomain = baseDomain;
      if (bridge !== undefined) registerOptions.bridge = bridge;
      if (bridgeManagerToken !== undefined) registerOptions.bridgeManagerToken = bridgeManagerToken;
      if (bridgeType !== undefined) registerOptions.bridgeType = bridgeType;
      if (homeserver !== undefined) registerOptions.homeserver = homeserver;
      if (homeserverDomain !== undefined) registerOptions.homeserverDomain = homeserverDomain;
      if (username !== undefined) registerOptions.username = username;
      const result = await (deps.createAppService ?? createOpenClawBeeperAppService)(registerOptions);
      const config = createDefaultConfig({
        ...existingConfig,
        ...configOverridesFromOptions(options),
        ...beeperRuntimeOverridesFromOptions(options),
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
      const bridgeManagerToken = stringOption(options, "bridge-manager-token");
      const bridgeType = stringOption(options, "bridge-type");
      const env = beeperEnvOption(options);
      const homeserverDomain = stringOption(options, "homeserver-domain");
      const username = stringOption(options, "username");
      if (address !== undefined) setupOptions.address = address;
      if (baseDomain !== undefined) setupOptions.baseDomain = baseDomain;
      if (bridge !== undefined) setupOptions.bridge = bridge;
      if (bridgeManagerToken !== undefined) setupOptions.bridgeManagerToken = bridgeManagerToken;
      if (bridgeType !== undefined) setupOptions.bridgeType = bridgeType;
      if (env !== undefined) setupOptions.env = env;
      if (loginCode !== undefined) setupOptions.getLoginCode = () => loginCode;
      else setupOptions.getLoginCode = () => promptForLoginCode(io);
      if (homeserverDomain !== undefined) setupOptions.homeserverDomain = homeserverDomain;
      if (username !== undefined) setupOptions.username = username;
      const result = await (deps.setupBridge ?? setupOpenClawBeeperBridge)(setupOptions);
      const config = createDefaultConfig({
        ...configOverridesFromOptions(options),
        ...beeperRuntimeOverridesFromOptions(options),
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
    "  features   Probe the documented OpenClaw Gateway feature surface",
    "  rpc        Call any OpenClaw Gateway RPC method",
    "  beeper-login     Log in to Beeper and write Matrix credentials",
    "  beeper-register  Register the OpenClaw appservice with Beeper",
    "  beeper-setup     Log in and register the OpenClaw appservice",
    "",
    "Common options:",
    "  --config <path>",
    "  --data-dir <path>",
    "  --homeserver <url>",
    "  --gateway-access-token <token>",
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
    "  --bridge-manager-token <token>",
    "  --backfill",
    "  --backfill-limit <count>",
    "  --params-json <json>",
    "  --env <production|staging|dev|local>",
    "",
  ].join("\n");
}

function configOverridesFromOptions(options: Map<string, string | boolean>): Partial<OpenClawBridgeConfig> {
  const overrides: Partial<OpenClawBridgeConfig> = {};
  const accessToken = stringOption(options, "access-token");
  const asToken = stringOption(options, "as-token");
  const appserviceId = stringOption(options, "appservice-id");
  const dataDir = stringOption(options, "data-dir");
  const gatewayAccessToken = stringOption(options, "gateway-access-token");
  const gatewayUrl = stringOption(options, "gateway-url");
  const homeserver = stringOption(options, "homeserver");
  const matrixDeviceId = stringOption(options, "matrix-device-id");
  const matrixUserId = stringOption(options, "matrix-user-id");
  const registrationUrl = stringOption(options, "registration-url");
  if (accessToken) overrides.accessToken = accessToken;
  if (asToken) overrides.asToken = asToken;
  if (appserviceId) overrides.appserviceId = appserviceId;
  if (dataDir) overrides.dataDir = dataDir;
  if (gatewayAccessToken) overrides.gatewayAccessToken = gatewayAccessToken;
  if (gatewayUrl) overrides.gatewayUrl = gatewayUrl;
  if (homeserver) overrides.homeserver = homeserver;
  if (matrixDeviceId) overrides.matrixDeviceId = matrixDeviceId;
  if (matrixUserId) overrides.matrixUserId = matrixUserId;
  if (registrationUrl) overrides.registrationUrl = registrationUrl;
  return overrides;
}

function beeperRuntimeOverridesFromOptions(options: Map<string, string | boolean>): Partial<OpenClawBridgeConfig> {
  const overrides: Partial<OpenClawBridgeConfig> = {};
  const baseDomain = stringOption(options, "base-domain") ?? beeperBaseDomainOption(options);
  const bridgeManagerToken = stringOption(options, "bridge-manager-token");
  const env = beeperEnvOption(options);
  const homeserverDomain = stringOption(options, "homeserver-domain");
  if (baseDomain !== undefined) overrides.baseDomain = baseDomain;
  if (bridgeManagerToken !== undefined) overrides.bridgeManagerToken = bridgeManagerToken;
  if (env !== undefined) overrides.beeperEnv = env;
  if (homeserverDomain !== undefined) overrides.homeserverDomain = homeserverDomain;
  if (options.has("no-post-state")) overrides.bridgeManagerPostState = false;
  else if (options.has("post-state")) overrides.bridgeManagerPostState = true;
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
    ...(config.asToken ? { asToken: "<redacted>" } : {}),
    ...(config.bridgeManagerToken ? { bridgeManagerToken: "<redacted>" } : {}),
    ...(config.gatewayAccessToken ? { gatewayAccessToken: "<redacted>" } : {}),
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

function splitOptionsAndPositionals(args: string[]): { paramsText?: string; positional: string[] } {
  const positional: string[] = [];
  let paramsText: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) continue;
    if (arg === "--params-json") {
      paramsText = args[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) index += 1;
      continue;
    }
    positional.push(arg);
  }
  return { ...(paramsText !== undefined ? { paramsText } : {}), positional };
}

function parseJsonParam(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON params: ${error instanceof Error ? error.message : String(error)}`);
  }
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

function runtimeFromConfig(config: OpenClawBridgeConfig): OpenClawGatewayRuntime {
  return createOpenClawRuntimeFromLogin(userLoginFromOpenClawConfig(config), config);
}

async function promptForLoginCode(io: CliIO): Promise<string> {
  const input = io.stdin ?? process.stdin;
  const rl = createInterface({
    input,
    output: io.stderr as NodeJS.WritableStream,
  });
  try {
    const code = (await rl.question("Enter Beeper login code: ")).trim();
    if (!code) throw new Error("Missing Beeper login code");
    return code;
  } finally {
    rl.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().then((code) => {
    process.exitCode = code;
  });
}
