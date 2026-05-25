import type { MatrixAccount, MatrixAppserviceInitOptions, MatrixAppserviceRegistration } from "@beeper/pickle";
import {
  createBeeperBridge,
  createBeeperBridgeManagerClient,
  type BeeperBridgeManagerClient,
  type CreateNodeBeeperBridgeOptions,
  type PickleBridge,
  type PostBridgeStateOptions,
} from "@beeper/pickle-bridge";
import { backfillAllOpenClawSessions } from "./backfill";
import { beeperBaseDomain } from "./beeper-setup";
import { DEFAULT_BEEPER_BRIDGE_TYPE } from "./ids";
import { createOpenClawConnector, userLoginFromOpenClawConfig, type OpenClawConnectorOptions } from "./connector";
import { createOpenClawHostTransport, OpenClawGatewayRuntime } from "./openclaw-runtime";
import { createAppserviceRegistration } from "./registration";
import { OpenClawBridgeRegistry } from "./registry";
import type { OpenClawBridgeConfig } from "./types";

export interface CreateOpenClawBeeperBridgeOptions extends OpenClawConnectorOptions {
  account: MatrixAccount;
  backfill?: boolean;
  backfillLimit?: number;
  bridge?: string;
  bridgeStateClientFactory?: (options: { baseDomain?: string; token: string }) => Pick<BeeperBridgeManagerClient, "postBridgeState">;
  bridgeFactory?: (options: CreateNodeBeeperBridgeOptions) => Promise<PickleBridge>;
  bridgeType?: string;
  connector?: CreateNodeBeeperBridgeOptions["connector"];
  dataDir?: string;
  getOnly?: boolean;
  log?: CreateNodeBeeperBridgeOptions["log"];
  matrix?: CreateNodeBeeperBridgeOptions["matrix"];
  store?: CreateNodeBeeperBridgeOptions["store"];
}

export async function createOpenClawBeeperBridge(options: CreateOpenClawBeeperBridgeOptions): Promise<PickleBridge> {
  const config = options.config;
  const connector = options.connector ?? createOpenClawConnector(connectorOptions(options));
  const bridgeOptions: CreateNodeBeeperBridgeOptions = {
    account: options.account,
    bridge: options.bridge ?? config?.bridgeId ?? config?.appserviceId ?? "sh-openclaw",
    bridgeType: options.bridgeType ?? DEFAULT_BEEPER_BRIDGE_TYPE,
    connector,
  };
  if (config?.registrationUrl !== undefined) bridgeOptions.address = config.registrationUrl;
  if (config?.baseDomain !== undefined) bridgeOptions.baseDomain = config.baseDomain;
  else {
    const baseDomain = beeperBaseDomain(config?.beeperEnv);
    if (baseDomain !== undefined) bridgeOptions.baseDomain = baseDomain;
  }
  if (config?.bridgeManagerToken !== undefined) bridgeOptions.bridgeManagerToken = config.bridgeManagerToken;
  if (config?.bridgeManagerPostState !== undefined) bridgeOptions.bridgeManagerPostState = config.bridgeManagerPostState;
  if (config?.homeserverDomain !== undefined) bridgeOptions.homeserverDomain = config.homeserverDomain;
  if (options.dataDir !== undefined) bridgeOptions.dataDir = options.dataDir;
  if (options.getOnly !== undefined) bridgeOptions.getOnly = options.getOnly;
  if (options.log !== undefined) bridgeOptions.log = options.log;
  const matrix = matrixOptionsFromConfig(config, options.matrix);
  if (matrix !== undefined) bridgeOptions.matrix = matrix;
  if (options.store !== undefined) bridgeOptions.store = options.store;
  const bridgeFactory = options.bridgeFactory ?? createBeeperBridge;
  return bridgeFactory(bridgeOptions);
}

export async function startOpenClawBeeperBridge(options: CreateOpenClawBeeperBridgeOptions): Promise<PickleBridge> {
  const bridge = await createOpenClawBeeperBridge(options);
  await bridge.start();
  await postOpenClawBridgeRunningState(options);
  await bridge.setBridgeState("running");
  if (options.backfill) {
    await runStartupBackfill(options, bridge);
  }
  return bridge;
}

async function runStartupBackfill(options: CreateOpenClawBeeperBridgeOptions, bridge: PickleBridge): Promise<void> {
  const config = options.config;
  if (!config) {
    options.log?.("warn", "openclaw_backfill_skipped", { reason: "missing_config" });
    return;
  }
  const registry = options.registry ?? registryFromConnector(bridge.connector);
  if (!registry) {
    options.log?.("warn", "openclaw_backfill_skipped", { reason: "missing_registry" });
    return;
  }
  const runtime = tryResolveOpenClawRuntime(options, config);
  if (!runtime) {
    options.log?.("warn", "openclaw_backfill_skipped", { reason: "missing_runtime" });
    return;
  }
  const login = userLoginFromOpenClawConfig(config);
  const backfillOptions: Parameters<typeof backfillAllOpenClawSessions>[0] = {
    bridge,
    login,
    registry,
    runtime,
  };
  if (config.importSources !== undefined) backfillOptions.importSources = config.importSources;
  if (options.backfillLimit !== undefined) backfillOptions.limit = options.backfillLimit;
  try {
    const result = await backfillAllOpenClawSessions(backfillOptions);
    await registry.save();
    options.log?.("info", "openclaw_backfill_finished", {
      portals: result.portals.length,
      sessions: result.sessions.length,
      skipped: result.skipped.length,
    });
  } catch (error) {
    options.log?.("error", "openclaw_backfill_failed", {
      error: errorMessage(error),
      stack: errorStack(error),
    });
  }
}

async function postOpenClawBridgeRunningState(options: CreateOpenClawBeeperBridgeOptions): Promise<void> {
  const config = options.config;
  const bridge = options.bridge ?? config?.bridgeId ?? config?.appserviceId;
  if (!config?.accessToken || !config.asToken || !bridge) return;
  const baseDomain = config.baseDomain ?? beeperBaseDomain(config.beeperEnv);
  const factory = options.bridgeStateClientFactory ?? createBeeperBridgeManagerClient;
  const clientOptions: { baseDomain?: string; token: string } = { token: config.accessToken };
  if (baseDomain !== undefined) clientOptions.baseDomain = baseDomain;
  const state: PostBridgeStateOptions = {
    bridge,
    bridgeType: options.bridgeType ?? DEFAULT_BEEPER_BRIDGE_TYPE,
    info: {
      openclaw: {
        appserviceId: config.appserviceId,
        matrixUserId: config.matrixUserId,
      },
    },
    isSelfHosted: true,
    reason: "BRIDGE_STARTED",
    stateEvent: "RUNNING",
  };
  try {
    await factory(clientOptions).postBridgeState(state, config.asToken);
  } catch {
    // The websocket bridge_status still reports liveness; keep the plugin running if the REST state echo fails.
  }
}

export function accountFromOpenClawConfig(config: OpenClawBridgeConfig): MatrixAccount {
  if (!config.accessToken) throw new Error("OpenClaw config is missing accessToken");
  if (!config.homeserver) throw new Error("OpenClaw config is missing homeserver");
  if (!config.matrixDeviceId) throw new Error("OpenClaw config is missing matrixDeviceId");
  if (!config.matrixUserId) throw new Error("OpenClaw config is missing matrixUserId");
  return {
    accessToken: config.accessToken,
    deviceId: config.matrixDeviceId,
    homeserver: config.homeserver,
    userId: config.matrixUserId,
  };
}

function connectorOptions(options: CreateOpenClawBeeperBridgeOptions): OpenClawConnectorOptions {
  const output: OpenClawConnectorOptions = {};
  if (options.config !== undefined) output.config = options.config;
  if (options.registry !== undefined) output.registry = options.registry;
  if (options.runtimeFactory !== undefined) output.runtimeFactory = options.runtimeFactory;
  if (options.runtime !== undefined) output.runtime = options.runtime;
  return output;
}

function resolveOpenClawRuntime(options: CreateOpenClawBeeperBridgeOptions, config: OpenClawBridgeConfig): OpenClawGatewayRuntime {
  if (options.runtime instanceof OpenClawGatewayRuntime) return options.runtime;
  if (options.runtime !== undefined) {
    return new OpenClawGatewayRuntime({ config, transport: createOpenClawHostTransport(options.runtime) });
  }
  if (options.runtimeFactory) return options.runtimeFactory(config);
  const connector = options.connector;
  if (connector && typeof connector === "object" && "runtime" in connector) {
    const runtime = (connector as { runtime?: unknown }).runtime;
    if (runtime instanceof OpenClawGatewayRuntime) return runtime;
  }
  throw new Error("OpenClaw direct plugin runtime is required");
}

function tryResolveOpenClawRuntime(
  options: CreateOpenClawBeeperBridgeOptions,
  config: OpenClawBridgeConfig
): OpenClawGatewayRuntime | undefined {
  try {
    return resolveOpenClawRuntime(options, config);
  } catch {
    return undefined;
  }
}

function registryFromConnector(connector: unknown): OpenClawBridgeRegistry | undefined {
  if (!connector || typeof connector !== "object" || !("registry" in connector)) return undefined;
  const registry = (connector as { registry?: unknown }).registry;
  return registry instanceof OpenClawBridgeRegistry ? registry : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

function matrixOptionsFromConfig(
  config: OpenClawBridgeConfig | undefined,
  input: CreateNodeBeeperBridgeOptions["matrix"] | undefined
): CreateNodeBeeperBridgeOptions["matrix"] | undefined {
  const appservice = config && hasPersistedAppservice(config) ? appserviceInitFromConfig(config) : undefined;
  if (!appservice && input === undefined) return undefined;
  const useUserMatrixAccount = !appservice && config && hasPersistedMatrixAccount(config);
  return {
    ...input,
    ...(useUserMatrixAccount && input?.account === undefined ? { account: accountFromOpenClawConfig(config) } : {}),
    ...(appservice && input?.appservice === undefined ? { appservice } : {}),
    ...(!appservice && config?.matrixDeviceId && input?.deviceId === undefined ? { deviceId: config.matrixDeviceId } : {}),
    ...(!appservice && config?.accessToken && input?.token === undefined ? { token: config.accessToken } : {}),
    ...(config?.homeserver && input?.homeserver === undefined ? { homeserver: config.homeserver } : {}),
  };
}

function hasPersistedAppservice(config: OpenClawBridgeConfig): boolean {
  return Boolean(config.asToken && config.hsToken && config.homeserver);
}

function hasPersistedMatrixAccount(config: OpenClawBridgeConfig): boolean {
  return Boolean(config.accessToken && config.homeserver && config.matrixDeviceId && config.matrixUserId);
}

function appserviceInitFromConfig(config: OpenClawBridgeConfig): MatrixAppserviceInitOptions {
  const registration = createAppserviceRegistration(config);
  return {
    homeserver: config.homeserver!,
    ...(config.homeserverDomain !== undefined ? { homeserverDomain: config.homeserverDomain } : {}),
    registration: {
      asToken: registration.as_token,
      hsToken: registration.hs_token,
      id: registration.id,
      namespaces: registration.namespaces,
      rateLimited: registration.rate_limited,
      senderLocalpart: registration.sender_localpart,
      url: registration.url,
    } satisfies MatrixAppserviceRegistration,
  };
}
