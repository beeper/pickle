import {
  createBeeperAppServiceInit,
  createBeeperLogin,
  loginWithMatrixPassword,
  type BeeperAuthOptions,
  type BeeperEnvironment,
  type CreateAppServiceOptions,
  type MatrixAppserviceInitOptions,
  type MatrixPasswordAuthOptions,
} from "@beeper/pickle-bridge/beeper";
import { DEFAULT_REGISTRATION_URL } from "./config";
import { DEFAULT_BEEPER_BRIDGE_TYPE, openClawBeeperBridgeId } from "./ids";
import { resolveOpenClawDeviceId } from "./openclaw-identity";
import type { OpenClawBridgeConfig } from "./types";

export { DEFAULT_BEEPER_BRIDGE_TYPE, openClawBeeperBridgeId };
export type { BeeperEnvironment };

export interface BeeperSetupAccount {
  accessToken: string;
  deviceId: string;
  homeserver: string;
  userId: string;
}

export interface BeeperLoginForOpenClawOptions {
  email?: string;
  env?: BeeperEnvironment;
  fetch?: typeof fetch;
  getLoginCode?: () => Promise<string> | string;
  initialDeviceDisplayName?: string;
  login?: (options: BeeperAuthOptions) => Promise<BeeperSetupAccount>;
  metadata?: Record<string, unknown>;
  openClawDeviceId?: string;
  password?: string;
  passwordLogin?: (options: MatrixPasswordAuthOptions) => Promise<BeeperSetupAccount>;
  username?: string;
}

export interface BeeperLoginForOpenClawResult {
  account: BeeperSetupAccount;
  config: Pick<OpenClawBridgeConfig, "homeserver" | "matrixDeviceId" | "matrixUserId">;
}

export interface CreateOpenClawBeeperAppServiceOptions {
  accessToken: string;
  baseDomain?: string;
  bridge?: string;
  bridgeType?: string;
  createAppServiceInit?: (options: CreateOpenClawBeeperAppServiceRequest) => Promise<MatrixAppserviceInitOptions>;
  fetch?: typeof fetch;
  matrixDeviceId?: string;
  username?: string;
}

export type CreateOpenClawBeeperAppServiceRequest = CreateAppServiceOptions & {
  baseDomain?: string;
  fetch?: typeof fetch;
  token: string;
  username?: string;
};

export interface CreateOpenClawBeeperAppServiceResult {
  config: Pick<OpenClawBridgeConfig, "appserviceId" | "asToken" | "bridgeId" | "homeserver" | "homeserverDomain" | "hsToken">;
  init: MatrixAppserviceInitOptions;
}

export interface SetupOpenClawBeeperBridgeOptions extends BeeperLoginForOpenClawOptions {
  createAppServiceInit?: CreateOpenClawBeeperAppServiceOptions["createAppServiceInit"];
  openClawDeviceId?: string;
}

export interface SetupOpenClawBeeperBridgeResult {
  account: BeeperSetupAccount;
  config: Pick<OpenClawBridgeConfig, "appserviceId" | "asToken" | "bridgeId" | "homeserver" | "homeserverDomain" | "hsToken" | "matrixDeviceId" | "matrixUserId">;
  init: MatrixAppserviceInitOptions;
}

export async function loginToBeeperForOpenClaw(options: BeeperLoginForOpenClawOptions): Promise<BeeperLoginForOpenClawResult> {
  const env = options.env ?? "production";
  const openClawDeviceId = options.openClawDeviceId ?? await resolveOpenClawDeviceId();
  const bridgeId = openClawBeeperBridgeId(openClawDeviceId);
  const metadata = { ...options.metadata, bridge: bridgeId, bridgeType: DEFAULT_BEEPER_BRIDGE_TYPE, openClawDeviceId };
  if (options.username || options.password) {
    if (!options.username || !options.password) throw new Error("Beeper username/password login requires both username and password");
    const login = options.passwordLogin ?? loginWithMatrixPassword;
    const request: MatrixPasswordAuthOptions = {
      homeserver: beeperMatrixHomeserver(env),
      initialDeviceDisplayName: options.initialDeviceDisplayName ?? "Pickle OpenClaw",
      metadata,
      password: options.password,
      username: options.username,
    };
    if (options.fetch !== undefined) request.fetch = options.fetch;
    const account = await login(request);
    return {
      account,
      config: {
        homeserver: account.homeserver,
        matrixDeviceId: account.deviceId,
        matrixUserId: account.userId,
      },
    };
  }
  if (!options.email) throw new Error("Beeper setup requires email login or username/password login");
  const login = options.login ?? createBeeperLogin;
  const request: BeeperAuthOptions = {
    email: options.email,
    initialDeviceDisplayName: options.initialDeviceDisplayName ?? "Pickle OpenClaw",
    metadata,
    env,
  };
  if (options.fetch !== undefined) request.fetch = options.fetch;
  if (options.getLoginCode !== undefined) request.getLoginCode = options.getLoginCode;
  const account = await login(request);
  return {
    account,
    config: {
      homeserver: account.homeserver,
      matrixDeviceId: account.deviceId,
      matrixUserId: account.userId,
    },
  };
}

export async function createOpenClawBeeperAppService(
  options: CreateOpenClawBeeperAppServiceOptions
): Promise<CreateOpenClawBeeperAppServiceResult> {
  const createInit = options.createAppServiceInit ?? createBeeperAppServiceInit;
  const bridge = options.bridge ?? (options.matrixDeviceId ? openClawBeeperBridgeId(options.matrixDeviceId) : undefined);
  if (!bridge) throw new Error("OpenClaw Beeper appservice registration requires a bridge id or device id");
  const request: CreateOpenClawBeeperAppServiceRequest = {
    bridge,
    bridgeType: options.bridgeType ?? DEFAULT_BEEPER_BRIDGE_TYPE,
    selfHosted: true,
    token: options.accessToken,
  };
  request.address = DEFAULT_REGISTRATION_URL;
  if (options.baseDomain !== undefined) request.baseDomain = options.baseDomain;
  if (options.fetch !== undefined) request.fetch = options.fetch;
  request.postState = true;
  if (options.username !== undefined) request.username = options.username;
  const init = await createInit(request);
  const config: CreateOpenClawBeeperAppServiceResult["config"] = {
      appserviceId: init.registration.id,
      asToken: init.registration.asToken,
      bridgeId: bridge,
      homeserver: init.homeserver,
      hsToken: init.registration.hsToken,
  };
  if (init.homeserverDomain !== undefined) config.homeserverDomain = init.homeserverDomain;
  return {
    config,
    init,
  };
}

export async function setupOpenClawBeeperBridge(
  options: SetupOpenClawBeeperBridgeOptions
): Promise<SetupOpenClawBeeperBridgeResult> {
  const env = options.env ?? "production";
  const openClawDeviceId = options.openClawDeviceId ?? await resolveOpenClawDeviceId();
  const login = await loginToBeeperForOpenClaw({ ...options, env, openClawDeviceId });
  const bridgeId = openClawBeeperBridgeId(openClawDeviceId);
  const appserviceOptions: CreateOpenClawBeeperAppServiceOptions = {
    accessToken: login.account.accessToken,
    bridge: bridgeId,
  };
  const baseDomain = beeperBaseDomain(env);
  if (baseDomain !== undefined) appserviceOptions.baseDomain = baseDomain;
  if (options.createAppServiceInit !== undefined) appserviceOptions.createAppServiceInit = options.createAppServiceInit;
  if (options.fetch !== undefined) appserviceOptions.fetch = options.fetch;
  const appservice = await createOpenClawBeeperAppService(appserviceOptions);
  return {
    account: login.account,
    config: {
      ...login.config,
      ...appservice.config,
    },
    init: appservice.init,
  };
}

export function beeperBaseDomain(env: BeeperEnvironment | undefined): string | undefined {
  if (env === undefined || env === "production") return undefined;
  if (env === "dev") return "beeper-dev.com";
  if (env === "local") return "beeper.localtest.me";
  return "beeper-staging.com";
}

export function beeperMatrixHomeserver(env: BeeperEnvironment | undefined): string {
  return `https://matrix.${beeperBaseDomain(env) ?? "beeper.com"}`;
}
