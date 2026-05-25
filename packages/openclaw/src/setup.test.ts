import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "./openclaw-extension";
import setupEntry from "./setup-entry";
import {
  BeeperChannelRuntime,
  setBeeperChannelRuntime,
} from "./beeper-channel-runtime";
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
    setBeeperChannelRuntime(undefined);
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
        threads: false,
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

  it("matches the OpenClaw channel contract surface used by the dashboard and runtime", async () => {
    expect(beeperChannelPlugin.id).toBe("beeper");
    expect(beeperChannelPlugin.meta).toEqual(expect.objectContaining({
      blurb: expect.any(String),
      docsPath: "/channels/beeper",
      id: "beeper",
      label: "Beeper",
      selectionLabel: expect.any(String),
    }));
    expect(beeperChannelPlugin.capabilities.chatTypes).toEqual(
      ["direct"],
    );
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
      actions: ["send", "react", "read", "mark_unread"],
      capabilities: ["text", "reactions", "readReceipts", "markedUnread"],
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
      input: {
        registrationUrl: "http://127.0.0.1:29391",
      },
    });
    expect(cfg).not.toHaveProperty("then");
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
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
        bridgeId: "sh-openclaw-custom",
        bridgeManagerToken: "hungry",
        contactVisibility: "agents-and-users",
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
      bridgeId: "sh-openclaw-custom",
      bridgeManagerToken: "hungry",
      contactVisibility: "agents-and-users",
      enabled: true,
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
              appserviceId: "sh-openclaw-dev",
              asToken: "as",
              bridgeId: "sh-openclaw-dev",
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
      accessToken: "at",
      asToken: "as",
      baseDomain: "beeper.localtest.me",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry",
      bridgeId: "sh-openclaw-dev",
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
        registrationUrl: "http://127.0.0.1:29391",
      },
    });
    expect(getBeeperChannelSettings(cfg)).toMatchObject({
      accessToken: "at",
      asToken: "as",
      registrationUrl: "http://127.0.0.1:29391",
    });
  });

  it("does not report configured until login, appservice, and gateway details are present", async () => {
    expect(isBeeperChannelConfigured(applyBeeperChannelSettings({}, {
      enabled: true,
      registrationUrl: "http://bridge",
    }))).toBe(false);
    const cfg = applyBeeperChannelSettings({}, {
      accessToken: "at",
      asToken: "as",
      enabled: true,
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
              appserviceId: "sh-openclaw-dev",
              asToken: "as",
              bridgeId: "sh-openclaw-dev",
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
      accessToken: "at",
      appserviceId: "sh-openclaw-dev",
      asToken: "as",
      bridgeId: "sh-openclaw-dev",
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
        importSources: ["dashboard", "tui"],
        mode: "self-hosted-appservice",
        registrationUrl: "http://bridge",
      },
      running: false,
    });
    expect(beeperStatusAdapter.buildChannelSummary({ snapshot })).toMatchObject({
      configured: false,
      enabled: true,
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
      homeserver: "https://matrix.example",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@alice:example",
      nonFederatedRooms: false,
      registrationUrl: "http://bridge",
    });
  });

  it("routes OpenClaw message actions through the active Beeper runtime", async () => {
	    const client = {
	      appservice: { sendMessage: vi.fn(async () => ({ eventId: "$as" })) },
      beeper: {
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
	      flushRemoteEvents: vi.fn(async () => undefined),
	      getPortalByMXID: vi.fn(() => ({ portalKey: { id: "session:one", receiver: "openclaw:plugin" } })),
	      queueRemoteEvent: vi.fn((_login: unknown, event: unknown) => queued.push(event)),
	    };
    const runtime = new BeeperChannelRuntime({
	      bridge: bridge as never,
	      client: client as never,
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
	    setBeeperChannelRuntime(runtime);
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
    expect(client.beeper.streams.publishPart).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$stream",
      part: expect.objectContaining({
        delta: "hello from tool",
        type: "TEXT_MESSAGE_CONTENT",
      }),
      roomId: "!room",
      turnId: "run_1",
    }));

	    await beeperChannelPlugin.actions.handleAction({
	      action: "react",
	      params: { eventId: sentMessageId, key: "+1", to: "!room" },
	    });
	    expect(client.reactions.send).not.toHaveBeenCalled();

	    await beeperChannelPlugin.heartbeat.sendTyping({ to: "!room" });
	    expect(client.typing.set).not.toHaveBeenCalled();
	    await beeperChannelPlugin.actions.handleAction({
	      action: "read",
	      params: { eventId: sentMessageId, to: "!room" },
	    });
	    await beeperChannelPlugin.actions.handleAction({
	      action: "mark_unread",
	      params: { eventId: sentMessageId, to: "!room" },
	    });
	    expect(queued.map((event) => (event as { getType: () => string }).getType())).toEqual([
	      "reaction",
	      "typing",
	      "read_receipt",
	      "mark_unread",
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

  it("reads plugin-entry channel config with channels.beeper taking precedence", () => {
    expect(getBeeperChannelSettings({
      channels: {
        beeper: {
          importSources: ["dashboard"],
        },
      },
      plugins: {
        entries: {
          beeper: {
            config: {
              enabled: true,
              registrationUrl: "http://bridge",
            },
          },
        },
      },
    })).toEqual({
      enabled: true,
      importSources: ["dashboard"],
      registrationUrl: "http://bridge",
    });

    expect(createConfigFromOpenClawSetup({
      plugins: {
        entries: {
          beeper: {
            config: {
              registrationUrl: "http://bridge",
            },
          },
        },
      },
    })).toMatchObject({
      registrationUrl: "http://bridge",
    });
  });
});
