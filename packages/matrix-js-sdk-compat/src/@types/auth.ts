export interface LoginRequest {
  device_id?: string;
  identifier?: { type: string; user: string };
  initial_device_display_name?: string;
  password?: string;
  token?: string;
  type: "m.login.password" | "m.login.token" | "org.matrix.login.jwt" | string;
  user?: string;
}

export interface LoginResponse {
  access_token: string;
  device_id: string;
  home_server?: string;
  user_id: string;
  well_known?: unknown;
}
