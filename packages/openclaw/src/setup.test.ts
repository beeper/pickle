import {
  installChannelActionsContractSuite,
  installChannelPluginContractSuite,
  installChannelSetupContractSuite,
  installChannelStatusContractSuite,
} from "openclaw/plugin-sdk/channel-test-helpers";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./openclaw-extension";
import setupEntry from "./setup-entry";
import {
  BeeperChannelRuntime,
  setBeeperChannelRuntimeForHost,
} from "./beeper-channel-runtime";
import { BeeperTurnStream } from "@beeper/pickle-bridge/beeper-stream";
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
  setBeeperOpenClawPluginRuntime,
  startBeeperGatewayAccount,
  validateBeeperSetupInput,
} from "./setup";
import { createConfigFromOpenClawSetup } from "./config";

const appserviceMocks = vi.hoisted(() => ({
  startOpenClawBeeperBridge: vi.fn(),
}));

vi.mock("./appservice", () => appserviceMocks);

describe("OpenClaw Beeper official channel contracts", () => {
  installChannelPluginContractSuite({ plugin: beeperChannelPlugin });

  installChannelActionsContractSuite({
    plugin: beeperChannelPlugin,
    cases: [{
      name: "default Beeper message actions",
      cfg: {},
      expectedActions: [
        "delete",
        "edit",
        "mark_unread",
        "react",
        "read",
        "send",
        "set-room-avatar",
        "set-room-name",
        "set-room-topic",
      ],
    }],
  });

  installChannelSetupContractSuite({
    plugin: beeperChannelPlugin,
    cases: [{
      name: "non-login setup environment patch",
      cfg: {},
      input: {
        beeperEnv: "staging",
      },
      assertPatchedConfig: (cfg) => {
        expect(getBeeperChannelSettings(cfg)).toMatchObject({
          beeperEnv: "staging",
          enabled: true,
        });
      },
      assertResolvedAccount: (account) => {
        expect(account).toMatchObject({
          accountId: "default",
          configured: false,
        });
      },
    }],
  });

  installChannelStatusContractSuite({
    plugin: beeperChannelPlugin,
    cases: [
      {
        name: "configured account",
        cfg: applyBeeperChannelSettings({}, {
          asToken: "as",
          enabled: true,
          homeserver: "https://matrix.example",
          hsToken: "hs",
          matrixDeviceId: "DEV",
          matrixUserId: "@alice:example",
        }),
        expectedState: "configured",
        runtime: { accountId: "default", configured: true, enabled: true, running: true },
        resolveStateInput: { configured: true, enabled: true },
        assertSnapshot: (snapshot) => {
          expect(snapshot).toMatchObject({
            accountId: "default",
            configured: true,
            enabled: true,
            name: "Beeper",
            running: true,
          });
        },
        assertSummary: (summary) => {
          expect(summary).toMatchObject({
            configured: true,
            enabled: true,
            running: true,
          });
        },
      },
      {
        name: "disabled account",
        cfg: applyBeeperChannelSettings({}, { enabled: false }),
        expectedState: "disabled",
        resolveStateInput: { configured: false, enabled: false },
      },
    ],
  });
});

describe("OpenClaw Beeper setup surface", () => {
  beforeEach(() => {
    appserviceMocks.startOpenClawBeeperBridge.mockReset();
    setBeeperOpenClawPluginRuntime(undefined);
  });

  it("exposes a channel plugin through the setup entry shape OpenClaw loads", () => {
    expect(extension.channelPlugin).toBe(beeperChannelPlugin);
    expect(beeperChannelPlugin).toMatchObject({
      id: "beeper",
      meta: {
        id: "beeper",
        label: "Beeper",
      },
      capabilities: {
        media: true,
        nativeCommands: true,
        reactions: true,
        threads: true,
      },
      threading: expect.any(Object),
      reload: {
        configPrefixes: ["channels.beeper"],
      },
      gateway: {
        startAccount: expect.any(Function),
        stopAccount: expect.any(Function),
      },
      uiHints: {},
    });
    expect(beeperChannelPlugin.setup).toBe(beeperSetupAdapter);
    expect(beeperChannelPlugin.setupWizard).toBe(beeperSetupWizard);
  });

  it("matches the OpenClaw channel contract surface used by the dashboard and runtime", async () => {
    expect(beeperChannelPlugin.id).toBe("beeper");
    expect(beeperChannelPlugin.meta).toEqual(expect.objectContaining({
      blurb: expect.any(String),
      docsPath: "/channels/beeper",
      id: "beeper",
      label: "Beeper",
      selectionLabel: expect.any(String),
    }));
    expect(beeperChannelPlugin.capabilities.chatTypes).toEqual(["direct", "thread"]);
    expect(beeperChannelPlugin.message).toEqual(expect.objectContaining({
      durableFinal: expect.objectContaining({
        capabilities: expect.objectContaining({
          media: true,
          messageSendingHooks: true,
          replyTo: true,
          text: true,
          thread: true,
        }),
      }),
      live: expect.objectContaining({
        capabilities: expect.objectContaining({
          nativeStreaming: true,
          previewFinalization: true,
          progressUpdates: true,
          quietFinalization: true,
        }),
      }),
      send: expect.objectContaining({
        media: expect.any(Function),
        payload: expect.any(Function),
        text: expect.any(Function),
      }),
    }));
    expect(beeperChannelPlugin.outbound).toEqual(expect.objectContaining({
      deliveryMode: "direct",
      sendMedia: expect.any(Function),
      sendPayload: expect.any(Function),
      sendText: expect.any(Function),
    }));
    expect(beeperChannelPlugin.messaging).toEqual(expect.objectContaining({
      defaultMarkdownTableMode: "bullets",
      normalizeTarget: expect.any(Function),
      resolveOutboundSessionRoute: expect.any(Function),
      targetPrefixes: ["beeper", "agent", "openclaw"],
    }));
    expect(beeperChannelPlugin.messaging.normalizeTarget("openclaw:codex")).toBe("codex");
    await expect(beeperChannelPlugin.messaging.targetResolver.resolveTarget({
      cfg: {} as OpenClawSetupConfig,
      input: "agent:codex",
      normalized: "agent:codex",
    })).resolves.toMatchObject({
      display: "@codex",
      kind: "user",
      source: "normalized",
      to: "codex",
    });
    expect(beeperChannelPlugin.conversationBindings).toEqual(expect.objectContaining({
      buildBoundReplyPayload: expect.any(Function),
      defaultTopLevelPlacement: "current",
      supportsCurrentConversationBinding: true,
    }));
    expect(beeperChannelPlugin.directory).toEqual(expect.objectContaining({
      listPeers: expect.any(Function),
    }));
    await expect(beeperChannelPlugin.directory.listPeers({
      cfg: {
        agents: {
          list: [
            { id: "codex", name: "Codex" },
            { id: "planner", name: "Planner" },
          ],
        },
      } as unknown as OpenClawSetupConfig,
      query: "code",
    })).resolves.toEqual([{
      handle: "codex",
      id: "codex",
      kind: "user",
      name: "Codex",
      raw: { id: "codex", name: "Codex" },
    }]);
    await expect(beeperChannelPlugin.resolver.resolveTargets({
      cfg: {
        agents: { list: [{ id: "codex", name: "Codex" }] },
      } as unknown as OpenClawSetupConfig,
      inputs: ["beeper:codex", "agent:unknown"],
      kind: "user",
    })).resolves.toEqual([
      { id: "codex", input: "beeper:codex", name: "Codex", resolved: true },
      { id: "unknown", input: "agent:unknown", name: "@unknown", resolved: true },
    ]);
    expect(beeperChannelPlugin.heartbeat).toEqual(expect.objectContaining({
      sendTyping: expect.any(Function),
    }));
    expect(beeperChannelPlugin.approvalCapability).toEqual(expect.any(Object));
    expect(beeperChannelPlugin.approvalCapability.render.exec.buildPendingPayload({
      nowMs: 123,
      request: {
        approvalId: "approval_1",
        command: "shell date",
        toolCallId: "tool_1",
        toolName: "shell",
      },
    })).toMatchObject({
      body: "Approval requested: shell date",
      content: {
        body: "Approval requested: shell date",
        msgtype: "m.notice",
        "com.beeper.ai": {
          parts: [{
            approval: {
              actions: expect.arrayContaining([
                expect.objectContaining({ id: "allow-once", reactionKey: "approval.allow_once" }),
                expect.objectContaining({ id: "deny", reactionKey: "approval.deny" }),
              ]),
              id: "approval_1",
            },
            id: "tool_1",
            name: "shell",
            state: "approval-requested",
            toolCallId: "tool_1",
            type: "tool-call",
          }],
          role: "assistant",
        },
      },
    });
    expect(beeperChannelPlugin.actions).toEqual(expect.any(Object));
    expect(beeperChannelPlugin.actions.describeMessageTool()).toMatchObject({
      actions: [
        "send",
        "edit",
        "delete",
        "react",
        "read",
        "mark_unread",
        "set-room-name",
        "set-room-topic",
        "set-room-avatar",
      ],
      capabilities: [],
    });
    expect(beeperChannelPlugin.actions.extractToolSend({
      args: { action: "send", threadId: "$thread", to: "beeper:!room" },
    })).toBeNull();
    expect(beeperChannelPlugin.agentPrompt).toEqual(expect.objectContaining({
      inboundFormattingHints: expect.any(Function),
      messageToolCapabilities: expect.any(Function),
      reactionGuidance: expect.any(Function),
    }));
    expect(beeperChannelPlugin.agentPrompt.messageToolCapabilities()).toEqual(["reactions"]);
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
      input: {},
    });
    expect(cfg).not.toHaveProperty("then");
    expect(getBeeperChannelSettings(cfg)).toMatchObject({ enabled: true });
  });

  it("starts the Beeper bridge from OpenClaw gateway lifecycle and stops on abort", async () => {
    const stop = vi.fn(async () => undefined);
    appserviceMocks.startOpenClawBeeperBridge.mockResolvedValueOnce({ stop });
    const abort = new AbortController();
    const statuses: unknown[] = [];
    const channelRuntime = {
      reply: { dispatchReplyWithBufferedBlockDispatcher: vi.fn() },
      session: { recordInboundSession: vi.fn() },
      inbound: { buildContext: vi.fn(), dispatchReply: vi.fn() },
    };
    const cfg = applyBeeperChannelSettings({}, {
      asToken: "as",
      dataDir: "/tmp/openclaw-beeper",
      enabled: true,
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });

    const task = startBeeperGatewayAccount({
      abortSignal: abort.signal,
      accountId: "default",
      cfg,
      channelRuntime,
      setStatus: (next) => statuses.push(next),
    } as never);
    await vi.waitFor(() => expect(appserviceMocks.startOpenClawBeeperBridge).toHaveBeenCalledOnce());
    expect(appserviceMocks.startOpenClawBeeperBridge).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        dataDir: "/tmp/openclaw-beeper",
      }),
      dataDir: "/tmp/openclaw-beeper",
      runtime: expect.objectContaining({
        channel: channelRuntime,
        config: expect.objectContaining({ current: expect.any(Function) }),
      }),
    }));
    const runtime = appserviceMocks.startOpenClawBeeperBridge.mock.calls[0]?.[0]?.runtime as { config?: { current?: () => unknown } };
    expect(runtime.config?.current?.()).toBe(cfg);
    expect(statuses).toContainEqual(expect.objectContaining({ running: true }));
    abort.abort();
    await task;
    expect(stop).toHaveBeenCalledOnce();
    expect(statuses).toContainEqual(expect.objectContaining({ running: false }));
  });

  it("shares one running Beeper bridge startup per account", async () => {
    const stop = vi.fn(async () => undefined);
    appserviceMocks.startOpenClawBeeperBridge.mockResolvedValueOnce({ stop });
    const abort = new AbortController();
    const cfg = applyBeeperChannelSettings({}, {
      asToken: "as",
      dataDir: "/tmp/openclaw-beeper",
      enabled: true,
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });
    const ctx = {
      abortSignal: abort.signal,
      accountId: "default",
      cfg,
    } as never;

    const first = startBeeperGatewayAccount(ctx);
    const second = startBeeperGatewayAccount(ctx);
    await vi.waitFor(() => expect(appserviceMocks.startOpenClawBeeperBridge).toHaveBeenCalledOnce());
    abort.abort();
    await Promise.all([first, second]);

    expect(appserviceMocks.startOpenClawBeeperBridge).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("rejects gateway startup until Beeper setup has complete credentials", async () => {
    await expect(startBeeperGatewayAccount({
      abortSignal: new AbortController().signal,
      accountId: "default",
      cfg: applyBeeperChannelSettings({}, {
        enabled: true,
      }),
    })).rejects.toThrow("not fully configured");
  });

  it("exposes the lightweight OpenClaw setup-entry contract", () => {
    expect(setupEntry).toMatchObject({
      plugin: beeperChannelPlugin,
    });
  });

  it("applies dashboard setup input into non-login channels.beeper settings", async () => {
    const cfg = await beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        beeperEnv: "staging",
      },
    });
    expect(getBeeperChannelSettings(cfg)).toEqual({
      beeperEnv: "staging",
      enabled: true,
    });
    expect(isBeeperChannelConfigured(cfg)).toBe(false);
    expect(cfg.plugins?.entries?.beeper).toBeUndefined();
  });

  it("keeps async Beeper login out of the synchronous OpenClaw setup adapter", () => {
    expect(() => beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        email: "alice@example.com",
      },
    })).toThrow("Beeper login is asynchronous");

    expect(() => beeperSetupAdapter.applyAccountConfig({
      accountId: "default",
      cfg: {},
      input: {
        password: "secret",
        username: "alice",
      },
    })).toThrow("Beeper login is asynchronous");
  });

  it("runs Beeper login and appservice registration from dashboard setup wizard input", async () => {
    const progress = {
      stop: () => {},
      update: () => {},
    };
    const promptValues: Record<string, string> = {
      "Beeper email": "alice@example.com",
      "Beeper login code": "123456",
    };
    const result = await beeperSetupWizard.configureInteractive({
      cfg: {},
      prompter: {
        confirm: async ({ message }) => message === "Post bridge state to Beeper" ? false : true,
        multiselect: async () => ["dashboard", "tui"],
        progress: () => progress,
        select: async ({ message }) => {
          if (message === "Beeper login method") return "email";
          if (message === "Beeper contact visibility") return "agents";
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
          expect(options.env).toBe("production");
          expect(options).not.toHaveProperty("bridgeManagerToken");
          expect(options).not.toHaveProperty("homeserverDomain");
          expect(await options.getLoginCode?.()).toBe("123456");
          return {
            account: {
              accessToken: "at",
              deviceId: "DEV",
              homeserver: "https://matrix.example",
              userId: "@alice:example",
            },
            config: {
              appserviceId: "sh-openclaw-dev",
              asToken: "as",
              bridgeId: "sh-openclaw-dev",
              homeserver: "https://matrix.example",
              hsToken: "hs",
              matrixDeviceId: "DEV",
              matrixUserId: "@alice:example",
            },
            init: {
              homeserver: "https://matrix.example",
              registration: {
                asToken: "as",
                id: "sh-openclaw-dev",
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
      asToken: "as",
      bridgeId: "sh-openclaw-dev",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });
  });

  it("infers generated bridge settings from username/password setup input", async () => {
    const { applyBeeperSetupConfig } = await import("./setup");
    const cfg = await applyBeeperSetupConfig({
      cfg: {},
      input: {
        beeperEnv: "dev",
        password: "secret",
        username: "alice",
      },
      runtime: {
        setupBridge: async (options) => {
          expect(options.email).toBeUndefined();
          expect(options.env).toBe("dev");
          expect(options.password).toBe("secret");
          expect(options.username).toBe("alice");
          return {
            account: {
              accessToken: "at",
              deviceId: "DEV",
              homeserver: "https://matrix.example",
              userId: "@alice:example",
            },
            config: {
              appserviceId: "sh-openclaw-dev",
              asToken: "as",
              bridgeId: "sh-openclaw-dev",
              homeserver: "https://matrix.example",
              hsToken: "hs",
              matrixDeviceId: "DEV",
              matrixUserId: "@alice:example",
            },
            init: {
              homeserver: "https://matrix.example",
              registration: {
                asToken: "as",
                id: "sh-openclaw-dev",
                hsToken: "hs",
                url: "http://127.0.0.1:29391",
              },
            } as never,
          };
        },
      },
    });
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
      appserviceId: "sh-openclaw-dev",
      asToken: "as",
      beeperEnv: "dev",
      bridgeId: "sh-openclaw-dev",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });
  });

  it("does not report configured until login, appservice, and gateway details are present", async () => {
    expect(isBeeperChannelConfigured(applyBeeperChannelSettings({}, {
      enabled: true,
    }))).toBe(false);
    const cfg = applyBeeperChannelSettings({}, {
      asToken: "as",
      enabled: true,
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });
    expect(isBeeperChannelConfigured(cfg)).toBe(true);
  });

  it("applies setup input through the channel setup adapter implementation", async () => {
    const { applyBeeperSetupConfig } = await import("./setup");
    const cfg = await applyBeeperSetupConfig({
      cfg: {},
      input: {
        beeperEnv: "dev",
        code: "123456",
        email: "alice@example.com",
      },
      runtime: {
        setupBridge: async (options) => {
          expect(options.email).toBe("alice@example.com");
          expect(options.env).toBe("dev");
          expect(options).not.toHaveProperty("bridgeManagerToken");
          expect(options).not.toHaveProperty("homeserverDomain");
          expect(await options.getLoginCode?.()).toBe("123456");
          return {
            account: {
              accessToken: "at",
              deviceId: "DEV",
              homeserver: "https://matrix.example",
              userId: "@alice:example",
            },
            config: {
              appserviceId: "sh-openclaw-dev",
              asToken: "as",
              bridgeId: "sh-openclaw-dev",
              homeserver: "https://matrix.example",
              hsToken: "hs",
              matrixDeviceId: "DEV",
              matrixUserId: "@alice:example",
            },
            init: {
              homeserver: "https://matrix.example",
              registration: {
                asToken: "as",
                id: "sh-openclaw-dev",
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
      appserviceId: "sh-openclaw-dev",
      asToken: "as",
      bridgeId: "sh-openclaw-dev",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });
  });

  it("defaults new setup to owned chats only", async () => {
    expect(defaultBeeperChannelSettings()).toMatchObject({
      enabled: true,
    });
    const configured = await beeperSetupWizard.configure({ cfg: {} });
    expect(getBeeperChannelSettings(configured.cfg)).toMatchObject({
      enabled: true,
    });
  });

  it("reports setup status and validates dashboard input", async () => {
    expect(validateBeeperSetupInput({ email: "not-email" })).toContain("valid email");
    expect(validateBeeperSetupInput({ username: "alice" })).toContain("requires both");
    expect(validateBeeperSetupInput({ email: "alice@example.com", username: "alice", password: "secret" })).toContain("only one");
    const cfg = applyBeeperChannelSettings({}, {
      enabled: true,
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
    }));
    const snapshot = beeperStatusAdapter.buildAccountSnapshot({ account });

    expect(snapshot).toMatchObject({
      accountId: "default",
      configured: false,
      enabled: true,
      running: false,
    });
    expect(beeperStatusAdapter.buildChannelSummary({ snapshot })).toMatchObject({
      configured: false,
      enabled: true,
      running: false,
    });
    expect(beeperStatusAdapter.resolveAccountState({ configured: false, enabled: true })).toBe("not configured");
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
          homeserver: "https://matrix.example",
          hsToken: "hs",
          matrixDeviceId: "DEV",
          matrixUserId: "@alice:example",
        },
      },
    });
    expect(cfg).toMatchObject({
      dataDir: "/tmp/beeper",
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
    });
  });

  it("routes OpenClaw message actions through the active Beeper runtime", async () => {
	    const client = {
	      appservice: { sendMessage: vi.fn(async () => ({ eventId: "$as" })) },
      beeper: {
        aiRuns: createTestBeeperAIRuns(),
        aiRunStreams: createTestBeeperAIRunStreams(),
        streams: {
          finalizeMessage: vi.fn(async () => ({ replacementEventId: "$replace", roomId: "!room", raw: {} })),
          publishPart: vi.fn(async () => undefined),
          startMessage: vi.fn(async () => ({ descriptor: { type: "com.beeper.llm" }, eventId: "$stream" })),
        },
      },
	      media: { upload: vi.fn(async () => ({ contentUri: "mxc://example/file", raw: {} })) },
	      messages: {
        edit: vi.fn(async () => ({ eventId: "$edit" })),
        redact: vi.fn(async () => undefined),
        send: vi.fn(async () => ({ eventId: "$send" })),
        sendMedia: vi.fn(async () => ({ eventId: "$media" })),
      },
      reactions: {
        redact: vi.fn(async () => undefined),
        send: vi.fn(async () => ({ eventId: "$reaction" })),
      },
	      typing: { set: vi.fn(async () => undefined) },
	    };
    const queued: unknown[] = [];
    const bridge = {
      createBeeperTurnStream: vi.fn((options) => new BeeperTurnStream({
        ...options,
        client: client as never,
      })),
      flushRemoteEvents: vi.fn(async () => undefined),
      getPortalByMXID: vi.fn(() => ({ portalKey: { id: "session:one", receiver: "openclaw:plugin" } })),
      queueRemoteEvent: vi.fn((_login: unknown, event: unknown) => queued.push(event)),
    };
    const runtime = new BeeperChannelRuntime({
	      bridge: bridge as never,
      getAgents: () => [{
        avatarMxc: "mxc://avatar",
        description: "Helpful coding agent",
        agentId: "codex",
        displayName: "Codex",
	        ghostUserId: "@codex:example",
	      }],
	      getBindingByRoom: () => ({
	        agentId: "codex",
	        createdAt: 1,
	        ghostUserId: "@codex:example",
	        id: "binding",
	        kind: "session",
	        owner: "bridge",
	        roomId: "!room",
	        sessionKey: "session_1",
	        updatedAt: 1,
	      }),
	      login: { id: "openclaw:plugin" },
	    });
    const hostRuntime = {};
    setBeeperOpenClawPluginRuntime(hostRuntime);
    setBeeperChannelRuntimeForHost(hostRuntime, runtime);
    runtime.createStreamPublisher({
      agentId: "codex",
      roomId: "!room",
      runId: "run_1",
      sessionKey: "session_1",
    });

	    const sentMessageId = "openclaw:message:test";

    await beeperChannelPlugin.actions.handleAction({
      action: "send",
      params: { message: "hello from tool" },
      sessionKey: "session_1",
    });
    expect(client.beeper.aiRunStreams.start).toHaveBeenCalledWith(expect.objectContaining({
      initialEvents: [expect.objectContaining({
        delta: "hello from tool",
        type: "TEXT_MESSAGE_CONTENT",
      })],
      runId: "run_1",
    }));
    expect(client.beeper.aiRunStreams.appendEvent).not.toHaveBeenCalled();

	    await beeperChannelPlugin.actions.handleAction({
	      action: "react",
	      params: { eventId: sentMessageId, emoji: "+1", roomId: "!room" },
	    });
	    expect(client.reactions.send).not.toHaveBeenCalled();

	    await beeperChannelPlugin.heartbeat.sendTyping({ to: "!room" });
	    expect(client.typing.set).not.toHaveBeenCalled();
	    await beeperChannelPlugin.actions.handleAction({
	      action: "edit",
	      params: { eventId: sentMessageId, message: "edited", roomId: "!room" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "delete",
	      params: { eventId: sentMessageId, roomId: "!room" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "read",
	      params: { eventId: sentMessageId, roomId: "!room" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "mark_unread",
	      params: { eventId: sentMessageId, roomId: "!room" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "set-room-name",
	      params: { name: "Agent room", roomId: "!room" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "set-room-topic",
	      params: { roomId: "!room", topic: "Planning" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "set-room-avatar",
	      params: { avatarMxc: "mxc://example/avatar2", roomId: "!room" },
	    });
	    expect(queued.map((event) => (event as { getType: () => string }).getType())).toEqual([
	      "reaction",
	      "typing",
	      "edit",
	      "message_remove",
	      "read_receipt",
	      "mark_unread",
	      "chat_info_change",
	      "chat_info_change",
	      "chat_info_change",
	    ]);

    await expect(beeperChannelPlugin.directory.listPeersLive({
      cfg: {} as OpenClawSetupConfig,
    })).resolves.toEqual([{
      avatarUrl: "mxc://avatar",
      description: "Helpful coding agent",
      handle: "codex",
      id: "codex",
      kind: "user",
      name: "Codex",
      raw: {
        avatarMxc: "mxc://avatar",
        description: "Helpful coding agent",
        agentId: "codex",
        displayName: "Codex",
        ghostUserId: "@codex:example",
      },
    }]);
  });

  it("lists saved bridge registry agents as directory contacts without live runtime", async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "pickle-openclaw-directory-"));
    await fs.writeFile(path.join(dataDir, "registry.json"), JSON.stringify({
      agents: [{
        agentId: "codex",
        avatarMxc: "mxc://avatar",
        description: "Helpful coding agent",
        displayName: "Codex",
        ghostUserId: "@codex:example",
      }],
      bindings: [],
      dedupe: {},
      schemaVersion: 1,
    }));
    setBeeperOpenClawPluginRuntime(undefined);

    await expect(beeperChannelPlugin.directory.listPeers({
      cfg: { channels: { beeper: { dataDir } } } as OpenClawSetupConfig,
      query: "helpful",
    })).resolves.toEqual([{
      avatarUrl: "mxc://avatar",
      description: "Helpful coding agent",
      handle: "codex",
      id: "codex",
      kind: "user",
      name: "Codex",
      raw: {
        agentId: "codex",
        avatarMxc: "mxc://avatar",
        description: "Helpful coding agent",
        displayName: "Codex",
        ghostUserId: "@codex:example",
      },
    }]);
  });

  it("reads plugin-entry channel config with channels.beeper taking precedence", () => {
    expect(getBeeperChannelSettings({
      channels: {
        beeper: {
          beeperEnv: "staging",
        },
      },
      plugins: {
        entries: {
          beeper: {
            config: {
              enabled: true,
            },
          },
        },
      },
    })).toEqual({
      beeperEnv: "staging",
    });

    expect(createConfigFromOpenClawSetup({ plugins: { entries: { beeper: { config: { enabled: true } } } } })).toMatchObject({
      appserviceId: "sh-openclaw",
    });
  });
});

function createTestBeeperAIRuns() {
  const snapshot = (runId: string, events: Record<string, unknown>[] = []) => ({
    body: "...",
    events,
    finalAIMessage: {},
    initialAIMessage: {},
    metadata: {},
    messageId: runId,
    runId,
    threadId: runId,
  });
  return {
    appendEvent: vi.fn(async ({ event, runId }: { event: Record<string, unknown>; runId: string }) =>
      snapshot(runId, [event])),
    begin: vi.fn(async ({ runId, threadId }: { runId: string; threadId?: string }) =>
      snapshot(runId, [
        { runId, threadId: threadId ?? runId, type: "RUN_STARTED" },
        { messageId: runId, role: "assistant", type: "TEXT_MESSAGE_START" },
      ])),
    delete: vi.fn(async () => undefined),
    error: vi.fn(async ({ message, runId }: { message?: string; runId: string }) =>
      snapshot(runId, [{ message, runId, type: "RUN_ERROR" }])),
    finish: vi.fn(async ({ finishReason, runId }: { finishReason?: string; runId: string }) =>
      snapshot(runId, [{ finishReason: finishReason ?? "stop", runId, type: "RUN_FINISHED" }])),
  };
}

function createTestBeeperAIRunStreams() {
  const result = (runId: string, events: Record<string, unknown>[] = []) => ({
    body: "...",
    descriptor: { type: "com.beeper.llm" },
    eventId: "$stream",
    events,
    finalAIMessage: {},
    initialAIMessage: {},
    messageId: `msg-${runId}`,
    metadata: {},
    raw: {},
    replacementEventId: "$replace",
    roomId: "!room",
    runId,
    threadId: runId,
  });
  return {
    appendEvent: vi.fn(async ({ event, runId }: { event: Record<string, unknown>; runId: string }) =>
      result(runId, [event])),
    error: vi.fn(async ({ message, runId }: { message?: string; runId: string }) =>
      result(runId, [{ message, runId, type: "RUN_ERROR" }])),
    finish: vi.fn(async ({ finishReason, runId }: { finishReason?: string; runId: string }) =>
      result(runId, [{ finishReason: finishReason ?? "stop", runId, type: "RUN_FINISHED" }])),
    start: vi.fn(async ({ runId }: { runId: string }) =>
      result(runId, [
        { runId, threadId: runId, type: "RUN_STARTED" },
        { messageId: `msg-${runId}`, role: "assistant", type: "TEXT_MESSAGE_START" },
      ])),
  };
}
