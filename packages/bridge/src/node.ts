import { createMatrixClient } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import { resolve } from "node:path";
import { RuntimeBridge, createBeeperBridgeWithClient } from "./bridge";
import { createBridgeDataStore } from "./store";
import type { CreateNodeBeeperBridgeOptions, CreateNodeBridgeOptions, PickleBridge } from "./types";

export { BeeperBridgeManagerClient, createBeeperAppService, createBeeperAppServiceInit, createBeeperBridgeManagerClient, fetchBeeperBridges } from "./beeper";
export { createRemoteMessage } from "./events";
export { createBridgeDataStore, MatrixBridgeDataStore } from "./store";
export type * from "./beeper";
export type * from "./store";
export type * from "./types";
export { RuntimeBridge } from "./bridge";

export function createBridge(options: CreateNodeBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateNodeBeeperBridgeOptions): Promise<PickleBridge> {
  const store = options.store ?? options.matrix?.store ?? createFileMatrixStore(defaultDataDir(options));
  const matrix = {
    ...options.matrix,
    store,
  };
  return createBeeperBridgeWithClient({
    ...options,
    dataStore: options.dataStore ?? createBridgeDataStore(store),
    matrix,
  }, createMatrixClient({
    ...matrix,
    account: options.account,
    homeserver: matrix.homeserver ?? options.account.homeserver,
    token: matrix.token ?? options.account.accessToken,
  }));
}

function defaultDataDir(options: { bridge: string; dataDir?: string }): string {
  return resolve(options.dataDir ?? ".pickle-bridge", options.bridge, "matrix-state");
}
