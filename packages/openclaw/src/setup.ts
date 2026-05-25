import { createConfigFromOpenClawSetup, DEFAULT_GATEWAY_URL, DEFAULT_REGISTRATION_URL, defaultDataDir } from "./config";
import type { setupOpenClawBeeperBridge, SetupOpenClawBeeperBridgeOptions } from "./beeper-setup";

export type OpenClawSetupConfig = {
  channels?: Record<string, unknown>;
  plugins?: {
    entries?: Record<string, { config?: unknown } | unknown>;
  };
};

export type BeeperImportSource = "dashboard" | "tui" | "channels" | "archived";

export interface BeeperChannelSettings {
  accessToken?: string;
  allowedRoomIds?: string[];
  allowedUserIds?: string[];
  appserviceId?: string;
  asToken?: string;
  approvalBehavior?: "native" | "reactions" | "slash" | "disabled";
  backfillLimit?: number;
  baseDomain?: string;
  beeperEnv?: "production" | "staging" | "dev" | "local";
  bridgeManagerToken?: string;
  bridgeManagerPostState?: boolean;
  contactVisibility?: "agents" | "agents-and-users" | "none";
  dataDir?: string;
  enabled?: boolean;
  gatewayUrl?: string;
  ghostLocalpartPrefix?: string;
  homeserver?: string;
  hsToken?: string;
  importSources?: BeeperImportSource[];
  matrixDeviceId?: string;
  matrixUserId?: string;
  homeserverDomain?: string;
  nonFederatedRooms?: boolean;
  registrationUrl?: string;
  senderLocalpart?: string;
  serviceBotLocalpart?: string;
  storePath?: string;
  streamFinalization?: "replace" | "append" | "native-only";
  userLocalpartPrefix?: string;
}

export interface BeeperSetupInput {
  accessToken?: string;
  allowedRoomIds?: string[] | string;
  allowedUserIds?: string[] | string;
  appserviceId?: string;
  asToken?: string;
  approvalBehavior?: string;
  backfillLimit?: number | string;
  baseDomain?: string;
  beeperEnv?: string;
  bridgeManagerToken?: string;
  code?: string;
  contactVisibility?: string;
  dataDir?: string;
  email?: string;
  getOnly?: boolean | string;
  gatewayUrl?: string;
  ghostLocalpartPrefix?: string;
  homeserverDomain?: string;
  importSources?: string[] | string;
  nonFederatedRooms?: boolean | string;
  postState?: boolean | string;
  push?: boolean | string;
  registrationUrl?: string;
  senderLocalpart?: string;
  serviceBotLocalpart?: string;
  selfHosted?: boolean | string;
  storePath?: string;
  streamFinalization?: string;
  username?: string;
  userLocalpartPrefix?: string;
}

export interface BeeperSetupRuntime {
  setupBridge?: (options: SetupOpenClawBeeperBridgeOptions) => Promise<Awaited<ReturnType<typeof setupOpenClawBeeperBridge>>>;
}

type StartedBeeperBridge = {
  stop?: () => Promise<void> | void;
};

type BeeperGatewayContext = {
  abortSignal: AbortSignal;
  accountId: string;
  cfg: OpenClawSetupConfig;
  log?: {
    info?: (message: string) => void;
    warn?: (message: string) => void;
    error?: (message: string) => void;
  };
  setStatus?: (next: Record<string, unknown>) => void;
};

type BeeperWizardPrompter = {
  confirm: (params: { message: string; initialValue?: boolean }) => Promise<boolean>;
  multiselect: <T>(params: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValues?: T[];
    searchable?: boolean;
  }) => Promise<T[]>;
  progress?: (label: string) => { update: (message: string) => void; stop: (message?: string) => void };
  select: <T>(params: {
    message: string;
    options: Array<{ value: T; label: string; hint?: string }>;
    initialValue?: T;
    searchable?: boolean;
  }) => Promise<T>;
  text: (params: {
    message: string;
    initialValue?: string;
    placeholder?: string;
    sensitive?: boolean;
    validate?: (value: string) => string | undefined;
  }) => Promise<string>;
};

export const BEEPER_CHANNEL_ID = "beeper";

export const BeeperChannelConfigSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    accessToken: { type: "string" },
    appserviceId: { type: "string" },
    asToken: { type: "string" },
    allowedRoomIds: { type: "array", items: { type: "string" } },
    allowedUserIds: { type: "array", items: { type: "string" } },
    enabled: { type: "boolean" },
    baseDomain: { type: "string" },
    beeperEnv: { type: "string", enum: ["production", "staging", "dev", "local"] },
    dataDir: { type: "string" },
    gatewayUrl: { type: "string" },
    ghostLocalpartPrefix: { type: "string" },
    homeserver: { type: "string" },
    hsToken: { type: "string" },
    matrixDeviceId: { type: "string" },
    matrixUserId: { type: "string" },
    registrationUrl: { type: "string" },
    bridgeManagerToken: { type: "string" },
    bridgeManagerPostState: { type: "boolean" },
    importSources: {
      type: "array",
      items: { type: "string", enum: ["dashboard", "tui", "channels", "archived"] },
    },
    backfillLimit: { type: "number" },
    nonFederatedRooms: { type: "boolean" },
    senderLocalpart: { type: "string" },
    serviceBotLocalpart: { type: "string" },
    storePath: { type: "string" },
    contactVisibility: { type: "string", enum: ["agents", "agents-and-users", "none"] },
    homeserverDomain: { type: "string" },
    streamFinalization: { type: "string", enum: ["replace", "append", "native-only"] },
    approvalBehavior: { type: "string", enum: ["native", "reactions", "slash", "disabled"] },
    userLocalpartPrefix: { type: "string" },
  },
} as const;

export const BeeperChannelUiHints = {
  accessToken: {
    help: "Beeper Matrix access token returned by login.",
    label: "Beeper Access Token",
    sensitive: true,
  },
  bridgeManagerToken: {
    help: "Optional Beeper bridge-manager token used to register the self-hosted bridge.",
    label: "Bridge Manager Token",
    sensitive: true,
  },
  asToken: {
    help: "Appservice token returned by Beeper bridge registration.",
    label: "Appservice Token",
    sensitive: true,
  },
  hsToken: {
    help: "Homeserver token returned by Beeper bridge registration.",
    label: "Homeserver Token",
    sensitive: true,
  },
} as const;

export const beeperSetupAdapter = {
  resolveAccountId: () => "default",
  resolveBindingAccountId: () => "default",
  applyAccountName: ({ cfg }: { cfg: OpenClawSetupConfig }) => cfg,
  validateInput: ({ input }: { input: BeeperSetupInput }) => validateBeeperSetupInput(input),
  applyAccountConfig: ({
    cfg,
    input,
    runtime,
  }: {
    cfg: OpenClawSetupConfig;
    accountId: string;
    input: BeeperSetupInput;
    runtime?: BeeperSetupRuntime;
  }): OpenClawSetupConfig => {
    if (input.email) {
      throw new Error("Beeper email login is asynchronous; use the Beeper setup wizard or pickle-openclaw beeper-setup.");
    }
    return applyBeeperChannelSettings(cfg, normalizeBeeperSetupInput(input));
  },
};

export const beeperSetupWizard = {
  channel: BEEPER_CHANNEL_ID,
  async getStatus(ctx: { cfg: OpenClawSetupConfig }) {
    const settings = getBeeperChannelSettings(ctx.cfg);
    const configured = isBeeperChannelConfigured(ctx.cfg);
    return {
      channel: BEEPER_CHANNEL_ID,
      configured,
      statusLines: [
        `Gateway: ${settings.gatewayUrl ?? "not configured"}`,
        `Registration URL: ${settings.registrationUrl ?? "not configured"}`,
        `Import sources: ${(settings.importSources ?? []).join(", ") || "none"}`,
      ],
      selectionHint: configured ? "Beeper bridge configured" : "Beeper login and bridge registration required",
      quickstartScore: configured ? 100 : 20,
    };
  },
  async configure(ctx: { cfg: OpenClawSetupConfig }) {
    return {
      accountId: "default",
      cfg: applyBeeperChannelSettings(ctx.cfg, defaultBeeperChannelSettings()),
    };
  },
  async configureInteractive(ctx: {
    cfg: OpenClawSetupConfig;
    runtime?: BeeperSetupRuntime;
    prompter: BeeperWizardPrompter;
  }) {
    const current = {
      ...defaultBeeperChannelSettings(),
      ...getBeeperChannelSettings(ctx.cfg),
    };
    const email = await ctx.prompter.text({
      message: "Beeper email",
      placeholder: "name@example.com",
      validate: (value) => validateBeeperSetupInput({ email: value }) ?? undefined,
    });
    const code = await ctx.prompter.text({
      message: "Beeper login code",
      sensitive: true,
      validate: (value) => (value.trim() ? undefined : "Beeper login code is required."),
    });
    const registrationUrl = await ctx.prompter.text({
      message: "Appservice callback URL",
      initialValue: current.registrationUrl ?? DEFAULT_REGISTRATION_URL,
      validate: (value) => (value.trim() ? undefined : "Appservice callback URL is required."),
    });
    const beeperEnv = await ctx.prompter.select<BeeperChannelSettings["beeperEnv"]>({
      message: "Beeper environment",
      initialValue: current.beeperEnv ?? "production",
      options: [
        { value: "production", label: "Production" },
        { value: "staging", label: "Staging" },
        { value: "dev", label: "Development" },
        { value: "local", label: "Local" },
      ],
    });
    const defaultBaseDomain = current.baseDomain ?? setupBeeperBaseDomain(beeperEnv);
    const baseDomain = await ctx.prompter.text({
      message: "Beeper API base domain",
      ...(defaultBaseDomain ? { initialValue: defaultBaseDomain } : {}),
      placeholder: "leave empty for production default",
    });
    const bridgeManagerToken = await ctx.prompter.text({
      message: "Bridge manager token",
      ...(current.bridgeManagerToken ? { initialValue: current.bridgeManagerToken } : {}),
      placeholder: "optional",
      sensitive: true,
    });
    const homeserverDomain = await ctx.prompter.text({
      message: "Homeserver domain",
      ...(current.homeserverDomain ? { initialValue: current.homeserverDomain } : {}),
      placeholder: "optional",
    });
    const importSources = await ctx.prompter.multiselect<BeeperImportSource>({
      message: "OpenClaw sessions to import",
      initialValues: current.importSources ?? ["dashboard", "tui"],
      options: [
        { value: "dashboard", label: "Dashboard" },
        { value: "tui", label: "TUI" },
        { value: "channels", label: "Channel-origin sessions" },
        { value: "archived", label: "Archived sessions" },
      ],
    });
    const backfillLimit = await ctx.prompter.text({
      message: "Backfill limit per session",
      initialValue: String(current.backfillLimit ?? 500),
      validate: (value) => validateBeeperSetupInput({ backfillLimit: value }) ?? undefined,
    });
    const contactVisibility = await ctx.prompter.select<BeeperChannelSettings["contactVisibility"]>({
      message: "Beeper contact visibility",
      initialValue: current.contactVisibility ?? "agents",
      options: [
        { value: "agents", label: "Agents" },
        { value: "agents-and-users", label: "Agents and users" },
        { value: "none", label: "None" },
      ],
    });
    const streamFinalization = await ctx.prompter.select<BeeperChannelSettings["streamFinalization"]>({
      message: "Stream finalization",
      initialValue: current.streamFinalization ?? "replace",
      options: [
        { value: "replace", label: "Replace final message" },
        { value: "append", label: "Append final message" },
        { value: "native-only", label: "Native stream only" },
      ],
    });
    const approvalBehavior = await ctx.prompter.select<BeeperChannelSettings["approvalBehavior"]>({
      message: "Approval behavior",
      initialValue: current.approvalBehavior ?? "native",
      options: [
        { value: "native", label: "Native" },
        { value: "reactions", label: "Reactions" },
        { value: "slash", label: "Slash commands" },
        { value: "disabled", label: "Disabled" },
      ],
    });
    const nonFederatedRooms = await ctx.prompter.confirm({
      message: "Create non-federated Matrix rooms",
      initialValue: current.nonFederatedRooms ?? true,
    });
    const postState = await ctx.prompter.confirm({
      message: "Post bridge state to Beeper",
      initialValue: current.bridgeManagerPostState ?? true,
    });
    const progress = ctx.prompter.progress?.("Setting up Beeper bridge");
    progress?.update("Logging in and registering appservice");
    try {
      const input: BeeperSetupInput = {
        backfillLimit,
        code,
        email,
        gatewayUrl: current.gatewayUrl ?? DEFAULT_GATEWAY_URL,
        importSources,
        nonFederatedRooms,
        postState,
        registrationUrl,
      };
      if (approvalBehavior !== undefined) input.approvalBehavior = approvalBehavior;
      if (baseDomain.trim()) input.baseDomain = baseDomain.trim();
      if (beeperEnv !== undefined) input.beeperEnv = beeperEnv;
      if (bridgeManagerToken.trim()) input.bridgeManagerToken = bridgeManagerToken.trim();
      if (contactVisibility !== undefined) input.contactVisibility = contactVisibility;
      if (homeserverDomain.trim()) input.homeserverDomain = homeserverDomain.trim();
      if (streamFinalization !== undefined) input.streamFinalization = streamFinalization;
      const setupParams: Parameters<typeof applyBeeperSetupConfig>[0] = {
        cfg: ctx.cfg,
        input,
      };
      if (ctx.runtime !== undefined) setupParams.runtime = ctx.runtime;
      const cfg = await applyBeeperSetupConfig(setupParams);
      progress?.stop("Beeper bridge configured");
      return { accountId: "default", cfg };
    } catch (error) {
      progress?.stop("Beeper bridge setup failed");
      throw error;
    }
  },
  disable: (cfg: OpenClawSetupConfig) => applyBeeperChannelSettings(cfg, { enabled: false }),
};

export const beeperChannelConfig = {
  listAccountIds: () => ["default"],
  defaultAccountId: () => "default",
  resolveAccount: (cfg: OpenClawSetupConfig) => ({
    accountId: "default",
    configured: isBeeperChannelConfigured(cfg),
    settings: getBeeperChannelSettings(cfg),
  }),
  isEnabled: (account: { settings?: BeeperChannelSettings }) => account.settings?.enabled !== false,
  isConfigured: (account: { configured?: boolean }) => account.configured === true,
  hasConfiguredState: ({ cfg }: { cfg: OpenClawSetupConfig }) => isBeeperChannelConfigured(cfg),
  describeAccount: (account: { configured?: boolean; settings?: BeeperChannelSettings }) => ({
    id: "default",
    label: "Beeper",
    configured: account.configured === true,
    extra: {
      gatewayUrl: account.settings?.gatewayUrl,
      registrationUrl: account.settings?.registrationUrl,
    },
  }),
};

export const beeperStatusAdapter = {
  defaultRuntime: {
    accountId: "default",
    configured: false,
    enabled: false,
    extra: {
      mode: "self-hosted-appservice",
    },
    running: false,
  },
  buildChannelSummary: ({ snapshot }: { snapshot: Record<string, unknown> }) => ({
    configured: snapshot.configured === true,
    enabled: snapshot.enabled !== false,
    gatewayUrl: recordValue(snapshot.extra)?.gatewayUrl,
    homeserver: recordValue(snapshot.extra)?.homeserver,
    mode: "self-hosted-appservice",
    running: snapshot.running === true,
  }),
  buildAccountSnapshot: ({ account }: { account: { accountId?: string; configured?: boolean; settings?: BeeperChannelSettings } }) => {
    const settings = account.settings ?? {};
    return {
      accountId: account.accountId ?? "default",
      configured: account.configured === true,
      enabled: settings.enabled !== false,
      extra: {
        approvalBehavior: settings.approvalBehavior ?? "native",
        beeperEnv: settings.beeperEnv ?? "production",
        contactVisibility: settings.contactVisibility ?? "agents",
        gatewayUrl: settings.gatewayUrl,
        homeserver: settings.homeserver,
        importSources: settings.importSources ?? [],
        mode: "self-hosted-appservice",
        registrationUrl: settings.registrationUrl,
        streamFinalization: settings.streamFinalization ?? "replace",
      },
      name: "Beeper",
      running: false,
    };
  },
  resolveAccountState: ({ configured, enabled }: { configured: boolean; enabled: boolean }) => {
    if (!enabled) return "disabled";
    return configured ? "configured" : "missing_credentials";
  },
  collectStatusIssues: (accounts: Array<{ configured?: boolean; enabled?: boolean }>) =>
    accounts
      .filter((account) => account.enabled !== false && account.configured !== true)
      .map(() => ({
        message: "Beeper bridge is not fully configured; run Beeper channel setup.",
        severity: "warning",
      })),
};

const startedBridges = new Map<string, StartedBeeperBridge>();

export async function applyBeeperSetupConfig(params: {
  cfg: OpenClawSetupConfig;
  input: BeeperSetupInput;
  runtime?: BeeperSetupRuntime;
}): Promise<OpenClawSetupConfig> {
  const baseSettings = normalizeBeeperSetupInput(params.input);
  if (!params.input.email) return applyBeeperChannelSettings(params.cfg, baseSettings);
  const setupBridge = params.runtime?.setupBridge ?? (await loadBeeperSetupBridge());
  const bridgeOptions = setupOptionsFromInput(params.input);
  const result = await setupBridge(bridgeOptions);
  const setupSettings: Partial<BeeperChannelSettings> = {
    ...baseSettings,
    enabled: true,
    registrationUrl: result.config.registrationUrl,
  };
  if (result.config.homeserver) setupSettings.homeserver = result.config.homeserver;
  if (result.config.accessToken) setupSettings.accessToken = result.config.accessToken;
  if (result.config.asToken) setupSettings.asToken = result.config.asToken;
  if (params.input.homeserverDomain) setupSettings.homeserverDomain = params.input.homeserverDomain;
  if (result.config.hsToken) setupSettings.hsToken = result.config.hsToken;
  if (result.config.matrixDeviceId) setupSettings.matrixDeviceId = result.config.matrixDeviceId;
  if (result.config.matrixUserId) setupSettings.matrixUserId = result.config.matrixUserId;
  return applyBeeperChannelSettings(params.cfg, setupSettings);
}

async function loadBeeperSetupBridge(): Promise<typeof setupOpenClawBeeperBridge> {
  return (await import("./beeper-setup")).setupOpenClawBeeperBridge;
}

export const beeperChannelPlugin = {
  id: BEEPER_CHANNEL_ID,
  meta: {
    id: BEEPER_CHANNEL_ID,
    label: "Beeper",
    selectionLabel: "Beeper bridge",
    docsPath: "/channels/beeper",
    docsLabel: "beeper",
    blurb: "bridges OpenClaw sessions and agents into Beeper.",
    order: 90,
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "thread"],
    media: true,
    reactions: true,
    threads: true,
  },
  reload: { configPrefixes: ["channels.beeper", "plugins.entries.beeper"] },
  configSchema: BeeperChannelConfigSchema,
  uiHints: BeeperChannelUiHints,
  config: beeperChannelConfig,
  status: beeperStatusAdapter,
  gateway: {
    startAccount: startBeeperGatewayAccount,
    stopAccount: stopBeeperGatewayAccount,
  },
  setup: beeperSetupAdapter,
  setupWizard: beeperSetupWizard,
};

export async function startBeeperGatewayAccount(ctx: BeeperGatewayContext): Promise<void> {
  const settings = getBeeperChannelSettings(ctx.cfg);
  if (settings.enabled === false) {
    ctx.log?.info?.("Beeper bridge is disabled; skipping startup.");
    return;
  }
  if (!isBeeperChannelConfigured(ctx.cfg)) {
    throw new Error("Beeper bridge is not fully configured; run Beeper channel setup first.");
  }
  const { accountFromOpenClawConfig, startOpenClawBeeperBridge } = await import("./appservice");
  const config = createConfigFromOpenClawSetup(ctx.cfg);
  const bridge = await startOpenClawBeeperBridge({
    account: accountFromOpenClawConfig(config),
    backfill: Boolean(config.importSources?.length),
    ...(config.backfillLimit !== undefined ? { backfillLimit: config.backfillLimit } : {}),
    config,
    dataDir: config.dataDir,
  });
  const key = gatewayAccountKey(ctx.accountId);
  startedBridges.set(key, bridge as StartedBeeperBridge);
  ctx.setStatus?.({
    accountId: ctx.accountId,
    configured: true,
    enabled: true,
    running: true,
  });
  ctx.log?.info?.("Beeper bridge started.");
  try {
    await waitForAbort(ctx.abortSignal);
  } finally {
    startedBridges.delete(key);
    await bridge.stop?.();
    ctx.setStatus?.({
      accountId: ctx.accountId,
      running: false,
    });
    ctx.log?.info?.("Beeper bridge stopped.");
  }
}

export async function stopBeeperGatewayAccount(ctx: BeeperGatewayContext): Promise<void> {
  const bridge = startedBridges.get(gatewayAccountKey(ctx.accountId));
  if (!bridge) return;
  startedBridges.delete(gatewayAccountKey(ctx.accountId));
  await bridge.stop?.();
  ctx.setStatus?.({
    accountId: ctx.accountId,
    running: false,
  });
}

export function getBeeperChannelSettings(cfg: OpenClawSetupConfig): BeeperChannelSettings {
  const pluginEntry = recordValue(cfg.plugins?.entries?.[BEEPER_CHANNEL_ID]);
  const pluginSettings = recordValue(pluginEntry?.config);
  const channelSettings = recordValue(cfg.channels?.[BEEPER_CHANNEL_ID]);
  return {
    ...(pluginSettings as BeeperChannelSettings | undefined),
    ...(channelSettings as BeeperChannelSettings | undefined),
  };
}

export function isBeeperChannelConfigured(cfg: OpenClawSetupConfig): boolean {
  const settings = getBeeperChannelSettings(cfg);
  return Boolean(
    settings.enabled &&
    settings.accessToken &&
    settings.asToken &&
    settings.gatewayUrl &&
    settings.homeserver &&
    settings.hsToken &&
    settings.matrixDeviceId &&
    settings.matrixUserId &&
    settings.registrationUrl
  );
}

export function applyBeeperChannelSettings(
  cfg: OpenClawSetupConfig,
  patch: Partial<BeeperChannelSettings>,
): OpenClawSetupConfig {
  const current = getBeeperChannelSettings(cfg);
  const nextSettings = {
    ...current,
    ...patch,
  };
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      [BEEPER_CHANNEL_ID]: nextSettings,
    },
    plugins: {
      ...cfg.plugins,
      entries: {
        ...cfg.plugins?.entries,
        [BEEPER_CHANNEL_ID]: {
          ...(recordValue(cfg.plugins?.entries?.[BEEPER_CHANNEL_ID]) ?? {}),
          config: nextSettings,
        },
      },
    },
  };
}

export function defaultBeeperChannelSettings(): BeeperChannelSettings {
  return {
    approvalBehavior: "native",
    backfillLimit: 500,
    beeperEnv: "production",
    contactVisibility: "agents",
    dataDir: defaultDataDir(),
    enabled: true,
    gatewayUrl: DEFAULT_GATEWAY_URL,
    importSources: ["dashboard", "tui"],
    nonFederatedRooms: true,
    registrationUrl: DEFAULT_REGISTRATION_URL,
    streamFinalization: "replace",
  };
}

export function validateBeeperSetupInput(input: BeeperSetupInput): string | null {
  if (input.email !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(input.email)) return "Beeper email must be a valid email address.";
  if (input.beeperEnv !== undefined && normalizeBeeperEnv(input.beeperEnv) === undefined) return "Beeper environment must be production, staging, dev, or local.";
  if (input.contactVisibility !== undefined && normalizeContactVisibility(input.contactVisibility) === undefined) return "Contact visibility must be agents, agents-and-users, or none.";
  if (input.streamFinalization !== undefined && normalizeStreamFinalization(input.streamFinalization) === undefined) return "Stream finalization must be replace, append, or native-only.";
  if (input.approvalBehavior !== undefined && normalizeApprovalBehavior(input.approvalBehavior) === undefined) return "Approval behavior must be native, reactions, slash, or disabled.";
  const backfillLimit = normalizeOptionalNumber(input.backfillLimit);
  if (backfillLimit !== undefined && (!Number.isInteger(backfillLimit) || backfillLimit < 0)) return "Backfill limit must be a non-negative integer.";
  return null;
}

export function normalizeBeeperSetupInput(input: BeeperSetupInput): Partial<BeeperChannelSettings> {
  const settings: Partial<BeeperChannelSettings> = { enabled: true };
  const allowedRoomIds = normalizeStringList(input.allowedRoomIds);
  const allowedUserIds = normalizeStringList(input.allowedUserIds);
  const approvalBehavior = normalizeApprovalBehavior(input.approvalBehavior);
  const backfillLimit = normalizeOptionalNumber(input.backfillLimit);
  const beeperEnv = normalizeBeeperEnv(input.beeperEnv);
  const contactVisibility = normalizeContactVisibility(input.contactVisibility);
  const importSources = normalizeImportSources(input.importSources);
  const nonFederatedRooms = normalizeOptionalBoolean(input.nonFederatedRooms);
  const bridgeManagerPostState = normalizeOptionalBoolean(input.postState);
  const streamFinalization = normalizeStreamFinalization(input.streamFinalization);
  if (input.accessToken) settings.accessToken = input.accessToken;
  if (input.appserviceId) settings.appserviceId = input.appserviceId;
  if (input.asToken) settings.asToken = input.asToken;
  if (allowedRoomIds) settings.allowedRoomIds = allowedRoomIds;
  if (allowedUserIds) settings.allowedUserIds = allowedUserIds;
  if (approvalBehavior) settings.approvalBehavior = approvalBehavior;
  if (backfillLimit !== undefined) settings.backfillLimit = backfillLimit;
  if (input.baseDomain) settings.baseDomain = input.baseDomain;
  if (beeperEnv) settings.beeperEnv = beeperEnv;
  if (contactVisibility) settings.contactVisibility = contactVisibility;
  if (input.bridgeManagerToken) settings.bridgeManagerToken = input.bridgeManagerToken;
  if (bridgeManagerPostState !== undefined) settings.bridgeManagerPostState = bridgeManagerPostState;
  if (input.dataDir) settings.dataDir = input.dataDir;
  if (input.gatewayUrl) settings.gatewayUrl = input.gatewayUrl;
  if (input.ghostLocalpartPrefix) settings.ghostLocalpartPrefix = input.ghostLocalpartPrefix;
  if (input.homeserverDomain) settings.homeserverDomain = input.homeserverDomain;
  if (importSources) settings.importSources = importSources;
  if (nonFederatedRooms !== undefined) settings.nonFederatedRooms = nonFederatedRooms;
  if (input.registrationUrl) settings.registrationUrl = input.registrationUrl;
  if (input.senderLocalpart) settings.senderLocalpart = input.senderLocalpart;
  if (input.serviceBotLocalpart) settings.serviceBotLocalpart = input.serviceBotLocalpart;
  if (input.storePath) settings.storePath = input.storePath;
  if (streamFinalization) settings.streamFinalization = streamFinalization;
  if (input.userLocalpartPrefix) settings.userLocalpartPrefix = input.userLocalpartPrefix;
  return settings;
}

export function setupOptionsFromInput(input: BeeperSetupInput): SetupOpenClawBeeperBridgeOptions {
  if (!input.email) throw new Error("Beeper email is required for dashboard login setup");
  const options: SetupOpenClawBeeperBridgeOptions = {
    email: input.email,
  };
  const env = normalizeBeeperEnv(input.beeperEnv);
  const getOnly = normalizeOptionalBoolean(input.getOnly);
  const postState = normalizeOptionalBoolean(input.postState);
  const push = normalizeOptionalBoolean(input.push);
  const selfHosted = normalizeOptionalBoolean(input.selfHosted);
  if (env) options.env = env;
  if (input.baseDomain) options.baseDomain = input.baseDomain;
  if (input.bridgeManagerToken) options.bridgeManagerToken = input.bridgeManagerToken;
  if (input.code) options.getLoginCode = () => input.code!;
  if (getOnly !== undefined) options.getOnly = getOnly;
  if (input.homeserverDomain) options.homeserverDomain = input.homeserverDomain;
  if (postState !== undefined) options.postState = postState;
  if (push !== undefined) options.push = push;
  if (input.registrationUrl) options.address = input.registrationUrl;
  if (selfHosted !== undefined) options.selfHosted = selfHosted;
  if (input.username) options.username = input.username;
  return options;
}

function normalizeImportSources(value: string[] | string | undefined): BeeperImportSource[] | undefined {
  if (value === undefined) return undefined;
  const raw = Array.isArray(value) ? value : value.split(",");
  const sources = raw.map((entry) => entry.trim()).filter(Boolean);
  if (sources.every(isImportSource)) return [...new Set(sources)];
  return undefined;
}

function normalizeStringList(value: string[] | string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const entries = (Array.isArray(value) ? value : value.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
  return entries.length > 0 ? [...new Set(entries)] : undefined;
}

function isImportSource(value: string): value is BeeperImportSource {
  return value === "dashboard" || value === "tui" || value === "channels" || value === "archived";
}

function normalizeBeeperEnv(value: string | undefined): BeeperChannelSettings["beeperEnv"] | undefined {
  if (value === "production" || value === "staging" || value === "dev" || value === "local") return value;
  return undefined;
}

function setupBeeperBaseDomain(env: BeeperChannelSettings["beeperEnv"]): string | undefined {
  if (env === undefined || env === "production") return undefined;
  if (env === "dev") return "beeper-dev.com";
  if (env === "local") return "beeper.localtest.me";
  return "beeper-staging.com";
}

function gatewayAccountKey(accountId: string): string {
  return accountId || "default";
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

function normalizeContactVisibility(value: string | undefined): BeeperChannelSettings["contactVisibility"] | undefined {
  if (value === "agents" || value === "agents-and-users" || value === "none") return value;
  return undefined;
}

function normalizeStreamFinalization(value: string | undefined): BeeperChannelSettings["streamFinalization"] | undefined {
  if (value === "replace" || value === "append" || value === "native-only") return value;
  return undefined;
}

function normalizeApprovalBehavior(value: string | undefined): BeeperChannelSettings["approvalBehavior"] | undefined {
  if (value === "native" || value === "reactions" || value === "slash" || value === "disabled") return value;
  return undefined;
}

function normalizeOptionalNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeOptionalBoolean(value: boolean | string | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === "") return undefined;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}
