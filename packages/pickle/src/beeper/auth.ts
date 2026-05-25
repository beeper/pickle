import { loginWithMatrixToken, type MatrixAuthenticatedAccount } from "../auth";

export type BeeperEnvironment = "production" | "staging" | "dev" | "local";

export interface BeeperAuthOptions {
  email: string;
  env?: BeeperEnvironment;
  fetch?: typeof fetch;
  getLoginCode?: () => Promise<string> | string;
  initialDeviceDisplayName?: string;
  metadata?: Record<string, unknown>;
  onlyExistingAccounts?: boolean;
}

export interface BeeperAuthStartResult {
  expires?: string;
  raw: unknown;
  requestId: string;
  type: string[];
}

export interface BeeperAuthCodeResult {
  loginToken: string;
  raw: unknown;
}

const BEEPER_ENVIRONMENTS: Record<BeeperEnvironment, string> = {
  dev: "beeper-dev.com",
  local: "beeper.localtest.me",
  production: "beeper.com",
  staging: "beeper-staging.com",
};

const LOGIN_AUTH = "BEEPER-PRIVATE-API-PLEASE-DONT-USE";

export async function createBeeperLogin(options: BeeperAuthOptions): Promise<MatrixAuthenticatedAccount> {
  const fetchImpl = options.fetch ?? fetch;
  const domain = BEEPER_ENVIRONMENTS[options.env ?? "production"];
  const start = await startBeeperLogin(fetchImpl, domain);
  const onlyExistingAccounts = options.onlyExistingAccounts ?? true;
  await sendBeeperLoginEmail(fetchImpl, domain, start.requestId, options.email, { onlyExistingAccounts });
  const code = await getLoginCode(options);
  const token = await sendBeeperLoginCode(fetchImpl, domain, start.requestId, code, { onlyExistingAccounts });
  return loginWithMatrixToken({
    fetch: fetchImpl,
    homeserver: `https://matrix.${domain}`,
    initialDeviceDisplayName: options.initialDeviceDisplayName ?? "Pickle",
    metadata: { ...options.metadata, beeper: true },
    token: token.loginToken,
    type: "org.matrix.login.jwt",
  });
}

async function getLoginCode(options: BeeperAuthOptions): Promise<string> {
  const code = options.getLoginCode ? await options.getLoginCode() : promptForLoginCode();
  if (!code) {
    throw new Error("Missing Beeper login code");
  }
  return code;
}

function promptForLoginCode(): string {
  if (typeof globalThis.prompt === "function") {
    return globalThis.prompt("Enter Beeper login code") ?? "";
  }
  throw new Error("Beeper login requires getLoginCode in runtimes without prompt()");
}

export async function startBeeperLogin(fetchImpl: typeof fetch, domain: string): Promise<BeeperAuthStartResult> {
  const raw = await beeperRequest(fetchImpl, domain, "/user/login", {});
  const result: BeeperAuthStartResult = {
    raw,
    requestId: readRequiredString(raw, "request"),
    type: readStringArray(raw, "type"),
  };
  const expires = readOptionalString(raw, "expires");
  if (expires !== undefined) {
    result.expires = expires;
  }
  return result;
}

export async function sendBeeperLoginEmail(
  fetchImpl: typeof fetch,
  domain: string,
  requestId: string,
  email: string,
  options: { onlyExistingAccounts?: boolean } = {}
): Promise<void> {
  await beeperRequest(fetchImpl, domain, "/user/login/email", {
    appType: "pickle",
    email,
    onlyExistingAccounts: options.onlyExistingAccounts ?? true,
    request: requestId,
  });
}

export async function sendBeeperLoginCode(
  fetchImpl: typeof fetch,
  domain: string,
  requestId: string,
  code: string,
  options: { onlyExistingAccounts?: boolean } = {}
): Promise<BeeperAuthCodeResult> {
  const raw = await beeperRequest(fetchImpl, domain, "/user/login/response", {
    appType: "pickle",
    onlyExistingAccounts: options.onlyExistingAccounts ?? true,
    request: requestId,
    response: code,
  });
  return {
    loginToken: readRequiredString(raw, "token"),
    raw,
  };
}

async function beeperRequest(
  fetchImpl: typeof fetch,
  domain: string,
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetchImpl(new URL(path, `https://api.${domain}`), {
    body: JSON.stringify(body),
    headers: {
      authorization: `Bearer ${LOGIN_AUTH}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Beeper auth failed: ${response.status} ${await response.text()}`);
  }
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Beeper auth returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readRequiredString(value: unknown, key: string): string {
  const result = readOptionalString(value, key);
  if (!result) {
    throw new Error(`Beeper auth response is missing ${key}`);
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

function readStringArray(value: unknown, key: string): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }
  const field = (value as Record<string, unknown>)[key];
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === "string") : [];
}
