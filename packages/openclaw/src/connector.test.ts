import type { MatrixEdit, MatrixMessage, MatrixReaction, MatrixReactionRemove, MatrixRedaction, UserLogin } from "@beeper/pickle-bridge/types";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawConnector, OpenClawNetworkAPI, parseMatrixTextMessage, userLoginFromOpenClawConfig } from "./connector";
import { OpenClawPluginRuntimeAdapter, type OpenClawGatewayEvent, type OpenClawRuntimeRequestSurface } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClawBridgeConnector", () => {
  it("exposes bridgev2-shaped metadata and Beeper channel capabilities", async () => {
    const connector = createOpenClawConnector({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    });
    expect(connector.getName()).toMatchObject({
      beeperBridgeType: "openclaw",
      defaultCommandPrefix: "!openclaw",
      displayName: "OpenClaw",
      networkId: "openclaw",
    });
    expect(connector.getCapabilities().provisioning?.resolveIdentifier).toEqual({
      contactList: true,
      createDM: true,
      lookupUsername: true,
    });
    expect(connector.getLoginFlows()).toEqual([]);
    expect(() => connector.createLogin({} as never, { id: "@alice:example.com" }, "openclaw.gateway")).toThrow("Beeper channel runtime");
  });

  it("keeps Beeper Matrix tokens out of OpenClaw plugin login metadata", () => {
    expect(userLoginFromOpenClawConfig(createDefaultConfig({
      dataDir: "/tmp/openclaw",
    }))).toMatchObject({
      id: "openclaw:plugin",
      metadata: {},
    });
  });

  it("loads the OpenClaw remote login automatically on connector start", async () => {
    const connector = createOpenClawConnector({
      config: createDefaultConfig({
        dataDir: "/tmp/openclaw",
        matrixUserId: "@batuhan:beeper.com",
      }),
    });
    const loadUserLogin = vi.fn(async () => undefined);
    await connector.start({
      bridge: { loadUserLogin },
      log: vi.fn(),
    } as never);

    expect(loadUserLogin).toHaveBeenCalledWith(expect.objectContaining({
      id: "openclaw:plugin",
      remoteName: "OpenClaw",
      userId: "@batuhan:beeper.com",
    }));
  });

  it("registers the live Beeper runtime in OpenClaw channel runtime contexts", async () => {
    const register = vi.fn();
    const connector = createOpenClawConnector({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      registry: new OpenClawBridgeRegistry("/tmp/openclaw-connector-runtime-context-test.json"),
      runtime: {
        channel: {
          runtimeContexts: { register },
        },
      } as never,
    });

    await connector.init({
      bridge: {
        getOwnUserId: () => "@openclaw:example.com",
      },
      client: {},
      log: vi.fn(),
    } as never);

    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      accountId: "default",
      capability: "beeper.runtime",
      channelId: "beeper",
      context: connector.getChannelRuntime(),
    }));
  });

  it("loads a network API that registers OpenClaw agents as ghosts", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [{ avatarMxc: "mxc://example/codex", id: "codex", name: "Codex" }] },
        "sessions.create": { key: "agent:codex:beeper:bootstrap" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const { ctx, registerGhost } = connectContext();
    await api.connect(ctx);
    expect(registerGhost).toHaveBeenCalledWith({
      avatar: {
        id: "mxc://example/codex",
        mxc: "mxc://example/codex",
        url: "mxc://example/codex",
      },
      displayName: "Codex",
      id: "codex",
      identifiers: ["openclaw:agent:codex", "@sh-openclaw_agent_codex:localhost"],
      isBot: true,
      metadata: {
        openclaw: {
          agentId: "codex",
          avatarMxc: "mxc://example/codex",
          avatarUrl: "mxc://example/codex",
          displayName: "Codex",
          ghostUserId: "@sh-openclaw_agent_codex:localhost",
        },
      },
      mxid: "@sh-openclaw_agent_codex:localhost",
      profile: {
        "com.beeper.openclaw.agent": {
          agentId: "codex",
          avatarMxc: "mxc://example/codex",
          avatarUrl: "mxc://example/codex",
          displayName: "Codex",
          ghostUserId: "@sh-openclaw_agent_codex:localhost",
        },
      },
    });
  });

  it("creates a stable welcome room for each agent without starting a session turn", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-bootstrap-test.json");
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [
          { id: "main", name: "Main" },
          { id: "codex", name: "Codex" },
        ] },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const { createPortal, ctx, registerPortal, sendMessage } = connectContext();
    createPortal.mockImplementation(async (_login, portal) => ({
      ...portal,
      mxid: portal.id === "agent:main" ? "!main:example.com" : "!codex:example.com",
      portalKey: { id: portal.id, receiver: "openclaw:plugin" },
      receiver: "openclaw:plugin",
    }));

    await api.connect(ctx);

    expect(createPortal).toHaveBeenCalledTimes(2);
    expect(createPortal).toHaveBeenCalledWith(login(), expect.objectContaining({
      creationContent: { "m.federate": false },
      id: "agent:main",
      metadata: {
        openclaw: {
          agentId: "main",
          ghostUserId: "@sh-openclaw_agent_main:localhost",
          label: "Main",
        },
      },
      name: "Main",
      roomType: "dm",
      sender: "@sh-openclaw_agent_main:localhost",
    }));
    expect(createPortal).toHaveBeenCalledWith(login(), expect.objectContaining({
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@sh-openclaw_agent_codex:localhost",
          label: "Codex",
        },
      },
      name: "Codex",
      roomType: "dm",
      sender: "@sh-openclaw_agent_codex:localhost",
    }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(runtime.sendMessage).not.toHaveBeenCalled();
    expect(registerPortal).toHaveBeenCalledWith(expect.objectContaining({
      mxid: "!main:example.com",
      portalKey: expect.objectContaining({ receiver: "openclaw:plugin" }),
    }));
    expect(registry.getBindingByRoom("!main:example.com")).toMatchObject({
      agentId: "main",
      id: "agent:main",
    });
    expect(registry.getBindingByRoom("!codex:example.com")).toMatchObject({
      agentId: "codex",
      id: "agent:codex",
    });
  });

  it("does not create another welcome room on a later connect", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-bootstrap-repeat-test.json");
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [{ id: "main", name: "Main" }] },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const { createPortal, ctx, sendMessage } = connectContext();
    createPortal.mockImplementation(async (_login, portal) => ({
      ...portal,
      mxid: "!main:example.com",
      portalKey: { id: portal.id, receiver: "openclaw:plugin" },
      receiver: "openclaw:plugin",
    }));

    await api.connect(ctx);
    await api.connect(ctx);

    expect(createPortal).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(registry.getBindingById("agent:main")).toMatchObject({
      agentId: "main",
      roomId: "!main:example.com",
    });
  });

  it("creates only one welcome room when connect is called concurrently", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-bootstrap-concurrent-test.json");
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [] },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const { createPortal, ctx, sendMessage } = connectContext();
    let unblockCreatePortal!: () => void;
    createPortal.mockImplementationOnce(async (_login, portal) => {
      await new Promise<void>((resolve) => { unblockCreatePortal = resolve; });
      return {
        ...portal,
        mxid: "!bootstrap:example.com",
        portalKey: { id: portal.id, receiver: "openclaw:plugin" },
        receiver: "openclaw:plugin",
      };
    });

    const first = api.connect(ctx);
    const second = api.connect(ctx);
    await vi.waitFor(() => expect(createPortal).toHaveBeenCalledOnce());
    unblockCreatePortal();
    await Promise.all([first, second]);

    expect(createPortal).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(registry.getBindingByRoom("!bootstrap:example.com")).toBeDefined();
  });

  it("still creates an agent welcome room when only a session room exists", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-bootstrap-existing-test.json");
    registry.upsertBinding({
      agentId: "main",
      createdAt: 1,
      ghostUserId: "@main:example.com",
      id: "existing",
      roomId: "!existing:example.com",
      sessionKey: "agent:main:existing",
      updatedAt: 1,
    });
    const runtime = runtimeWith({
      responses: { "agents.list": { agents: [] } },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const { createPortal, ctx, sendMessage } = connectContext();

    await api.connect(ctx);

    expect(createPortal).toHaveBeenCalledWith(login(), expect.objectContaining({
      id: "agent:main",
      metadata: {
        openclaw: {
          agentId: "main",
          ghostUserId: "@sh-openclaw_agent_main:localhost",
          label: "main",
        },
      },
    }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(runtime.sendMessage).not.toHaveBeenCalled();
    expect(registry.getBindingsByAgent("main")).toHaveLength(2);
  });

  it("registers current agent ghosts only", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
        "sessions.create": { key: "agent:codex:beeper:bootstrap" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const { ctx, registerGhost } = connectContext();
    await api.connect(ctx);
    expect(registerGhost).toHaveBeenCalledWith(expect.objectContaining({ id: "codex", mxid: "@sh-openclaw_agent_codex:localhost" }));
  });

  it("keeps existing agent room bindings aligned to the latest ghost profile", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-ghost-sync-test.json");
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@old-codex:example.com",
      id: "agent:codex",
      label: "Old Codex",
      roomId: "!codex:example.com",
      updatedAt: 1,
    });
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const { ctx } = connectContext();

    await api.connect(ctx);

    expect(registry.getBindingById("agent:codex")).toMatchObject({
      ghostUserId: "@sh-openclaw_agent_codex:localhost",
      label: "Codex",
    });
  });

  it("resolves agent identifiers into DM portals", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime: runtimeWith({ responses: { "agents.list": { agents: [{ id: "codex", name: "Codex" }] } } }),
    });
    await expect(api.resolveIdentifier({ bridge: { createPortal: vi.fn() } } as unknown as BridgeRequestContext, {
      createDM: false,
      identifier: "codex",
      type: "username",
    })).resolves.toEqual({
      ghost: codexGhost(),
      userId: "@sh-openclaw_agent_codex:localhost",
    });

    const createPortal = vi.fn(async (loginArg, options) => ({
      id: options.id,
      metadata: options.metadata,
      mxid: "!codex-dm:example.com",
      portalKey: { id: options.id, receiver: loginArg.id },
      receiver: loginArg.id,
    }));
    await expect(api.resolveIdentifier({ bridge: { createPortal } } as unknown as BridgeRequestContext, {
      createDM: true,
      identifier: "codex",
      type: "username",
    })).resolves.toMatchObject({
      ghost: {
        displayName: "Codex",
        id: "codex",
        metadata: {
          openclaw: {
            agentId: "codex",
            displayName: "Codex",
            ghostUserId: "@sh-openclaw_agent_codex:localhost",
          },
        },
        mxid: "@sh-openclaw_agent_codex:localhost",
      },
      portal: {
        id: expect.stringMatching(/^conversation:/),
        metadata: {
          openclaw: {
            agentId: "codex",
            ghostUserId: "@sh-openclaw_agent_codex:localhost",
            label: "Codex",
          },
        },
        portalKey: { id: expect.stringMatching(/^conversation:/), receiver: "openclaw:plugin" },
        receiver: "openclaw:plugin",
        roomType: "dm",
        mxid: "!codex-dm:example.com",
      },
      userId: "@sh-openclaw_agent_codex:localhost",
    });
    expect(createPortal).toHaveBeenCalledWith(login(), expect.objectContaining({
      creationContent: { "m.federate": false },
      id: expect.stringMatching(/^conversation:/),
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@sh-openclaw_agent_codex:localhost",
          label: "Codex",
        },
      },
      name: "Codex",
      roomType: "dm",
      sender: "@sh-openclaw_agent_codex:localhost",
    }));
    expect(registry.getBindingByRoom("!codex-dm:example.com")).toMatchObject({
      agentId: "codex",
      roomId: "!codex-dm:example.com",
    });
  });

  it("does not synthesize Beeper DMs for unknown OpenClaw agents", async () => {
    const runtime = runtimeWith({
      responses: {
        "agents.list": { agents: [{ id: "codex", name: "Codex" }] },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry: new OpenClawBridgeRegistry("/tmp/openclaw-connector-unknown-agent-test.json"),
      runtime,
    });
    const createPortal = vi.fn();

    await expect(api.resolveIdentifier({ bridge: { createPortal } } as unknown as BridgeRequestContext, {
      createDM: true,
      identifier: "not-an-agent",
      type: "username",
    })).resolves.toEqual({});

    expect(createPortal).not.toHaveBeenCalled();
  });

  it("creates a fresh DM portal even when the same agent already has a room", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-existing-dm-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@codex:example.com",
      id: "existing",
      roomId: "!existing-codex-dm:example.com",
      updatedAt: 1,
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime: runtimeWith({ responses: { "agents.list": { agents: [{ id: "codex", name: "Codex" }] } } }),
    });
    const createPortal = vi.fn(async (loginArg, options) => ({
      id: options.id,
      metadata: options.metadata,
      mxid: "!second-codex-dm:example.com",
      portalKey: { id: options.id, receiver: loginArg.id },
      receiver: loginArg.id,
    }));

    await expect(api.resolveIdentifier({ bridge: { createPortal } } as unknown as BridgeRequestContext, {
      createDM: true,
      identifier: "codex",
      type: "username",
    })).resolves.toMatchObject({
      portal: {
        id: expect.stringMatching(/^conversation:/),
        mxid: "!second-codex-dm:example.com",
        portalKey: { id: expect.stringMatching(/^conversation:/), receiver: "openclaw:plugin" },
      },
      userId: "@sh-openclaw_agent_codex:localhost",
    });
    expect(createPortal).toHaveBeenCalledOnce();
    expect(registry.getBindingsByAgent("codex")).toHaveLength(2);
  });

  it("lists searchable OpenClaw agent contacts for Beeper contact lists", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "agents.list": {
          agents: [
            { id: "codex", name: "Codex" },
            { id: "planner", name: "Planner" },
          ],
        },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });

    await expect(api.listContacts({} as BridgeRequestContext, { query: "code" })).resolves.toEqual({
      contacts: [{
        ghost: codexGhost(),
        userId: "@sh-openclaw_agent_codex:localhost",
      }],
    });
  });

  it("lists current agent contacts", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-contacts-test.json");
    const runtime = runtimeWith({
      responses: {
        "agents.list": {
          agents: [{ id: "codex", name: "Codex" }],
        },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });

    await expect(api.listContacts({} as BridgeRequestContext, { query: "codex" })).resolves.toEqual({
      contacts: [{
        ghost: codexGhost(),
        userId: "@sh-openclaw_agent_codex:localhost",
      }],
    });
  });

  it("drops bridge-owned ghost senders before forwarding to OpenClaw", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    const runtime = runtimeWith({
      responses: {
        "sessions.create": { key: "agent:codex:session_1" },
        "beeper.turn": { runId: "run_1", sessionKey: "agent:codex:session_1" },
      },
    });
    runtime.config.matrixUserId = "@sh-openclawbot:example.com";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const portal = {
      id: "agent:codex",
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com" } },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$alice" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "hello",
    } as MatrixMessage);
    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$mallory" },
      portal,
      sender: { userId: "@mallory:example.com" },
      text: "hello",
    } as MatrixMessage);
    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$ghost" },
      portal,
      sender: { userId: "@codex:example.com" },
      text: "hello",
    } as MatrixMessage);

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$alice",
      sessionKey: "agent:codex:session_1",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$mallory",
      sessionKey: "agent:codex:session_1",
    }));
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$ghost",
    }));
  });

  it("accepts the Beeper owner MXID as a sender in self-hosted rooms", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-owner-sender-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_owner", type: "run.completed" } }],
      responses: {
        "sessions.create": { key: "agent:main:owner" },
        "beeper.turn": { runId: "run_owner", sessionKey: "agent:main:owner" },
      },
    });
    runtime.config.matrixUserId = "@owner:beeper-staging.com";
    runtime.config.homeserverDomain = "beeper.local";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const roomId = "!owner-room:beeper.local";

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$owner" },
      portal: {
        id: roomId,
        mxid: roomId,
        portalKey: { id: roomId },
      },
      sender: { userId: "@owner:beeper-staging.com" },
      text: "hello from owner",
    } as MatrixMessage);

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      agentId: "main",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "hello from owner",
      sessionKey: "agent:main:owner",
    }));
  });

  it("dispatches Matrix text and native approval responses to OpenClaw", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_1", type: "run.completed" } }],
      responses: {
        "exec.approval.resolve": { ok: true },
        "sessions.create": { key: "agent:codex:session_1" },
        "beeper.turn": { runId: "run_1", sessionKey: "agent:codex:session_1" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const portal = {
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
        },
      },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    const queueRemoteEvent = vi.fn();
    await expect(api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
      event: { eventId: "$message" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "hello",
    } as MatrixMessage)).resolves.toEqual({ pending: false });
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      idempotencyKey: "$message",
      matrix: {
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      },
      message: "hello",
      sessionKey: "agent:codex:session_1",
    });
    expect(registry.getBindingByRoom("!room:example.com")).toMatchObject({
      agentId: "codex",
      sessionKey: "agent:codex:session_1",
    });

    await expect(api.handleMatrixReaction({} as BridgeRequestContext, {
      content: {
        "m.relates_to": { event_id: "approval_1", key: "approval.deny" },
      },
      event: { eventId: "$reaction" },
      portal,
      targetMessage: { id: "approval_1" },
    } as MatrixReaction)).resolves.toEqual({
      id: "$reaction",
      metadata: {
        openclaw: {
          approval: {
            approvalId: "approval_1",
            approved: false,
            approvedAlways: false,
            decision: "deny",
          },
          ignored: "approval-reactions-disabled",
        },
      },
    });
    expect(runtime.transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "deny",
    });

    await expect(api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
      content: {
        approvalId: "approval_2",
        approved: true,
        approvedAlways: true,
        toolCallId: "tool_1",
        type: "tool-approval-response",
      },
      event: { eventId: "$native-approval" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "Approved",
    } as MatrixMessage)).resolves.toEqual({ pending: false });
    expect(runtime.transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_2",
      decision: "approve_always",
      toolCallId: "tool_1",
    });
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$native-approval",
    }));
  });

  it("handles OpenClaw slash commands as normal agent turns without Matrix side notices", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-slash-command-test.json");
    const runtime = runtimeWith({
      responses: {
        "sessions.create": { key: "agent:codex:session_1" },
        "beeper.turn": { runId: "run_1", sessionKey: "agent:codex:session_1" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const { ctx, sendMessage } = connectContext();
    const portal = {
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
        },
      },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await expect(api.handleMatrixMessage(ctx as unknown as BridgeRequestContext, {
      content: { body: "/session", msgtype: "m.text" },
      event: { eventId: "$session-command" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/session",
    } as MatrixMessage)).resolves.toEqual({ pending: false });

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$session-command",
      matrix: expect.objectContaining({
        command: { args: "", name: "session" },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      }),
      message: "/session",
      sessionKey: "agent:codex:session_1",
    }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(registry.getBindingByRoom("!room:example.com")).toMatchObject({
      sessionKey: "agent:codex:session_1",
    });
  });

  it("parses Matrix replies and slash commands for OpenClaw turns", async () => {
    expect(parseMatrixTextMessage("> <@alice> old\n\nnew text", {
      "m.relates_to": {
        "m.in_reply_to": { event_id: "$old" },
      },
    })).toEqual({
      attachments: [],
      replyQuote: {
        body: "old",
        sender: "@alice",
      },
      replyToEventId: "$old",
      text: "new text",
    });
    expect(parseMatrixTextMessage("/stop", {})).toEqual({
      attachments: [],
      command: { args: "", name: "stop" },
      text: "/stop",
    });
    expect(parseMatrixTextMessage("@bot:example.com /status", {})).toEqual({
      attachments: [],
      command: { args: "", name: "status" },
      text: "@bot:example.com /status",
    });
    expect(parseMatrixTextMessage("photo", {
      "m.mentions": { room: true, user_ids: ["@bob:example.com"] },
      formatted_body: "<strong>photo</strong>",
      msgtype: "m.image",
      url: "mxc://example/photo",
    }, {
      attachments: [{ contentType: "image/png", contentUri: "mxc://example/photo", filename: "photo.png", height: 10, kind: "image", size: 12, width: 10 }],
      event: { html: "<strong>photo</strong>", mentions: { room: true, userIds: ["@bob:example.com"] }, threadRoot: "$thread" },
      threadRoot: { id: "$thread-message" },
    } as never)).toEqual({
      attachments: [{
        contentType: "image/png",
        contentUri: "mxc://example/photo",
        filename: "photo.png",
        height: 10,
        kind: "image",
        size: 12,
        width: 10,
      }],
      formattedBody: "<strong>photo</strong>",
      mentions: { room: true, userIds: ["@bob:example.com"] },
      text: "photo",
      threadRootEventId: "$thread-message",
    });
    expect(parseMatrixTextMessage("* old text", {
      "m.new_content": {
        body: "corrected",
        formatted_body: "<strong>corrected</strong>",
        msgtype: "m.text",
      },
      "m.relates_to": {
        event_id: "$old",
        rel_type: "m.replace",
      },
      formatted_body: "* old text",
    })).toEqual({
      attachments: [],
      formattedBody: "<strong>corrected</strong>",
      text: "corrected",
    });
    expect(parseMatrixTextMessage("> <@alice> old\n\nnew text", {
      "m.relates_to": {
        "m.in_reply_to": { event_id: "$old" },
      },
      formatted_body: '<mx-reply><blockquote><a href="https://matrix.to/#/$old">In reply</a><br />old</blockquote></mx-reply><strong>new text</strong>',
    })).toEqual({
      attachments: [],
      formattedBody: "<strong>new text</strong>",
      replyQuote: {
        body: "old",
        sender: "@alice",
      },
      replyToEventId: "$old",
      text: "new text",
    });

    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@codex:example.com",
      id: "binding-reply",
      lastRunId: "run_previous",
      lastStreamRunId: "run_previous",
      lastStreamTargetEventId: "$old",
      roomId: "!room:example.com",
      sessionKey: "agent:codex:session_2",
      updatedAt: 1,
    });
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_2", type: "run.completed" } }],
      responses: {
        "sessions.create": { key: "agent:codex:session_2" },
        "beeper.turn": { runId: "run_2", sessionKey: "agent:codex:session_2" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const portal = {
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
        },
      },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      attachments: [{ contentType: "image/png", contentUri: "mxc://example/photo", filename: "photo.png", kind: "image" }],
      content: {
        "m.relates_to": {
          "m.in_reply_to": { event_id: "$old" },
        },
      },
      event: { eventId: "$reply" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "> <@alice> old\n\nnew text",
    } as MatrixMessage);
    expect(runtime.sendMessage).toHaveBeenCalledWith({
      attachments: [{ contentType: "image/png", contentUri: "mxc://example/photo", filename: "photo.png", kind: "image" }],
      idempotencyKey: "$reply",
      matrix: {
        attachments: [{ contentType: "image/png", contentUri: "mxc://example/photo", filename: "photo.png", kind: "image" }],
        relation: {
          kind: "reply",
          quote: {
            body: "old",
            sender: "@alice",
          },
          replyToEventId: "$old",
          targetRunId: "run_previous",
          targetSessionKey: "agent:codex:session_2",
        },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      },
      message: "new text",
      replyTo: { eventId: "$old", roomId: "!room:example.com" },
      sessionKey: "agent:codex:session_2",
    });

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      content: {},
      event: { eventId: "$status" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/status",
    } as MatrixMessage);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$status",
      matrix: expect.objectContaining({
        command: { args: "", name: "status" },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      }),
      message: "/status",
      sessionKey: "agent:codex:session_2",
    }));
  });

  it("passes Matrix formatted body, mentions, and thread metadata to OpenClaw", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_thread", type: "run.completed" } }],
      responses: {
        "sessions.create": { key: "agent:codex:session_thread" },
        "beeper.turn": { runId: "run_thread", sessionKey: "agent:codex:session_thread" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      content: {
        "m.mentions": { room: true, user_ids: ["@bob:example.com"] },
        "m.relates_to": {
          event_id: "$thread-root",
          rel_type: "m.thread",
        },
        formatted_body: "<strong>hello</strong>",
      },
      event: { eventId: "$thread-message" },
      portal: {
        id: "agent:codex",
        metadata: {
          openclaw: {
            agentId: "codex",
            ghostUserId: "@codex:example.com",
          },
        },
        mxid: "!room:example.com",
        portalKey: { id: "agent:codex", receiver: "login" },
        receiver: "login",
      },
      sender: { userId: "@alice:example.com" },
      text: "hello",
    } as MatrixMessage);

    expect(runtime.sendMessage).toHaveBeenCalledWith({
      idempotencyKey: "$thread-message",
      matrix: {
        formattedBody: "<strong>hello</strong>",
        mentions: { room: true, userIds: ["@bob:example.com"] },
        relation: {
          kind: "thread",
          replyToEventId: "$thread-root",
          threadRootEventId: "$thread-root",
        },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
        threadRootEventId: "$thread-root",
      },
      message: "hello",
      replyTo: { eventId: "$thread-root", roomId: "!room:example.com" },
      sessionKey: "agent:codex:session_thread",
    });
  });

  it("forwards Matrix edits, redactions, and non-approval reactions as session context", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@codex:example.com",
      id: "binding-relations",
      lastRunId: "run_streamed",
      lastStreamRunId: "run_streamed",
      lastStreamTargetEventId: "$old",
      roomId: "!room:example.com",
      sessionKey: "agent:codex:session_1",
      updatedAt: 1,
    });
    const runtime = runtimeWith({
      events: [
        { event: "run.completed", payload: { runId: "run_edit", type: "run.completed" } },
        { event: "run.completed", payload: { runId: "run_reaction", type: "run.completed" } },
        { event: "run.completed", payload: { runId: "run_redaction", type: "run.completed" } },
      ],
      responses: {
        "sessions.create": { key: "agent:codex:session_1" },
        "beeper.turn": { runId: "run_edit", sessionKey: "agent:codex:session_1" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const portal = {
      id: "agent:codex",
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com" } },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixEdit({} as BridgeRequestContext, {
      content: {
        "m.new_content": {
          body: "corrected",
          formatted_body: "<strong>corrected</strong>",
          msgtype: "m.text",
        },
        "m.relates_to": {
          event_id: "$old",
          rel_type: "m.replace",
        },
      },
      event: { eventId: "$edit" },
      existing: [],
      portal,
      sender: { userId: "@alice:example.com" },
      targetMessage: { id: "$old" },
      text: "* typo",
    } as MatrixEdit);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$edit:edit",
      matrix: {
        formattedBody: "<strong>corrected</strong>",
        relation: {
          kind: "edit",
          targetEventId: "$old",
          targetRunId: "run_streamed",
          targetSessionKey: "agent:codex:session_1",
        },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      },
      message: "corrected",
      replyTo: { eventId: "$old", roomId: "!room:example.com" },
    }));

    await expect(api.handleMatrixReaction({} as BridgeRequestContext, {
      content: { "m.relates_to": { event_id: "$old", key: "👍", rel_type: "m.annotation" } },
      event: { eventId: "$react", sender: "@alice:example.com" },
      portal,
      targetMessage: { id: "$old" },
    } as MatrixReaction)).resolves.toEqual({
      id: "$react",
      metadata: { openclaw: { reaction: "👍", targetMessageId: "$old" } },
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$react",
      matrix: {
        relation: {
          key: "👍",
          kind: "reaction",
          targetEventId: "$old",
          targetRunId: "run_streamed",
          targetSessionKey: "agent:codex:session_1",
        },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      },
      message: "Reacted 👍 to $old",
      replyTo: { eventId: "$old", roomId: "!room:example.com" },
    }));

    await api.handleMatrixReactionRemove({} as BridgeRequestContext, {
      content: { "m.relates_to": { event_id: "$old", key: "👍", rel_type: "m.annotation" } },
      event: { eventId: "$react-redact", sender: "@alice:example.com" },
      portal,
      targetMessage: { id: "$old" },
      targetReaction: { id: "$react" },
    } as MatrixReactionRemove);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$react-redact",
      matrix: {
        relation: {
          key: "👍",
          kind: "reaction_remove",
          targetEventId: "$old",
          targetReactionId: "$react",
          targetRunId: "run_streamed",
          targetSessionKey: "agent:codex:session_1",
        },
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      },
      message: "Removed reaction 👍 from $old",
      replyTo: { eventId: "$old", roomId: "!room:example.com" },
    }));

    await api.handleMatrixRedaction({} as BridgeRequestContext, {
      eventId: "$redact",
      portal,
      targetMessage: { id: "$old" },
    } as MatrixRedaction);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$redact",
      matrix: {
        relation: {
          kind: "redaction",
          targetEventId: "$old",
          targetRunId: "run_streamed",
          targetSessionKey: "agent:codex:session_1",
        },
        roomId: "!room:example.com",
        sender: "redaction",
      },
      message: "Redacted message $old",
      replyTo: { eventId: "$old", roomId: "!room:example.com" },
    }));
  });

  it("auto-binds unbound Beeper rooms before forwarding chat turns", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "sessions.create": { key: "agent:main:auto" },
        "beeper.turn": { runId: "run_auto", sessionKey: "agent:main:auto" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const log = vi.fn();
    const registerPortal = vi.fn();
    const ctx = { bridge: { registerPortal }, log, queueRemoteEvent: vi.fn() } as unknown as BridgeRequestContext;
    const portal = {
      id: "!cloud-room:example.com",
      mxid: "!cloud-room:example.com",
      portalKey: { id: "!cloud-room:example.com", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$hello" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "hey",
    } as MatrixMessage);

    expect(log).toHaveBeenCalledWith("warn", "openclaw_matrix_message_unbound_room", expect.objectContaining({
      roomId: "!cloud-room:example.com",
    }));
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      agentId: "main",
      label: "New OpenClaw Session",
    }));
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$hello",
      message: "hey",
      sessionKey: "agent:main:auto",
    }));
    expect(registry.getBindingByRoom("!cloud-room:example.com")).toMatchObject({
      agentId: "main",
      label: "New OpenClaw Session",
      sessionKey: "agent:main:auto",
    });
    expect(registerPortal).toHaveBeenCalledWith(expect.objectContaining({
      id: "!cloud-room:example.com",
      metadata: {
        openclaw: {
          agentId: "main",
          ghostUserId: "@sh-openclaw_agent_main:localhost",
          label: "New OpenClaw Session",
          sessionKey: "agent:main:auto",
        },
      },
      mxid: "!cloud-room:example.com",
      portalKey: {
        id: "!cloud-room:example.com",
        receiver: "openclaw:plugin",
      },
      receiver: "openclaw:plugin",
    }));
  });

  it("rejects reaction approvals and forwards slash approval text as regular turns", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "exec.approval.resolve": { ok: true },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const portal = {
      id: "agent:codex",
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com", sessionKey: "agent:codex:session_1" } },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await expect(api.handleMatrixReaction({} as BridgeRequestContext, {
      content: { "m.relates_to": { event_id: "approval_1", key: "approval.deny" } },
      event: { eventId: "$reaction" },
      portal,
      targetMessage: { id: "approval_1" },
    } as MatrixReaction)).resolves.toMatchObject({
      metadata: { openclaw: { ignored: "approval-reactions-disabled" } },
    });
    expect(runtime.transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", expect.anything());

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      content: {
        approvalId: "approval_native",
        approved: true,
        type: "tool-approval-response",
      },
      event: { eventId: "$native" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "Approved",
    } as MatrixMessage);
    expect(runtime.transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_native",
      decision: "approve",
    });
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$native",
    }));

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$approve" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/approve approval_1",
    } as MatrixMessage);
    expect(runtime.transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$approve",
      message: "/approve approval_1",
      sessionKey: "agent:codex:session_1",
    }));

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      content: {
        "m.relates_to": {
          "m.in_reply_to": { event_id: "approval_1_reply" },
        },
      },
      event: { eventId: "$deny-reply" },
      portal,
      replyTo: { id: "approval_1_reply" },
      sender: { userId: "@alice:example.com" },
      text: "/deny",
    } as MatrixMessage);
    expect(runtime.transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1_reply",
      decision: "deny",
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$deny-reply",
      message: "/deny",
      sessionKey: "agent:codex:session_1",
    }));

  });

});

function login(): UserLogin {
  return { id: "openclaw:plugin", metadata: {}, userId: "@alice:example.com" };
}

function codexGhost() {
  const contact = {
    agentId: "codex",
    displayName: "Codex",
    ghostUserId: "@sh-openclaw_agent_codex:localhost",
  };
  return {
    displayName: "Codex",
    id: "codex",
    identifiers: ["openclaw:agent:codex", "@sh-openclaw_agent_codex:localhost"],
    isBot: true,
    metadata: { openclaw: contact },
    mxid: "@sh-openclaw_agent_codex:localhost",
    profile: { "com.beeper.openclaw.agent": contact },
  };
}

function connectContext() {
  const registerGhost = vi.fn(async () => {});
  const registerPortal = vi.fn();
  const createPortal = vi.fn(async (_login: UserLogin, portal: { id: string; metadata?: unknown; portalKey?: { id: string; receiver?: string } }) => ({
    ...portal,
    mxid: "!bootstrap:example.com",
    portalKey: { id: portal.id, receiver: "openclaw:plugin" },
    receiver: "openclaw:plugin",
  }));
  const sendMessage = vi.fn(async () => ({
    eventId: "$bootstrap",
    raw: {},
    roomId: "!bootstrap:example.com",
  }));
  return {
    createPortal,
    ctx: {
      bridge: { createPortal, registerGhost, registerPortal },
      client: { appservice: { sendMessage } },
      log: vi.fn(),
      queue: vi.fn(),
      queueRemoteEvent: vi.fn(),
    } as unknown as Parameters<OpenClawNetworkAPI["connect"]>[0],
    registerGhost,
    registerPortal,
    sendMessage,
  };
}

function runtimeWith(options: {
  events?: OpenClawGatewayEvent[];
  responses: Record<string, unknown>;
}): OpenClawPluginRuntimeAdapter & {
  sendMessage: ReturnType<typeof vi.fn>;
  transport: OpenClawRuntimeRequestSurface & { request: ReturnType<typeof vi.fn> };
} {
  const transport = {
    async *events(filter?: (event: OpenClawGatewayEvent) => boolean) {
      for (const event of options.events ?? []) {
        if (!filter || filter(event)) yield event;
      }
    },
    request: vi.fn(async (method: string) => options.responses[method]),
  };
  const runtime = new OpenClawPluginRuntimeAdapter({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawPluginRuntimeAdapter & {
    sendMessage: ReturnType<typeof vi.fn>;
    transport: OpenClawRuntimeRequestSurface & { request: ReturnType<typeof vi.fn> };
  };
  runtime.sendMessage = vi.fn(async (params: { sessionKey: string }) => {
    const response = options.responses["beeper.turn"];
    if (response instanceof Error) throw response;
    return response ?? { runId: "run_1", sessionKey: params.sessionKey };
  });
  return runtime;
}
