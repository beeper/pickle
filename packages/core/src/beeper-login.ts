import { createMatrixLogin, type MatrixLogin, type MatrixLoginOptions } from "./login";
import type { MatrixAccount } from "./types";

const DEFAULT_BEEPER_HOMESERVER = "https://matrix.beeper.com";

export interface BeeperLoginOptions extends Omit<MatrixLoginOptions, "homeserver"> {
  homeserver?: string;
}

export interface BeeperEmailTokenOptions {
  clientSecret: string;
  email: string;
  nextLink?: string;
  sendAttempt: number;
}

export interface BeeperRegisterOptions {
  auth?: Record<string, unknown>;
  inhibitLogin?: boolean;
  password?: string;
  username?: string;
}

export interface BeeperEmailTokenResult {
  raw: unknown;
  sid: string;
  submitUrl?: string;
}

export interface BeeperRegisterResult {
  account?: MatrixAccount;
  accessToken?: string;
  deviceId?: string;
  raw: unknown;
  userId?: string;
}

export interface BeeperLogin extends MatrixLogin {
  register(options: BeeperRegisterOptions): Promise<BeeperRegisterResult>;
  requestEmailToken(options: BeeperEmailTokenOptions): Promise<BeeperEmailTokenResult>;
}

export function createBeeperLogin(options: BeeperLoginOptions = {}): BeeperLogin {
  const homeserver = options.homeserver ?? DEFAULT_BEEPER_HOMESERVER;
  const fetchImpl = options.fetch ?? fetch;
  const login = createMatrixLogin({
    ...options,
    homeserver,
    metadata: { ...options.metadata, beeper: true },
  });
  return {
    ...login,
    register: (registerOptions) => register(fetchImpl, homeserver, registerOptions),
    requestEmailToken: (tokenOptions) => requestEmailToken(fetchImpl, homeserver, tokenOptions),
  };
}

async function requestEmailToken(
  fetchImpl: typeof fetch,
  homeserver: string,
  options: BeeperEmailTokenOptions
): Promise<BeeperEmailTokenResult> {
  const body: Record<string, unknown> = {
    client_secret: options.clientSecret,
    email: options.email,
    send_attempt: options.sendAttempt,
  };
  if (options.nextLink !== undefined) {
    body.next_link = options.nextLink;
  }
  const raw = await matrixRequest(fetchImpl, homeserver, "/_matrix/client/v3/register/email/requestToken", body);
  const result: BeeperEmailTokenResult = {
    raw,
    sid: readRequiredString(raw, "sid"),
  };
  const submitUrl = readOptionalString(raw, "submit_url");
  if (submitUrl !== undefined) {
    result.submitUrl = submitUrl;
  }
  return result;
}

async function register(
  fetchImpl: typeof fetch,
  homeserver: string,
  options: BeeperRegisterOptions
): Promise<BeeperRegisterResult> {
  const body: Record<string, unknown> = {};
  if (options.auth !== undefined) body.auth = options.auth;
  if (options.inhibitLogin !== undefined) body.inhibit_login = options.inhibitLogin;
  if (options.password !== undefined) body.password = options.password;
  if (options.username !== undefined) body.username = options.username;
  const raw = await matrixRequest(fetchImpl, homeserver, "/_matrix/client/v3/register", body);
  const accessToken = readOptionalString(raw, "access_token");
  const deviceId = readOptionalString(raw, "device_id");
  const userId = readOptionalString(raw, "user_id");
  const result: BeeperRegisterResult = { raw };
  if (accessToken !== undefined) result.accessToken = accessToken;
  if (deviceId !== undefined) result.deviceId = deviceId;
  if (userId !== undefined) result.userId = userId;
  if (accessToken && deviceId && userId) {
    result.account = {
      accessToken,
      deviceId,
      homeserver,
      metadata: { beeper: true },
      userId,
    };
  }
  return result;
}

async function matrixRequest(
  fetchImpl: typeof fetch,
  homeserver: string,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetchImpl(new URL(path, homeserver), {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Beeper request failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function readRequiredString(value: unknown, key: string): string {
  const result = readOptionalString(value, key);
  if (!result) {
    throw new Error(`Beeper response is missing ${key}`);
  }
  return result;
}

function readOptionalString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}
