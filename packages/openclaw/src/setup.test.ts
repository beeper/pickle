import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./openclaw-extension";
import setupEntry from "./setup-entry";
import {
  applyBeeperChannelSettings,
  beeperChannelConfig,
  beeperChannelPlugin,
  beeperStatusAdapter,
  beeperSetupAdapter,
  beeperSetupWizard,
  defaultBeeperChannelSettings,
  getBeeperChannelSettings,
  isBeeperChannelConfigured,
  startBeeperGatewayAccount,
  validateBeeperSetupInput,
} from "./setup";
import { createConfigFromOpenClawSetup } from "./config";

const appserviceMocks = vi.hoisted(() => ({
  accountFromOpenClawConfig: vi.fn((config: unknown) => ({ config, kind: "account" })),
  startOpenClawBeeperBridge: vi.fn(),
}));

vi.mock("./appservice", () => appserviceMocks);

describe("OpenClaw Beeper setup surface", () => {
  beforeEach(() => {
    appserviceMocks.accountFromOpenClawConfig.mockClear();
    appserviceMocks.startOpenClawBeeperBridge.mockReset();
  });

  it("exposes a channel plugin through the setup entry shape OpenClaw loads", () => {
    expect(extension.plugin).toBe(beeperChannelPlugin);
    expect(beeperChannelPlugin).toMatchObject({
      id: "beeper",
      meta: {
        id: "beeper",
        label: "Beeper",
      },
      capabilities: {
        media: true,
        reactions: true,
        threads: true,
      },
      reload: {
        configPrefixes: ["channels.beeper", "plugins.entries.beeper"],
      },
      gateway: {
        startAccount: expect.any(Function),
        stopAccount: expect.any(Function),
      },
      uiHints: {
        accessToken: {
          sensitive: true,
        },
        asToken: {
          sensitive: true,
        },
        bridgeManagerToken: {
          sensitive: true,
        },
        hsToken: {
          sensitive: true,
        },
      },
    });
    expect(beeperChannelPlugin.setup).toBe(beeperSetupAdapter);
    expect(beeperChannelPlugin.setupWizard).toBe(beeperSetupWizard);
  });

  it("matches the OpenClaw channel contract surface used by the dashboard and runtime", () => {
    expect(beeperChannelPlugin.id).toBe("beeper");
    expect(beeperChannelPlugin.meta).toEqual(expect.objectContaining({
      blurb: expect.any(String),
      docsPath: "/channels/beeper",
      id: "beeper",
      label: "Beeper",
      selectionLabel: expect.any(String),
    }));
    expect(beeperChannelPlugin.capabilities.chatTypes).toEqual(
      expect.arrayContaining(["direct", "thread"]),
    );
    expect(beeperChannelPlugin.config).toEqual(expect.objectContaining({
      describeAccount: expect.any(Function),
      hasConfiguredState: expect.any(Function),
      isConfigured: expect.any(Function),
      isEnabled: expect.any(Function),
      listAccountIds: expect.any(Function),
      resolveAccount: expect.any(Function),
    }));
    expect(beeperChannelPlugin.setup).toEqual(expect.objectContaining({
      applyAccountConfig: expect.any(Function),
      applyAccountName: expect.any(Function),
      resolveAccountId: expect.any(Function),
      resolveBindingAccountId: expect.any(Function),
      validateInput: expect.any(Function),
    }));
    expect(beeperChannelPlugin.setupWizard).toEqual(expect.objectContaining({
      channel: "beeper",
      configure: expect.any(Function),
      configureInteractive: expect.any(Function),
      getStatus: expect.any(Function),
    }));
    expect(beeperChannelPlugin.gateway).toEqual(expect.objectContaining({
      startAccount: expect.any(Function),
      stopAccount: expect.any(Function),
    }));
    expect(beeperChannelPlugin.status).toBe(beeperStatusAdapter);

    const cfg = beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        gatewayUrl: "ws://127.0.0.1:18789",
        registrationUrl: "http://127.0.0.1:29391",
      },
    });
    expect(cfg).not.toHaveProperty("then");
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
      gatewayUrl: "ws://127.0.0.1:18789",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });

  it("starts the Beeper bridge from OpenClaw gateway lifecycle and stops on abort", async () => {
    const stop = vi.fn(async () => undefined);
    appserviceMocks.startOpenClawBeeperBridge.mockResolvedValueOnce({ stop });
    const abort = new AbortController();
    const statuses: unknown[] = [];
    const cfg = applyBeeperChannelSettings({}, {
      accessToken: "at",
      asToken: "as",
      backfillLimit: 25,
      dataDir: "/tmp/openclaw-beeper",
      enabled: true,
      gatewayUrl: "ws://gateway",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      importSources: ["dashboard", "tui"],
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
      registrationUrl: "http://bridge",
    });

    const task = startBeeperGatewayAccount({
      abortSignal: abort.signal,
      accountId: "default",
      cfg,
      setStatus: (next) => statuses.push(next),
    });
    await vi.waitFor(() => expect(appserviceMocks.startOpenClawBeeperBridge).toHaveBeenCalledOnce());
    expect(appserviceMocks.accountFromOpenClawConfig).toHaveBeenCalledWith(expect.objectContaining({
      accessToken: "at",
      asToken: "as",
      gatewayUrl: "ws://gateway",
      hsToken: "hs",
    }));
    expect(appserviceMocks.startOpenClawBeeperBridge).toHaveBeenCalledWith(expect.objectContaining({
      account: expect.objectContaining({ kind: "account" }),
      backfill: true,
      backfillLimit: 25,
      config: expect.objectContaining({
        dataDir: "/tmp/openclaw-beeper",
        importSources: ["dashboard", "tui"],
      }),
      dataDir: "/tmp/openclaw-beeper",
    }));
    expect(statuses).toContainEqual(expect.objectContaining({ running: true }));
    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
    expect(statuses).toContainEqual(expect.objectContaining({ running: false }));
  });

  it("rejects gateway startup until Beeper setup has complete credentials", async () => {
    await expect(startBeeperGatewayAccount({
      abortSignal: new AbortController().signal,
      accountId: "default",
      cfg: applyBeeperChannelSettings({}, {
        enabled: true,
        gatewayUrl: "ws://gateway",
        registrationUrl: "http://bridge",
      }),
    })).rejects.toThrow("not fully configured");
  });

  it("exposes the lightweight OpenClaw setup-entry contract", () => {
    expect(setupEntry).toMatchObject({
      kind: "bundled-channel-setup-entry",
      loadSetupPlugin: expect.any(Function),
    });
    expect(setupEntry.loadSetupPlugin()).toBe(beeperChannelPlugin);
  });

  it("applies dashboard setup input into channels.beeper settings", async () => {
    const cfg = await beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        accessToken: "mx",
        allowedRoomIds: "!one:example,!two:example,!one:example",
        allowedUserIds: ["@alice:example", "@bob:example", "@alice:example"],
        appserviceId: "custom-openclaw",
        approvalBehavior: "native",
        backfillLimit: "42",
        baseDomain: "beeper-staging.com",
        beeperEnv: "staging",
        bridgeManagerToken: "hungry",
        contactVisibility: "agents-and-users",
        gatewayUrl: "ws://127.0.0.1:18789",
        ghostLocalpartPrefix: "oc_agent_",
        importSources: "dashboard,tui",
        nonFederatedRooms: "false",
        registrationUrl: "http://127.0.0.1:29391",
        senderLocalpart: "ocbot",
        serviceBotLocalpart: "ocservice",
        storePath: "/tmp/openclaw-store",
        streamFinalization: "replace",
        userLocalpartPrefix: "oc_user_",
      },
    });
    expect(getBeeperChannelSettings(cfg)).toEqual({
      accessToken: "mx",
      allowedRoomIds: ["!one:example", "!two:example"],
      allowedUserIds: ["@alice:example", "@bob:example"],
      appserviceId: "custom-openclaw",
      approvalBehavior: "native",
      backfillLimit: 42,
      baseDomain: "beeper-staging.com",
      beeperEnv: "staging",
      bridgeManagerToken: "hungry",
      contactVisibility: "agents-and-users",
      enabled: true,
      gatewayUrl: "ws://127.0.0.1:18789",
      ghostLocalpartPrefix: "oc_agent_",
      importSources: ["dashboard", "tui"],
      nonFederatedRooms: false,
      registrationUrl: "http://127.0.0.1:29391",
      senderLocalpart: "ocbot",
      serviceBotLocalpart: "ocservice",
      storePath: "/tmp/openclaw-store",
      streamFinalization: "replace",
      userLocalpartPrefix: "oc_user_",
    });
    expect(isBeeperChannelConfigured(cfg)).toBe(false);
    expect(cfg.plugins?.entries?.beeper).toEqual({
      config: getBeeperChannelSettings(cfg),
    });
  });

  it("keeps async Beeper login out of the synchronous OpenClaw setup adapter", () => {
    expect(() => beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        email: "alice@example.com",
      },
    })).toThrow("Beeper email login is asynchronous");
  });

  it("runs Beeper login and appservice registration from dashboard setup wizard input", async () => {
    const progress = {
      stop: () => {},
      update: () => {},
    };
    const promptValues: Record<string, string> = {
      "Beeper email": "alice@example.com",
      "Beeper login code": "123456",
      "Appservice callback URL": "http://127.0.0.1:29391",
      "Beeper API base domain": "beeper.localtest.me",
      "Bridge manager token": "hungry",
      "Homeserver domain": "beeper.local",
      "Backfill limit per session": "500",
    };
    const result = await beeperSetupWizard.configureInteractive({
      cfg: {},
      prompter: {
        confirm: async ({ message }) => message === "Post bridge state to Beeper" ? false : true,
        multiselect: async () => ["dashboard", "tui"],
        progress: () => progress,
        select: async ({ message }) => {
          if (message === "Beeper environment") return "dev";
          if (message === "Beeper contact visibility") return "agents";
          if (message === "Stream finalization") return "replace";
          if (message === "Approval behavior") return "native";
          throw new Error(`unexpected select prompt ${message}`);
        },
        text: async ({ message, validate }) => {
          const value = promptValues[message];
          if (value === undefined) throw new Error(`unexpected text prompt ${message}`);
          const error = validate?.(value);
          if (error) throw new Error(error);
          return value;
        },
      },
      runtime: {
        setupBridge: async (options) => {
          expect(options.email).toBe("alice@example.com");
          expect(options.env).toBe("dev");
          expect(options.baseDomain).toBe("beeper.localtest.me");
          expect(options.bridgeManagerToken).toBe("hungry");
          expect(options.homeserverDomain).toBe("beeper.local");
          expect(options.postState).toBe(false);
          expect(await options.getLoginCode?.()).toBe("123456");
          expect(options.address).toBe("http://127.0.0.1:29391");
          return {
            account: {
              accessToken: "at",
              deviceId: "DEV",
              homeserver: "https://matrix.example",
              userId: "@alice:example",
            },
            config: {
              accessToken: "at",
              appserviceId: "pickle-openclaw",
              asToken: "as",
              homeserver: "https://matrix.example",
              hsToken: "hs",
              matrixDeviceId: "DEV",
              matrixUserId: "@alice:example",
              registrationUrl: "http://127.0.0.1:29391",
            },
            init: {
              homeserver: "https://matrix.example",
              registration: {
                asToken: "as",
                id: "pickle-openclaw",
                hsToken: "hs",
                url: "http://127.0.0.1:29391",
              },
            } as never,
          };
        },
      },
    });
    const cfg = result.cfg;
    expect(result.accountId).toBe("default");
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
      enabled: true,
      accessToken: "at",
      asToken: "as",
      baseDomain: "beeper.localtest.me",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry",
      gatewayUrl: "ws://127.0.0.1:18789",
      homeserver: "https://matrix.example",
      homeserverDomain: "beeper.local",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });

  it("keeps manually entered tokens in setup input", async () => {
    const cfg = await beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        accessToken: "at",
        asToken: "as",
        gatewayUrl: "ws://127.0.0.1:18789",
        registrationUrl: "http://127.0.0.1:29391",
      },
    });
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
      accessToken: "at",
      asToken: "as",
      gatewayUrl: "ws://127.0.0.1:18789",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });

  it("does not report configured until login, appservice, and gateway details are present", async () => {
    expect(isBeeperChannelConfigured(applyBeeperChannelSettings({}, {
      enabled: true,
      gatewayUrl: "ws://gateway",
      registrationUrl: "http://bridge",
    }))).toBe(false);
    const cfg = applyBeeperChannelSettings({}, {
      accessToken: "at",
      asToken: "as",
      enabled: true,
      gatewayUrl: "ws://gateway",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
      registrationUrl: "http://bridge",
    });
    expect(isBeeperChannelConfigured(cfg)).toBe(true);
  });

  it("legacy direct applyBeeperSetupConfig path still supports test/runtime callers", async () => {
    const { applyBeeperSetupConfig } = await import("./setup");
    const cfg = await applyBeeperSetupConfig({
      cfg: {},
      input: {
        beeperEnv: "dev",
        code: "123456",
        email: "alice@example.com",
        gatewayUrl: "ws://127.0.0.1:18789",
        registrationUrl: "http://127.0.0.1:29391",
      },
      runtime: {
        setupBridge: async (options) => {
          expect(options.email).toBe("alice@example.com");
          expect(options.env).toBe("dev");
          expect(options.baseDomain).toBeUndefined();
          expect(options.bridgeManagerToken).toBeUndefined();
          expect(options.homeserverDomain).toBeUndefined();
          expect(options.postState).toBeUndefined();
          expect(await options.getLoginCode?.()).toBe("123456");
          expect(options.address).toBe("http://127.0.0.1:29391");
          return {
            account: {
              accessToken: "at",
              deviceId: "DEV",
              homeserver: "https://matrix.example",
              userId: "@alice:example",
            },
            config: {
              accessToken: "at",
              appserviceId: "pickle-openclaw",
              asToken: "as",
              homeserver: "https://matrix.example",
              hsToken: "hs",
              matrixDeviceId: "DEV",
              matrixUserId: "@alice:example",
              registrationUrl: "http://127.0.0.1:29391",
            },
            init: {
              homeserver: "https://matrix.example",
              registration: {
                asToken: "as",
                id: "pickle-openclaw",
                hsToken: "hs",
                url: "http://127.0.0.1:29391",
              },
            } as never,
          };
        },
      },
    });
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
      enabled: true,
      accessToken: "at",
      asToken: "as",
      gatewayUrl: "ws://127.0.0.1:18789",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });

  it("keeps default import scope opt-in to dashboard and TUI sessions", async () => {
    expect(defaultBeeperChannelSettings()).toMatchObject({
      enabled: true,
      importSources: ["dashboard", "tui"],
      streamFinalization: "replace",
    });
    const configured = await beeperSetupWizard.configure({ cfg: {} });
    expect(getBeeperChannelSettings(configured.cfg)).toMatchObject({
      enabled: true,
      importSources: ["dashboard", "tui"],
    });
  });

  it("reports setup status and validates dashboard input", async () => {
    expect(validateBeeperSetupInput({ email: "not-email" })).toContain("valid email");
    expect(validateBeeperSetupInput({ backfillLimit: "-1" })).toContain("non-negative");
    const cfg = applyBeeperChannelSettings({}, {
      enabled: true,
      gatewayUrl: "ws://gateway",
      importSources: ["dashboard"],
      registrationUrl: "http://bridge",
    });
    await expect(beeperSetupWizard.getStatus({ cfg })).resolves.toMatchObject({
      channel: "beeper",
      configured: false,
      quickstartScore: 20,
    });
  });

  it("reports lightweight channel status without starting bridge runtime", () => {
    const account = beeperChannelConfig.resolveAccount(applyBeeperChannelSettings({}, {
      enabled: true,
      gatewayUrl: "ws://gateway",
      importSources: ["dashboard", "tui"],
      registrationUrl: "http://bridge",
      streamFinalization: "replace",
    }));
    const snapshot = beeperStatusAdapter.buildAccountSnapshot({ account });

    expect(snapshot).toMatchObject({
      accountId: "default",
      configured: false,
      enabled: true,
      extra: {
        gatewayUrl: "ws://gateway",
        importSources: ["dashboard", "tui"],
        mode: "self-hosted-appservice",
        registrationUrl: "http://bridge",
      },
      running: false,
    });
    expect(beeperStatusAdapter.buildChannelSummary({ snapshot })).toMatchObject({
      configured: false,
      enabled: true,
      gatewayUrl: "ws://gateway",
      mode: "self-hosted-appservice",
      running: false,
    });
    expect(beeperStatusAdapter.resolveAccountState({ configured: false, enabled: true })).toBe("missing_credentials");
    expect(beeperStatusAdapter.collectStatusIssues([snapshot])).toEqual([
      expect.objectContaining({
        message: expect.stringContaining("not fully configured"),
        severity: "warning",
      }),
    ]);
  });

  it("creates bridge runtime config from persisted channels.beeper settings", () => {
    const cfg = createConfigFromOpenClawSetup({
      channels: {
        beeper: {
          dataDir: "/tmp/beeper",
          gatewayUrl: "ws://gateway",
          homeserver: "https://matrix.example",
          hsToken: "hs",
          matrixDeviceId: "DEV",
          matrixUserId: "@alice:example",
          nonFederatedRooms: false,
          registrationUrl: "http://bridge",
        },
      },
    });
    expect(cfg).toMatchObject({
      dataDir: "/tmp/beeper",
      gatewayUrl: "ws://gateway",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
      nonFederatedRooms: false,
      registrationUrl: "http://bridge",
    });
  });

  it("reads plugin-entry channel config with channels.beeper taking precedence", () => {
    expect(getBeeperChannelSettings({
      channels: {
        beeper: {
          gatewayUrl: "ws://channel",
          importSources: ["dashboard"],
        },
      },
      plugins: {
        entries: {
          beeper: {
            config: {
              enabled: true,
              gatewayUrl: "ws://plugin-entry",
              registrationUrl: "http://bridge",
            },
          },
        },
      },
    })).toEqual({
      enabled: true,
      gatewayUrl: "ws://channel",
      importSources: ["dashboard"],
      registrationUrl: "http://bridge",
    });

    expect(createConfigFromOpenClawSetup({
      plugins: {
        entries: {
          beeper: {
            config: {
              gatewayUrl: "ws://plugin-entry",
              registrationUrl: "http://bridge",
            },
          },
        },
      },
    })).toMatchObject({
      gatewayUrl: "ws://plugin-entry",
      registrationUrl: "http://bridge",
    });
  });
});
