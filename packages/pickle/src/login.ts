import type { MatrixSession } from "./types";

export interface MatrixLoginOptions {
  fetch?: typeof fetch;
  homeserver: string;
  initialDeviceDisplayName?: string;
  metadata?: Record<string, unknown>;
}

export interface MatrixPasswordLoginOptions {
  password: string;
  username: string;
}

export interface MatrixTokenLoginOptions {
  token: string;
  type?: "m.login.token" | "org.matrix.login.jwt";
}

export interface MatrixLogin {
  password(options: MatrixPasswordLoginOptions): Promise<MatrixSession>;
  token(options: MatrixTokenLoginOptions): Promise<MatrixSession>;
}

export function createMatrixLogin(options: MatrixLoginOptions): MatrixLogin {
  const fetchImpl = options.fetch ?? fetch;
  return {
    password: (login) =>
      matrixLoginRequest(fetchImpl, options.homeserver, options.metadata, {
        identifier: {
          type: "m.id.user",
          user: login.username,
        },
        initial_device_display_name: options.initialDeviceDisplayName ?? "Matrix",
        password: login.password,
        type: "m.login.password",
      }),
    token: (login) =>
      matrixLoginRequest(fetchImpl, options.homeserver, options.metadata, {
        initial_device_display_name: options.initialDeviceDisplayName ?? "Matrix",
        token: login.token,
        type: login.type ?? "m.login.token",
      }),
  };
}

async function matrixLoginRequest(
  fetchImpl: typeof fetch,
  homeserver: string,
  metadata: Record<string, unknown> | undefined,
  body: Record<string, unknown>
): Promise<MatrixSession> {
  const response = await fetchImpl(new URL("/_matrix/client/v3/login", homeserver), {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Matrix login failed: ${response.status} ${await response.text()}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    device_id: string;
    user_id: string;
  };

  const session: MatrixSession = {
    accessToken: data.access_token,
    deviceId: data.device_id,
    homeserver,
    userId: data.user_id,
  };
  if (metadata !== undefined) {
    session.metadata = { ...metadata };
  }
  return session;
}
