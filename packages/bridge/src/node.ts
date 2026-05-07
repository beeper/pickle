import { createMatrixClient } from "@beeper/pickle/node";
import { RuntimeBridge } from "./bridge";
export { BeeperBridgeManagerClient, createBeeperAppService, createBeeperAppServiceInit, createBeeperBridgeManagerClient, fetchBeeperBridges } from "./beeper";
export { createRemoteMessage } from "./events";
import type { CreateNodeBridgeOptions, PickleBridge } from "./types";

export function createBridge(options: CreateNodeBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export type * from "./types";
export type * from "./beeper";
