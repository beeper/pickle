#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import type { BeeperEnvironment } from "@beeper/pickle/beeper/auth";
import { setupOpenClawBeeperBridge } from "./beeper-setup";
import { createDefaultConfig, defaultConfigPath, readConfig, writeConfig } from "./config";
import type { OpenClawBridgeConfig } from "./types";

export interface CliIO {
  stderr: Pick<typeof process.stderr, "write">;
  stdin?: NodeJS.ReadableStream;
  stdout: Pick<typeof process.stdout, "write">;
}

export interface CliDeps {
  setupBridge?: typeof setupOpenClawBeeperBridge;
}

export async function runCli(argv = process.argv.slice(2), io: CliIO = process, deps: CliDeps = {}): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (!command || command === "help" || command === "--help" || command === "-h") {
      io.stdout.write(helpText());
      return 0;
    }
    if (command === "login") {
      const options = parseOptions(args);
      const email = requiredStringOption(options, "email");
      const setupOptions: Parameters<typeof setupOpenClawBeeperBridge>[0] = {
        email,
        postState: !booleanOption(options, "no-post-state"),
        push: booleanOption(options, "push"),
        selfHosted: !booleanOption(options, "not-self-hosted"),
      };
      const address = stringOption(options, "registration-url");
      const baseDomain = stringOption(options, "base-domain") ?? beeperBaseDomainOption(options);
      const bridgeManagerToken = stringOption(options, "bridge-manager-token");
      const bridgeType = stringOption(options, "bridge-type");
      const env = beeperEnvOption(options);
      const homeserverDomain = stringOption(options, "homeserver-domain");
      const username = stringOption(options, "username");
      if (address !== undefined) setupOptions.address = address;
      if (baseDomain !== undefined) setupOptions.baseDomain = baseDomain;
      if (bridgeManagerToken !== undefined) setupOptions.bridgeManagerToken = bridgeManagerToken;
      if (bridgeType !== undefined) setupOptions.bridgeType = bridgeType;
      if (env !== undefined) setupOptions.env = env;
      setupOptions.getLoginCode = () => promptForLoginCode(io);
      if (homeserverDomain !== undefined) setupOptions.homeserverDomain = homeserverDomain;
      if (username !== undefined) setupOptions.username = username;
      const result = await (deps.setupBridge ?? setupOpenClawBeeperBridge)(setupOptions);
      const config = createDefaultConfig({
        ...configOverridesFromOptions(options),
        ...beeperRuntimeOverridesFromOptions(options),
        ...result.config,
      });
      await writeConfig(config, stringOption(options, "config") ?? defaultConfigPath(config.dataDir));
      io.stdout.write(`${JSON.stringify({
        account: whoamiPayload(config),
      }, null, 2)}\n`);
      return 0;
    }
    if (command === "whoami") {
      const config = await loadConfig(parseOptions(args));
      io.stdout.write(`${JSON.stringify(whoamiPayload(config), null, 2)}\n`);
      return 0;
    }
    io.stderr.write(`Unknown command: ${command}\n\n${helpText()}`);
    return 2;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

function helpText(): string {
  return [
    "pickle-openclaw <command>",
    "",
    "Commands:",
    "  login   Log in to Beeper and register the OpenClaw appservice",
    "  whoami  Print the saved Beeper bridge identity",
    "",
    "Common options:",
    "  --config <path>",
    "  --data-dir <path>",
    "  --email <address>",
    "  --registration-url <url>",
    "  --bridge-manager-token <token>",
    "  --env <production|staging|dev|local>",
    "",
  ].join("\n");
}

function configOverridesFromOptions(options: Map<string, string | boolean>): Partial<OpenClawBridgeConfig> {
  const overrides: Partial<OpenClawBridgeConfig> = {};
  const dataDir = stringOption(options, "data-dir");
  const registrationUrl = stringOption(options, "registration-url");
  if (dataDir) overrides.dataDir = dataDir;
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

function whoamiPayload(config: OpenClawBridgeConfig): Record<string, unknown> {
  return {
    appserviceId: config.appserviceId,
    beeperEnv: config.beeperEnv ?? "production",
    bridgeId: config.bridgeId ?? null,
    bridgeManagerPostState: config.bridgeManagerPostState ?? true,
    canConnect: Boolean(
      config.accessToken &&
      config.asToken &&
      config.homeserver &&
      config.hsToken &&
      config.matrixDeviceId &&
      config.matrixUserId &&
      config.registrationUrl
    ),
    deviceId: config.matrixDeviceId ?? null,
    homeserver: config.homeserver ?? null,
    registrationUrl: config.registrationUrl,
    userId: config.matrixUserId ?? null,
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
