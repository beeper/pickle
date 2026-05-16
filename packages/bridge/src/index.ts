import { createMatrixClient } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import { resolve } from "node:path";
import { createBeeperAppServiceInit } from "./beeper";
import { RuntimeBridge } from "./bridge";
import { createBridgeDataStore, getOrCreateAppserviceDeviceId } from "./store";
import type { CreateNodeBeeperBridgeOptions, CreateNodeBridgeOptions, PickleBridge } from "./types";

export { createBridgeDataStore, MatrixBridgeDataStore } from "./store";
export { BeeperBridgeManagerClient, createBeeperAppService, createBeeperAppServiceInit, createBeeperBridgeManagerClient, fetchBeeperBridges } from "./beeper";
export { createRemoteMessage } from "./events";
export type * from "./beeper";
export type * from "./store";
export type * from "./types";
export { RuntimeBridge } from "./bridge";

export function createBridge(options: CreateNodeBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateNodeBeeperBridgeOptions): Promise<PickleBridge> {
  const store = options.store ?? options.matrix?.store ?? createFileMatrixStore(defaultDataDir(options));
  const appservice = options.matrix?.appservice ?? await createBeeperAppServiceInit({
    bridge: options.bridge,
    token: options.account.accessToken,
    ...(options.address ? { address: options.address } : {}),
    ...(options.baseDomain ? { baseDomain: options.baseDomain } : {}),
    ...(options.bridgeType ? { bridgeType: options.bridgeType } : {}),
    ...(options.getOnly !== undefined ? { getOnly: options.getOnly } : {}),
    ...(options.homeserverDomain ? { homeserverDomain: options.homeserverDomain } : {}),
  });
  const matrix = {
    ...options.matrix,
    appservice,
    beeper: true,
    deviceId: options.matrix?.deviceId ?? await getOrCreateAppserviceDeviceId(store, options.bridge),
    homeserver: options.matrix?.homeserver ?? appservice.homeserver,
    store,
    token: options.matrix?.token ?? appservice.registration.asToken,
  };
  return new RuntimeBridge({
    appservice,
    beeper: {
      bridge: options.bridge,
      ownerUserId: options.account.userId,
      ...(options.bridgeType ? { bridgeType: options.bridgeType } : {}),
    },
    connector: options.connector,
    dataStore: options.dataStore ?? createBridgeDataStore(store),
    ...(options.log ? { log: options.log } : {}),
    matrix,
  }, createMatrixClient({
    ...matrix,
  }));
}

function defaultDataDir(options: { bridge: string; dataDir?: string }): string {
  return resolve(options.dataDir ?? ".pickle-bridge", options.bridge, "matrix-state");
}
