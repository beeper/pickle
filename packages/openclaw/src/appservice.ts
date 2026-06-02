import {
  createBeeperBridge,
  type CreateNodeBeeperBridgeOptions,
  type PickleBridge,
} from "@beeper/pickle-bridge/node";
import type { MatrixAppserviceInitOptions, MatrixAppserviceRegistration } from "@beeper/pickle-bridge/beeper";
import { beeperBaseDomain } from "./beeper-setup";
import { DEFAULT_BEEPER_BRIDGE_TYPE } from "./ids";
import { createOpenClawConnector, type OpenClawConnectorOptions } from "./connector";
import { createAppserviceRegistration } from "./registration";
import type { OpenClawBridgeConfig } from "./types";

export interface CreateOpenClawBeeperBridgeOptions extends OpenClawConnectorOptions {
  bridge?: string;
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
    bridge: options.bridge ?? config?.bridgeId ?? config?.appserviceId ?? "sh-openclaw",
    bridgeType: options.bridgeType ?? DEFAULT_BEEPER_BRIDGE_TYPE,
    connector,
  };
  if (config?.matrixUserId !== undefined) bridgeOptions.ownerUserId = config.matrixUserId;
  bridgeOptions.address = "websocket";
  const baseDomain = beeperBaseDomain(config?.beeperEnv);
  if (baseDomain !== undefined) bridgeOptions.baseDomain = baseDomain;
  bridgeOptions.bridgeManagerPostState = true;
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
  await bridge.setBridgeState("running");
  return bridge;
}

function connectorOptions(options: CreateOpenClawBeeperBridgeOptions): OpenClawConnectorOptions {
  const output: OpenClawConnectorOptions = {};
  if (options.config !== undefined) output.config = options.config;
  if (options.onActivity !== undefined) output.onActivity = options.onActivity;
  if (options.registry !== undefined) output.registry = options.registry;
  if (options.runtimeFactory !== undefined) output.runtimeFactory = options.runtimeFactory;
  if (options.runtime !== undefined) output.runtime = options.runtime;
  return output;
}

function matrixOptionsFromConfig(
  config: OpenClawBridgeConfig | undefined,
  input: CreateNodeBeeperBridgeOptions["matrix"] | undefined
): CreateNodeBeeperBridgeOptions["matrix"] | undefined {
  const appservice = config && hasPersistedAppservice(config) ? appserviceInitFromConfig(config) : undefined;
  if (!appservice && input === undefined) return undefined;
  return {
    ...input,
    ...(appservice && input?.appservice === undefined ? { appservice } : {}),
    ...(appservice && config?.matrixDeviceId && input?.deviceId === undefined ? { deviceId: config.matrixDeviceId } : {}),
    ...(config?.homeserver && input?.homeserver === undefined ? { homeserver: config.homeserver } : {}),
  };
}

function hasPersistedAppservice(config: OpenClawBridgeConfig): boolean {
  return Boolean(config.asToken && config.hsToken && config.homeserver);
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
