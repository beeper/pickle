import { createMatrixClient } from "@beeper/pickle/node";
import { RuntimeBridge, createBeeperBridge as createRuntimeBeeperBridge } from "./bridge";
export { BeeperBridgeManagerClient, createBeeperAppService, createBeeperAppServiceInit, createBeeperBridgeManagerClient, fetchBeeperBridges } from "./beeper";
export { createRemoteMessage } from "./events";
import type { CreateNodeBeeperBridgeOptions, CreateNodeBridgeOptions, PickleBridge } from "./types";

export function createBridge(options: CreateNodeBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateNodeBeeperBridgeOptions): Promise<PickleBridge> {
  return createRuntimeBeeperBridge(options);
}

export type * from "./types";
export type * from "./beeper";
