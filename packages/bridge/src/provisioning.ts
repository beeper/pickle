import type { HTTPProxyRequest, HTTPProxyResponse } from "./appservice-websocket";
import type {
  BridgeRequestContext,
  LoginProcess,
  LoginProcessCookies,
  LoginProcessDisplayAndWait,
  LoginProcessUserInput,
  LoginStep,
  LoginUserInput,
  LoginCookieInput,
  NetworkGeneralCapabilities,
  ResolveIdentifierResponse,
  UserLogin,
} from "./types";

export interface ProvisioningRuntime {
  capabilities(): NetworkGeneralCapabilities;
  createLogin(flowId: string): Promise<LoginProcess>;
  listLogins(): UserLogin[];
  loginFlows(): unknown[];
  loadLogin(login: UserLogin): Promise<void>;
  requestContext(): BridgeRequestContext;
  resolveIdentifier(login: UserLogin, identifier: string, createDM: boolean): Promise<ResolveIdentifierResponse>;
}

export interface ProvisioningState {
  logins: Map<string, { nextStep: LoginStep; process: LoginProcess }>;
}

export async function handleProvisioningHTTPProxy(runtime: ProvisioningRuntime, state: ProvisioningState, request: HTTPProxyRequest): Promise<HTTPProxyResponse | null> {
  const method = request.method ?? "GET";
  const path = request.path ?? "";

  if (method === "GET" && path === "/_matrix/provision/v3/capabilities") {
    return jsonHTTPResponse(200, capabilitiesResponse(runtime.capabilities()));
  }
  if (method === "GET" && path === "/_matrix/provision/v3/login/flows") {
    return jsonHTTPResponse(200, { flows: runtime.loginFlows() });
  }
  if (method === "GET" && path === "/_matrix/provision/v3/logins") {
    return jsonHTTPResponse(200, { login_ids: runtime.listLogins().map((login) => login.id) });
  }

  const createDM = match(path, /^\/_matrix\/provision\/v3\/create_dm\/([^/]+)$/);
  if (method === "POST" && createDM) {
    const [identifier] = createDM;
    if (!identifier) return null;
    const login = provisioningLogin(runtime, request);
    if (!login) return jsonHTTPResponse(404, matrixError("M_NOT_FOUND", "Login not found"));
    return jsonHTTPResponse(200, resolvedIdentifierResponse(await runtime.resolveIdentifier(login, identifier, true)));
  }

  const resolveIdentifier = match(path, /^\/_matrix\/provision\/v3\/resolve_identifier\/([^/]+)$/);
  if (method === "GET" && resolveIdentifier) {
    const [identifier] = resolveIdentifier;
    if (!identifier) return null;
    const login = provisioningLogin(runtime, request);
    if (!login) return jsonHTTPResponse(404, matrixError("M_NOT_FOUND", "Login not found"));
    return jsonHTTPResponse(200, resolvedIdentifierResponse(await runtime.resolveIdentifier(login, identifier, false)));
  }

  const start = match(path, /^\/_matrix\/provision\/v3\/login\/start\/([^/]+)$/);
  if (method === "POST" && start) {
    const [flowId] = start;
    if (!flowId) return null;
    const process = await runtime.createLogin(flowId);
    const step = await process.start();
    const loginId = randomID("login");
    state.logins.set(loginId, { nextStep: step, process });
    return jsonHTTPResponse(200, loginStepResponse(loginId, step));
  }

  const step = match(path, /^\/_matrix\/provision\/v3\/login\/step\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (method === "POST" && step) {
    const [loginId, stepId, stepType] = step;
    if (!loginId || !stepId || !stepType) return null;
    return submitLoginStep(runtime, state, request, loginId, stepId, stepType);
  }

  return null;
}

function provisioningLogin(runtime: ProvisioningRuntime, request: HTTPProxyRequest): UserLogin | null {
  const logins = runtime.listLogins();
  const loginId = queryParam(request.query, "login_id");
  if (loginId) {
    const matching = logins.find((login) => login.id === loginId);
    if (matching) return matching;
  }
  return logins[0] ?? null;
}

async function submitLoginStep(runtime: ProvisioningRuntime, state: ProvisioningState, request: HTTPProxyRequest, loginId: string, stepId: string, stepType: string): Promise<HTTPProxyResponse> {
  const login = state.logins.get(loginId);
  if (!login) return jsonHTTPResponse(404, matrixError("M_NOT_FOUND", "Login not found"));
  if (login.nextStep.stepId !== stepId) return jsonHTTPResponse(400, matrixError("M_BAD_STATE", "Step ID does not match"));
  if (login.nextStep.type !== stepType) return jsonHTTPResponse(400, matrixError("M_BAD_STATE", "Step type does not match"));

  let nextStep: LoginStep;
  if (stepType === "user_input" && hasMethod(login.process, "submitUserInput")) {
    nextStep = await (login.process as LoginProcessUserInput).submitUserInput(runtime.requestContext(), stringMap(request.body));
  } else if (stepType === "cookies" && hasMethod(login.process, "submitCookies")) {
    nextStep = await (login.process as LoginProcessCookies).submitCookies(runtime.requestContext(), stringMap(request.body));
  } else if (stepType === "display_and_wait" && hasMethod(login.process, "wait")) {
    nextStep = await (login.process as LoginProcessDisplayAndWait).wait(runtime.requestContext());
  } else {
    return jsonHTTPResponse(400, matrixError("M_BAD_REQUEST", `Unsupported login step type ${stepType}`));
  }

  if (nextStep.type === "complete") {
    state.logins.delete(loginId);
    if (nextStep.complete?.userLogin) await runtime.loadLogin(nextStep.complete.userLogin);
    else if (nextStep.complete?.userLoginId) await runtime.loadLogin({ id: nextStep.complete.userLoginId });
  } else {
    login.nextStep = nextStep;
  }

  return jsonHTTPResponse(200, loginStepResponse(loginId, nextStep));
}

export function jsonHTTPResponse(status: number, body: unknown): HTTPProxyResponse {
  return {
    body,
    headers: { "content-type": ["application/json"] },
    status,
  };
}

function capabilitiesResponse(capabilities: NetworkGeneralCapabilities): unknown {
  return {
    group_creation: capabilities.provisioning?.groupCreation ?? {},
    resolve_identifier: capabilities.provisioning?.resolveIdentifier ?? {},
  };
}

function resolvedIdentifierResponse(resolved: ResolveIdentifierResponse): Record<string, unknown> {
  return stripUndefined({
    avatar_url: resolved.ghost?.avatar?.url,
    dm_room_mxid: resolved.portal?.mxid,
    id: resolved.ghost?.id ?? resolved.userId,
    mxid: resolved.userId ?? resolved.ghost?.mxid,
    name: resolved.ghost?.displayName,
  });
}

function loginStepResponse(loginId: string, step: LoginStep): Record<string, unknown> {
  return {
    login_id: loginId,
    ...loginStepJSON(step),
  };
}

function loginStepJSON(step: LoginStep): Record<string, unknown> {
  return stripUndefined({
    complete: step.complete ? stripUndefined({
      user_login_id: step.complete.userLoginId,
    }) : undefined,
    cookies: step.cookies ? stripUndefined({
      extract_js: step.cookies.extractJs,
      fields: step.cookies.fields.map((field) => stripUndefined({
        id: field.id,
        pattern: field.pattern,
        required: field.required,
        sources: field.sources.map((source) => stripUndefined({
          cookie_domain: source.cookieDomain,
          name: source.name,
          request_url_regex: source.requestUrlRegex,
          type: source.type,
        })),
      })),
      url: step.cookies.url,
      user_agent: step.cookies.userAgent,
      wait_for_url_pattern: step.cookies.waitForUrlPattern,
    }) : undefined,
    display_and_wait: step.displayAndWait ? stripUndefined({
      data: step.displayAndWait.data,
      image_url: step.displayAndWait.imageUrl,
      type: step.displayAndWait.type,
    }) : undefined,
    instructions: step.instructions,
    step_id: step.stepId,
    type: step.type,
    user_input: step.userInput ? {
      fields: step.userInput.fields.map((field) => stripUndefined({
        default_value: field.defaultValue,
        description: field.description,
        id: field.id,
        name: field.name,
        options: field.options,
        pattern: field.pattern,
        type: field.type,
      })),
    } : undefined,
  });
}

function matrixError(errcode: string, error: string): Record<string, string> {
  return { errcode, error };
}

function match(path: string, regex: RegExp): string[] | null {
  const result = regex.exec(path);
  const captures = result?.slice(1);
  return captures && captures.every((value): value is string => value !== undefined)
    ? captures.map((value) => decodeURIComponent(value))
    : null;
}

function queryParam(rawQuery: string | undefined, key: string): string | undefined {
  if (!rawQuery) return undefined;
  return new URLSearchParams(rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery).get(key) ?? undefined;
}

function hasMethod<T extends string>(value: object, method: T): value is object & Record<T, (...args: unknown[]) => unknown> {
  return method in value && typeof (value as Record<string, unknown>)[method] === "function";
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function randomID(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type StripUndefined<T extends object> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

function stripUndefined<T extends Record<string, unknown>>(value: T): StripUndefined<T> {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value as StripUndefined<T>;
}
