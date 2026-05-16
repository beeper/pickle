import type { MatrixAppserviceInitOptions, MatrixAppserviceNamespace, MatrixAppserviceRegistration } from "@beeper/pickle";

export interface BeeperClientOptions {
  baseDomain?: string;
  fetch?: typeof fetch;
  token: string;
  username?: string;
}

export interface BeeperBridgeState {
  bridge: string;
  bridgeType?: string;
  createdAt?: string;
  info?: Record<string, unknown>;
  isSelfHosted?: boolean;
  reason?: string;
  source?: string;
  stateEvent?: string;
  username?: string;
}

export interface BeeperWhoamiBridge {
  bridgeState?: BeeperBridgeState;
  configHash?: string;
  otherVersions?: Array<{ name: string; version: string }>;
  remoteState?: Record<string, unknown>;
  version?: string;
}

export interface BeeperWhoamiResponse {
  user: {
    asmuxData?: { login_token?: string };
    bridges: Record<string, BeeperWhoamiBridge>;
    hungryserv?: BeeperWhoamiBridge;
  };
  userInfo: {
    bridgeClusterId?: string;
    email?: string;
    fullName?: string;
    hungryUrl?: string;
    hungryUrlDirect?: string;
    username: string;
    [key: string]: unknown;
  };
}

export interface RegisterAppServiceOptions {
  address?: string;
  bridge: string;
  bridgeType?: string;
  getOnly?: boolean;
  postState?: boolean;
  push?: boolean;
  selfHosted?: boolean;
}

export interface CreateAppServiceOptions extends RegisterAppServiceOptions {
  homeserver?: string;
  homeserverDomain?: string;
}

export interface RegisteredAppService {
  homeserver: string;
  homeserverDomain: string;
  registration: MatrixAppserviceRegistration;
  whoami: BeeperWhoamiResponse;
}

export class BeeperBridgeManagerClient {
  #baseDomain: string;
  #fetch: typeof fetch;
  #token: string;
  #username: string | undefined;
  #whoami: BeeperWhoamiResponse | undefined;

  constructor(options: BeeperClientOptions) {
    this.#baseDomain = options.baseDomain ?? "beeper.com";
    this.#fetch = options.fetch ?? fetch;
    this.#token = options.token;
    this.#username = options.username;
  }

  async whoami(): Promise<BeeperWhoamiResponse> {
    if (this.#whoami) return this.#whoami;
    const response = await this.#request<BeeperWhoamiResponse>("api", "GET", "/whoami");
    this.#whoami = response;
    this.#username ??= response.userInfo.username;
    return response;
  }

  async listBridges(): Promise<Record<string, BeeperWhoamiBridge>> {
    return (await this.whoami()).user.bridges;
  }

  async getBridge(bridge: string): Promise<BeeperWhoamiBridge | null> {
    return (await this.listBridges())[bridge] ?? null;
  }

  async getAppService(bridge: string): Promise<MatrixAppserviceRegistration> {
    return normalizeRegistration(await this.#hungryRequest("GET", bridge));
  }

  async registerAppService(options: RegisterAppServiceOptions): Promise<MatrixAppserviceRegistration> {
    if (options.getOnly) return this.getAppService(options.bridge);
    const registration = normalizeRegistration(await this.#hungryRequest("PUT", options.bridge, {
      address: options.address,
      push: options.push ?? Boolean(options.address),
      receive_ephemeral: true,
      self_hosted: options.selfHosted ?? true,
    }));
    if (options.postState !== false) {
      const stateOptions: PostBridgeStateOptions = {
        asToken: registration.asToken,
        bridge: options.bridge,
        isSelfHosted: options.selfHosted ?? true,
        reason: "SELF_HOST_REGISTERED",
        stateEvent: bridgeStateEvent(options),
      };
      if (options.bridgeType !== undefined) stateOptions.bridgeType = options.bridgeType;
      await this.postBridgeState(stateOptions);
    }
    return registration;
  }

  async postBridgeState(options: PostBridgeStateOptions): Promise<void> {
    const whoami = await this.whoami();
    const username = this.#username ?? whoami.userInfo.username;
    await this.#request("api", "POST", `/bridgebox/${encodeURIComponent(username)}/bridge/${encodeURIComponent(options.bridge)}/bridge_state`, {
      bridgeType: options.bridgeType,
      info: options.info ?? {},
      isSelfHosted: options.isSelfHosted ?? true,
      reason: options.reason,
      stateEvent: options.stateEvent,
    }, undefined, options.asToken);
  }

  async createAppService(options: CreateAppServiceOptions): Promise<RegisteredAppService> {
    const whoami = await this.whoami();
    const username = this.#username ?? whoami.userInfo.username;
    const registration = await this.registerAppService(options);
    return {
      homeserver: options.homeserver ?? hungryHomeserver(this.#baseDomain, username),
      homeserverDomain: options.homeserverDomain ?? "beeper.local",
      registration,
      whoami,
    };
  }

  async createAppServiceInit(options: CreateAppServiceOptions): Promise<MatrixAppserviceInitOptions> {
    const appservice = await this.createAppService(options);
    return {
      homeserver: appservice.homeserver,
      homeserverDomain: appservice.homeserverDomain,
      registration: appservice.registration,
    };
  }

  async #hungryRequest(method: "GET" | "PUT", bridge: string, body?: unknown): Promise<unknown> {
    const whoami = await this.whoami();
    const username = this.#username ?? whoami.userInfo.username;
    const path = `/_matrix/asmux/mxauth/appservice/${encodeURIComponent(username)}/${encodeURIComponent(bridge)}`;
    return this.#request("hungry", method, path, body, username);
  }

  async #request<T>(kind: "api" | "hungry", method: "GET" | "PUT" | "POST", path: string, body?: unknown, username?: string, token?: string): Promise<T> {
    const base = kind === "api" ? `https://api.${this.#baseDomain}` : hungryHomeserver(this.#baseDomain, username ?? this.#username ?? "");
    const url = kind === "api" ? new URL(path, base) : new URL(`${base}${path}`);
    const init: RequestInit = {
      headers: {
        "authorization": `Bearer ${token ?? this.#token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      method,
    };
    if (body) init.body = JSON.stringify(body);
    const response = await this.#fetch(url, init);
    if (!response.ok) {
      let detail = response.statusText;
      try {
        const data = await response.json() as { error?: string };
        detail = data.error ?? detail;
      } catch {}
      throw new Error(`Beeper bridge manager request failed (${response.status}): ${detail}`);
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

export interface PostBridgeStateOptions {
  asToken: string;
  bridge: string;
  bridgeType?: string;
  info?: Record<string, unknown>;
  isSelfHosted?: boolean;
  reason: string;
  stateEvent: "STARTING" | "RUNNING" | "BAD_CREDENTIALS" | "UNKNOWN_ERROR" | "LOGGED_OUT" | "UNCONFIGURED";
}

export function createBeeperBridgeManagerClient(options: BeeperClientOptions): BeeperBridgeManagerClient {
  return new BeeperBridgeManagerClient(options);
}

export async function fetchBeeperBridges(options: BeeperClientOptions): Promise<Record<string, BeeperWhoamiBridge>> {
  return createBeeperBridgeManagerClient(options).listBridges();
}

export async function createBeeperAppService(options: BeeperClientOptions & CreateAppServiceOptions): Promise<RegisteredAppService> {
  const { baseDomain, fetch: fetchImpl, token, username, ...appserviceOptions } = options;
  return createBeeperBridgeManagerClient(clientOptions({ baseDomain, fetch: fetchImpl, token, username })).createAppService(appserviceOptions);
}

export async function createBeeperAppServiceInit(options: BeeperClientOptions & CreateAppServiceOptions): Promise<MatrixAppserviceInitOptions> {
  const { baseDomain, fetch: fetchImpl, token, username, ...appserviceOptions } = options;
  return createBeeperBridgeManagerClient(clientOptions({ baseDomain, fetch: fetchImpl, token, username })).createAppServiceInit(appserviceOptions);
}

function bridgeStateEvent(options: RegisterAppServiceOptions): PostBridgeStateOptions["stateEvent"] {
  const bridgeType = options.bridgeType ?? "";
  return (bridgeType && bridgeType !== "heisenbridge") || ["androidsms", "imessagecloud", "imessage"].includes(options.bridge)
    ? "STARTING"
    : "RUNNING";
}

function hungryHomeserver(baseDomain: string, username: string): string {
  return `https://matrix.${baseDomain}/_hungryserv/${encodeURIComponent(username)}`;
}

function normalizeRegistration(raw: unknown): MatrixAppserviceRegistration {
  const input = raw as Record<string, unknown>;
  const namespaces = input.namespaces as Record<string, unknown> | undefined;
  return stripUndefined({
    asToken: stringField(input, "asToken", "as_token"),
    hsToken: stringField(input, "hsToken", "hs_token"),
    id: stringField(input, "id"),
    msc3202: booleanField(input, "msc3202"),
    msc4190: booleanField(input, "msc4190"),
    namespaces: stripUndefined({
      aliases: namespaceList(namespaces?.aliases),
      rooms: namespaceList(namespaces?.rooms),
      users: namespaceList(namespaces?.users ?? namespaces?.user_ids),
    }),
    protocols: stringList(input.protocols),
    rateLimited: booleanField(input, "rateLimited", "rate_limited"),
    senderLocalpart: stringField(input, "senderLocalpart", "sender_localpart"),
    url: stringField(input, "url"),
  }) as MatrixAppserviceRegistration;
}

function stringField(input: Record<string, unknown>, camel: string, snake?: string): string {
  const value = input[camel] ?? (snake ? input[snake] : undefined);
  if (typeof value !== "string") throw new Error(`Invalid appservice registration: missing ${snake ?? camel}`);
  return value;
}

function booleanField(input: Record<string, unknown>, ...keys: string[]): boolean | undefined {
  const value = keys.map((key) => input[key]).find((candidate) => candidate != null);
  return typeof value === "boolean" ? value : undefined;
}

function namespaceList(value: unknown): MatrixAppserviceNamespace[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map((item) => {
    const ns = item as Record<string, unknown>;
    return {
      exclusive: ns.exclusive === true,
      regex: stringField(ns, "regex"),
    };
  });
}

function stringList(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function clientOptions(options: {
  baseDomain: string | undefined;
  fetch: typeof fetch | undefined;
  token: string;
  username: string | undefined;
}): BeeperClientOptions {
  const output: BeeperClientOptions = { token: options.token };
  if (options.baseDomain !== undefined) output.baseDomain = options.baseDomain;
  if (options.fetch !== undefined) output.fetch = options.fetch;
  if (options.username !== undefined) output.username = options.username;
  return output;
}
