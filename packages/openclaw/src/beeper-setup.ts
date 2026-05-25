import type { MatrixAppserviceInitOptions } from "@beeper/pickle";
import { createBeeperLogin, type BeeperAuthOptions, type BeeperEnvironment } from "@beeper/pickle/beeper/auth";
import { createBeeperAppServiceInit, type CreateAppServiceOptions } from "@beeper/pickle-bridge";
import { DEFAULT_REGISTRATION_URL } from "./config";
import { DEFAULT_BEEPER_BRIDGE_TYPE, openClawBeeperBridgeId } from "./ids";
import { resolveOpenClawDeviceId } from "./openclaw-identity";
import type { OpenClawBridgeConfig } from "./types";

export { DEFAULT_BEEPER_BRIDGE_TYPE, openClawBeeperBridgeId };

export interface BeeperSetupAccount {
  accessToken: string;
  deviceId: string;
  homeserver: string;
  userId: string;
}

export interface BeeperLoginForOpenClawOptions {
  email: string;
  env?: BeeperEnvironment;
  fetch?: typeof fetch;
  getLoginCode?: () => Promise<string> | string;
  initialDeviceDisplayName?: string;
  login?: (options: BeeperAuthOptions) => Promise<BeeperSetupAccount>;
  metadata?: Record<string, unknown>;
  openClawDeviceId?: string;
}

export interface BeeperLoginForOpenClawResult {
  account: BeeperSetupAccount;
  config: Pick<OpenClawBridgeConfig, "accessToken" | "homeserver" | "matrixDeviceId" | "matrixUserId">;
}

export interface CreateOpenClawBeeperAppServiceOptions {
  accessToken: string;
  address?: string;
  baseDomain?: string;
  bridge?: string;
  bridgeManagerToken?: string;
  bridgeType?: string;
  createAppServiceInit?: (options: CreateOpenClawBeeperAppServiceRequest) => Promise<MatrixAppserviceInitOptions>;
  fetch?: typeof fetch;
  getOnly?: boolean;
  homeserver?: string;
  homeserverDomain?: string;
  matrixDeviceId?: string;
  postState?: boolean;
  push?: boolean;
  selfHosted?: boolean;
  username?: string;
}

export type CreateOpenClawBeeperAppServiceRequest = CreateAppServiceOptions & {
  baseDomain?: string;
  fetch?: typeof fetch;
  hungryToken?: string;
  token: string;
  username?: string;
};

export interface CreateOpenClawBeeperAppServiceResult {
  config: Pick<OpenClawBridgeConfig, "appserviceId" | "asToken" | "bridgeId" | "ghostLocalpartPrefix" | "homeserver" | "homeserverDomain" | "hsToken" | "registrationUrl" | "senderLocalpart" | "serviceBotLocalpart" | "userLocalpartPrefix">;
  init: MatrixAppserviceInitOptions;
}

export interface SetupOpenClawBeeperBridgeOptions extends BeeperLoginForOpenClawOptions {
  address?: string;
  baseDomain?: string;
  bridge?: string;
  bridgeManagerToken?: string;
  bridgeType?: string;
  createAppServiceInit?: CreateOpenClawBeeperAppServiceOptions["createAppServiceInit"];
  getOnly?: boolean;
  homeserverDomain?: string;
  openClawDeviceId?: string;
  postState?: boolean;
  push?: boolean;
  selfHosted?: boolean;
  username?: string;
}

export interface SetupOpenClawBeeperBridgeResult {
  account: BeeperSetupAccount;
  config: Pick<OpenClawBridgeConfig, "accessToken" | "appserviceId" | "asToken" | "bridgeId" | "ghostLocalpartPrefix" | "homeserver" | "homeserverDomain" | "hsToken" | "matrixDeviceId" | "matrixUserId" | "registrationUrl" | "senderLocalpart" | "serviceBotLocalpart" | "userLocalpartPrefix">;
  init: MatrixAppserviceInitOptions;
}

export async function loginToBeeperForOpenClaw(options: BeeperLoginForOpenClawOptions): Promise<BeeperLoginForOpenClawResult> {
  const login = options.login ?? createBeeperLogin;
  const openClawDeviceId = options.openClawDeviceId ?? await resolveOpenClawDeviceId();
  const bridgeId = openClawBeeperBridgeId(openClawDeviceId);
  const request: BeeperAuthOptions = {
    email: options.email,
    initialDeviceDisplayName: options.initialDeviceDisplayName ?? "Pickle OpenClaw",
    metadata: { ...options.metadata, bridge: bridgeId, bridgeType: DEFAULT_BEEPER_BRIDGE_TYPE, openClawDeviceId },
  };
  if (options.env !== undefined) request.env = options.env;
  if (options.fetch !== undefined) request.fetch = options.fetch;
  if (options.getLoginCode !== undefined) request.getLoginCode = options.getLoginCode;
  const account = await login(request);
  return {
    account,
    config: {
      accessToken: account.accessToken,
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
    address: options.address ?? DEFAULT_REGISTRATION_URL,
    bridge,
    bridgeType: options.bridgeType ?? DEFAULT_BEEPER_BRIDGE_TYPE,
    selfHosted: options.selfHosted ?? true,
    token: options.accessToken,
  };
  if (options.baseDomain !== undefined) request.baseDomain = options.baseDomain;
  if (options.bridgeManagerToken !== undefined) request.hungryToken = options.bridgeManagerToken;
  if (options.fetch !== undefined) request.fetch = options.fetch;
  if (options.getOnly !== undefined) request.getOnly = options.getOnly;
  if (options.homeserver !== undefined) request.homeserver = options.homeserver;
  if (options.homeserverDomain !== undefined) request.homeserverDomain = options.homeserverDomain;
  if (options.postState !== undefined) request.postState = options.postState;
  if (options.push !== undefined) request.push = options.push;
  if (options.username !== undefined) request.username = options.username;
  const init = await createInit(request);
  const config: CreateOpenClawBeeperAppServiceResult["config"] = {
      appserviceId: init.registration.id,
      asToken: init.registration.asToken,
      bridgeId: bridge,
      ghostLocalpartPrefix: `${bridge}_agent_`,
      homeserver: init.homeserver,
      hsToken: init.registration.hsToken,
      registrationUrl: options.address ?? init.registration.url ?? DEFAULT_REGISTRATION_URL,
      senderLocalpart: init.registration.senderLocalpart,
      serviceBotLocalpart: init.registration.senderLocalpart,
      userLocalpartPrefix: `${bridge}_user_`,
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
  const openClawDeviceId = options.openClawDeviceId ?? await resolveOpenClawDeviceId();
  const login = await loginToBeeperForOpenClaw({ ...options, openClawDeviceId });
  const bridgeId = openClawBeeperBridgeId(openClawDeviceId);
  const appserviceOptions: CreateOpenClawBeeperAppServiceOptions = {
    accessToken: login.account.accessToken,
    bridge: bridgeId,
  };
  const baseDomain = options.baseDomain ?? beeperBaseDomain(options.env);
  if (options.address !== undefined) appserviceOptions.address = options.address;
  if (baseDomain !== undefined) appserviceOptions.baseDomain = baseDomain;
  if (options.bridgeManagerToken !== undefined) appserviceOptions.bridgeManagerToken = options.bridgeManagerToken;
  if (options.bridgeType !== undefined) appserviceOptions.bridgeType = options.bridgeType;
  if (options.createAppServiceInit !== undefined) appserviceOptions.createAppServiceInit = options.createAppServiceInit;
  if (options.fetch !== undefined) appserviceOptions.fetch = options.fetch;
  if (options.getOnly !== undefined) appserviceOptions.getOnly = options.getOnly;
  if (options.homeserverDomain !== undefined) appserviceOptions.homeserverDomain = options.homeserverDomain;
  if (options.postState !== undefined) appserviceOptions.postState = options.postState;
  if (options.push !== undefined) appserviceOptions.push = options.push;
  if (options.selfHosted !== undefined) appserviceOptions.selfHosted = options.selfHosted;
  if (options.username !== undefined) appserviceOptions.username = options.username;
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
