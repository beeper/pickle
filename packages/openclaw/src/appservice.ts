import type { MatrixAccount } from "@beeper/pickle";
import { createBeeperBridge, type CreateNodeBeeperBridgeOptions, type PickleBridge } from "@beeper/pickle-bridge";
import { DEFAULT_BEEPER_BRIDGE, DEFAULT_BEEPER_BRIDGE_TYPE } from "./beeper-setup";
import { createOpenClawConnector, type OpenClawConnectorOptions } from "./connector";
import type { OpenClawBridgeConfig } from "./types";

export interface CreateOpenClawBeeperBridgeOptions extends OpenClawConnectorOptions {
  account: MatrixAccount;
  bridge?: string;
  bridgeFactory?: (options: CreateNodeBeeperBridgeOptions) => Promise<PickleBridge>;
  bridgeType?: string;
  connector?: CreateNodeBeeperBridgeOptions["connector"];
  dataDir?: string;
  getOnly?: boolean;
  matrix?: CreateNodeBeeperBridgeOptions["matrix"];
  store?: CreateNodeBeeperBridgeOptions["store"];
}

export async function createOpenClawBeeperBridge(options: CreateOpenClawBeeperBridgeOptions): Promise<PickleBridge> {
  const config = options.config;
  const connector = options.connector ?? createOpenClawConnector(connectorOptions(options));
  const bridgeOptions: CreateNodeBeeperBridgeOptions = {
    account: options.account,
    bridge: options.bridge ?? DEFAULT_BEEPER_BRIDGE,
    bridgeType: options.bridgeType ?? DEFAULT_BEEPER_BRIDGE_TYPE,
    connector,
  };
  if (config?.registrationUrl !== undefined) bridgeOptions.address = config.registrationUrl;
  if (options.dataDir !== undefined) bridgeOptions.dataDir = options.dataDir;
  if (options.getOnly !== undefined) bridgeOptions.getOnly = options.getOnly;
  if (options.matrix !== undefined) bridgeOptions.matrix = options.matrix;
  if (options.store !== undefined) bridgeOptions.store = options.store;
  const bridgeFactory = options.bridgeFactory ?? createBeeperBridge;
  return bridgeFactory(bridgeOptions);
}

export async function startOpenClawBeeperBridge(options: CreateOpenClawBeeperBridgeOptions): Promise<PickleBridge> {
  const bridge = await createOpenClawBeeperBridge(options);
  await bridge.start();
  return bridge;
}

function connectorOptions(options: CreateOpenClawBeeperBridgeOptions): OpenClawConnectorOptions {
  const output: OpenClawConnectorOptions = {};
  if (options.config !== undefined) output.config = options.config;
  if (options.registry !== undefined) output.registry = options.registry;
  if (options.runtimeFactory !== undefined) output.runtimeFactory = options.runtimeFactory;
  if (options.streams !== undefined) output.streams = options.streams;
  if (options.transportFactory !== undefined) output.transportFactory = options.transportFactory;
  return output;
}
