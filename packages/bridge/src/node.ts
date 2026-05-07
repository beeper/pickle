import { createMatrixClient } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import { resolve } from "node:path";
import {
  RuntimeBridge,
  createBeeperBridge as createRuntimeBeeperBridge,
  createBeeperBridgeFromPassword as createRuntimeBeeperBridgeFromPassword,
  createBeeperBridgeFromToken as createRuntimeBeeperBridgeFromToken,
} from "./bridge";
import { createBridgeDataStore } from "./store";
export { BeeperBridgeManagerClient, createBeeperAppService, createBeeperAppServiceInit, createBeeperBridgeManagerClient, fetchBeeperBridges } from "./beeper";
export { createBridgeDataStore, MatrixBridgeDataStore } from "./store";
export { createRemoteMessage } from "./events";
import type {
  CreateNodeBeeperBridgeFromPasswordOptions,
  CreateNodeBeeperBridgeFromTokenOptions,
  CreateNodeBeeperBridgeOptions,
  CreateNodeBridgeOptions,
  PickleBridge,
} from "./types";

export function createBridge(options: CreateNodeBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateNodeBeeperBridgeOptions): Promise<PickleBridge> {
  return createRuntimeBeeperBridge(options);
}

export async function createBeeperBridgeFromToken(options: CreateNodeBeeperBridgeFromTokenOptions): Promise<PickleBridge> {
  const store = options.matrix?.store ?? createFileMatrixStore(defaultDataDir(options));
  return createRuntimeBeeperBridgeFromToken({
    ...options,
    dataStore: options.dataStore ?? createBridgeDataStore(store),
    matrix: {
      ...options.matrix,
      store,
    },
  });
}

export async function createBeeperBridgeFromPassword(options: CreateNodeBeeperBridgeFromPasswordOptions): Promise<PickleBridge> {
  const store = options.matrix?.store ?? createFileMatrixStore(defaultDataDir(options));
  return createRuntimeBeeperBridgeFromPassword({
    ...options,
    dataStore: options.dataStore ?? createBridgeDataStore(store),
    matrix: {
      ...options.matrix,
      store,
    },
  });
}

function defaultDataDir(options: { bridge: string; dataDir?: string }): string {
  return resolve(options.dataDir ?? ".pickle-bridge", options.bridge, "matrix-state");
}

export type * from "./types";
export type * from "./beeper";
export type * from "./store";
