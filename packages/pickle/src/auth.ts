import type { MatrixAccount, MatrixWhoami } from "./types";

export interface MatrixAuthenticatedAccount extends MatrixAccount {
  whoami: MatrixWhoami;
}

export interface MatrixAuthOptions {
  fetch?: typeof fetch;
  homeserver: string;
  initialDeviceDisplayName?: string;
  metadata?: Record<string, unknown>;
}

export interface MatrixPasswordAuthOptions extends MatrixAuthOptions {
  password: string;
  username: string;
}

export interface MatrixTokenAuthOptions extends MatrixAuthOptions {
  token: string;
  type?: "m.login.token" | "org.matrix.login.jwt";
}

export async function loginWithMatrixPassword(options: MatrixPasswordAuthOptions): Promise<MatrixAuthenticatedAccount> {
  return loginWithMatrix(options, {
    identifier: {
      type: "m.id.user",
      user: options.username,
    },
    password: options.password,
    type: "m.login.password",
  });
}

export async function loginWithMatrixToken(options: MatrixTokenAuthOptions): Promise<MatrixAuthenticatedAccount> {
  return loginWithMatrix(options, {
    token: options.token,
    type: options.type ?? "m.login.token",
  });
}

async function loginWithMatrix(
  options: MatrixAuthOptions,
  body: Record<string, unknown>
): Promise<MatrixAuthenticatedAccount> {
  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(new URL("/_matrix/client/v3/login", options.homeserver), {
    body: JSON.stringify({
      ...body,
      initial_device_display_name: options.initialDeviceDisplayName ?? "Matrix",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Matrix login failed: ${response.status} ${await response.text()}`);
  }
  const raw = await response.json();
  const account: MatrixAccount = {
    accessToken: readRequiredString(raw, "access_token", "Matrix login"),
    deviceId: readRequiredString(raw, "device_id", "Matrix login"),
    homeserver: options.homeserver,
    userId: readRequiredString(raw, "user_id", "Matrix login"),
  };
  if (options.metadata !== undefined) {
    account.metadata = { ...options.metadata };
  }
  return {
    ...account,
    whoami: await getMatrixWhoami(fetchImpl, account),
  };
}

export async function getMatrixWhoami(fetchImpl: typeof fetch, account: MatrixAccount): Promise<MatrixWhoami> {
  const response = await fetchImpl(new URL("/_matrix/client/v3/account/whoami", account.homeserver), {
    headers: { authorization: `Bearer ${account.accessToken}` },
    method: "GET",
  });
  if (!response.ok) {
    throw new Error(`Matrix whoami failed: ${response.status} ${await response.text()}`);
  }
  const raw = await response.json();
  return {
    deviceId: readRequiredString(raw, "device_id", "Matrix whoami"),
    userId: readRequiredString(raw, "user_id", "Matrix whoami"),
  };
}

function readRequiredString(value: unknown, key: string, label: string): string {
  if (!value || typeof value !== "object") {
    throw new Error(`${label} response is missing ${key}`);
  }
  const field = (value as Record<string, unknown>)[key];
  if (typeof field !== "string" || field.length === 0) {
    throw new Error(`${label} response is missing ${key}`);
  }
  return field;
}
