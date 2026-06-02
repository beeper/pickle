import { createMatrixClient } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import { resolve } from "node:path";
import { createBeeperAppServiceInit } from "./beeper";
import { RuntimeBridge } from "./bridge";
import { createBridgeDataStore, getOrCreateAppserviceDeviceId } from "./store";
import type { CreateNodeBeeperBridgeOptions, CreateNodeBridgeOptions, PickleBridge } from "./types";

export type { CreateNodeBeeperBridgeOptions, CreateNodeBridgeOptions, PickleBridge };

export function createBridge(options: CreateNodeBridgeOptions): PickleBridge {
  return new RuntimeBridge(options, createMatrixClient(options.matrix));
}

export async function createBeeperBridge(options: CreateNodeBeeperBridgeOptions): Promise<PickleBridge> {
  const store = options.store ?? options.matrix?.store ?? createFileMatrixStore(defaultDataDir(options));
  const appservice = options.matrix?.appservice ?? await createBeeperAppServiceInit({
    bridge: options.bridge,
    token: requiredAccount(options).accessToken,
    ...(options.address ? { address: options.address } : {}),
    ...(options.baseDomain ? { baseDomain: options.baseDomain } : {}),
    ...(options.bridgeType ? { bridgeType: options.bridgeType } : {}),
    ...(options.getOnly !== undefined ? { getOnly: options.getOnly } : {}),
    ...(options.bridgeManagerToken ? { hungryToken: options.bridgeManagerToken } : {}),
    ...(options.homeserverDomain ? { homeserverDomain: options.homeserverDomain } : {}),
    ...(options.bridgeManagerPostState !== undefined ? { postState: options.bridgeManagerPostState } : {}),
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
      ...(options.account?.userId ?? options.ownerUserId ? { ownerUserId: options.account?.userId ?? options.ownerUserId } : {}),
      ...(options.bridgeType ? { bridgeType: options.bridgeType } : {}),
    },
    connector: options.connector,
    dataStore: options.dataStore ?? createBridgeDataStore(store),
    ...(options.log ? { log: options.log } : {}),
    matrix,
  }, createMatrixClient(matrix));
}

function requiredAccount(options: CreateNodeBeeperBridgeOptions) {
  if (!options.account) throw new Error("createBeeperBridge requires account unless matrix.appservice is provided");
  return options.account;
}

function defaultDataDir(options: { bridge: string; dataDir?: string }): string {
  return resolve(options.dataDir ?? ".pickle-bridge", options.bridge, "matrix-state");
}
