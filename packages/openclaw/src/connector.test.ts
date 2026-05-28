import type { MatrixEdit, MatrixMessage, MatrixReaction, MatrixReactionRemove, MatrixRedaction, UserLogin } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawConnector, OpenClawNetworkAPI, parseMatrixTextMessage, userLoginFromOpenClawConfig } from "./connector";
import { OpenClawPluginRuntimeAdapter, type OpenClawGatewayEvent, type OpenClawRuntimeRequestSurface } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClawBridgeConnector", () => {
  it("exposes bridgev2-shaped metadata and direct plugin capabilities", async () => {
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
    expect(() => connector.createLogin({} as never, { id: "@alice:example.com" }, "openclaw.gateway")).toThrow("direct plugin mode");
  });

  it("keeps Beeper Matrix tokens out of OpenClaw plugin login metadata", () => {
    expect(userLoginFromOpenClawConfig(createDefaultConfig({
      accessToken: "matrix-token",
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
      responses: { "agents.list": { agents: [{ id: "codex", name: "Codex" }] } },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });
    const registerGhost = vi.fn();
    await api.connect({ bridge: { registerGhost }, queue: vi.fn(), queueRemoteEvent: vi.fn() } as unknown as Parameters<typeof api.connect>[0]);
    expect(registerGhost).toHaveBeenCalledWith({
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
    });
  });

  it("honors contact visibility when registering ghosts", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    registry.upsertUser({ displayName: "Alice", ghostUserId: "@alice-ghost:example.com", userId: "alice" });
    const runtime = runtimeWith({ responses: { "agents.list": { agents: [] } } });
    runtime.config.contactVisibility = "agents-and-users";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const registerGhost = vi.fn();
    await api.connect({ bridge: { registerGhost }, queue: vi.fn(), queueRemoteEvent: vi.fn() } as unknown as Parameters<typeof api.connect>[0]);
    expect(registerGhost).toHaveBeenCalledWith(expect.objectContaining({ id: "alice", mxid: "@alice-ghost:example.com" }));

    const hidden = runtimeWith({ responses: { "agents.list": { agents: [] } } });
    hidden.config.contactVisibility = "none";
    const hiddenApi = new OpenClawNetworkAPI({
      config: hidden.config,
      login: login(),
      registry,
      runtime: hidden,
    });
    const hiddenRegisterGhost = vi.fn();
    await hiddenApi.connect({ bridge: { registerGhost: hiddenRegisterGhost }, queue: vi.fn(), queueRemoteEvent: vi.fn() } as unknown as Parameters<typeof hiddenApi.connect>[0]);
    expect(hiddenRegisterGhost).not.toHaveBeenCalled();
  });

  it("resolves agent identifiers into DM portals", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime: runtimeWith({ responses: { "sessions.create": { key: "agent:codex:session_1" } } }),
    });
    await expect(api.resolveIdentifier({ bridge: { createPortal: vi.fn() } } as unknown as BridgeRequestContext, {
      createDM: false,
      identifier: "codex",
      type: "username",
    })).resolves.toEqual({
      ghost: {
        displayName: "Codex",
        id: "codex",
        metadata: {
          openclaw: {
            agentId: "codex",
            displayName: "Codex",
            ghostUserId: "@codex:example.com",
          },
        },
        mxid: "@codex:example.com",
      },
      userId: "@codex:example.com",
    });

    const createPortal = vi.fn(async () => ({
      id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8x",
      metadata: {
        openclaw: {
          agentId: "codex",
          label: "Codex",
          ghostUserId: "@codex:example.com",
          sessionKey: "agent:codex:session_1",
        },
      },
      mxid: "!codex-dm:example.com",
      portalKey: { id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8x", receiver: "login" },
      receiver: "login",
    }));
    await expect(api.resolveIdentifier({ bridge: { createPortal } } as unknown as BridgeRequestContext, {
      createDM: true,
      identifier: "codex",
      type: "username",
    })).resolves.toEqual({
      ghost: {
        displayName: "Codex",
        id: "codex",
        metadata: {
          openclaw: {
            agentId: "codex",
            displayName: "Codex",
            ghostUserId: "@codex:example.com",
          },
        },
        mxid: "@codex:example.com",
      },
      portal: {
        id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8x",
        metadata: {
          openclaw: {
            agentId: "codex",
            ghostUserId: "@codex:example.com",
            label: "Codex",
            sessionKey: "agent:codex:session_1",
          },
        },
        portalKey: { id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8x", receiver: "login" },
        receiver: "login",
        roomType: "dm",
        mxid: "!codex-dm:example.com",
      },
      userId: "@codex:example.com",
    });
    expect(createPortal).toHaveBeenCalledWith(login(), {
      creationContent: { "m.federate": false },
      id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8x",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
          label: "Codex",
          sessionKey: "agent:codex:session_1",
        },
      },
      name: "Codex",
      roomType: "dm",
    });
    expect(registry.getBindingByRoom("!codex-dm:example.com")).toMatchObject({
      agentId: "codex",
      roomId: "!codex-dm:example.com",
      sessionKey: "agent:codex:session_1",
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
      kind: "session",
      owner: "bridge",
      roomId: "!existing-codex-dm:example.com",
      sessionKey: "agent:codex",
      updatedAt: 1,
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime: runtimeWith({ responses: { "sessions.create": { key: "agent:codex:session_2" } } }),
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
        id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8y",
        mxid: "!second-codex-dm:example.com",
        portalKey: { id: "session:YWdlbnQ6Y29kZXg6c2Vzc2lvbl8y", receiver: "openclaw:plugin" },
      },
      userId: "@codex:example.com",
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
        userId: "@sh-openclaw_agent_codex:localhost",
      }],
    });
  });

  it("applies contact visibility to Beeper contact listing", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-contacts-test.json");
    registry.upsertUser({
      displayName: "Alice from Telegram",
      ghostUserId: "@sh-openclaw_user_alice:example.com",
      source: "telegram",
      userId: "alice",
    });
    const runtime = runtimeWith({
      responses: {
        "agents.list": {
          agents: [{ id: "codex", name: "Codex" }],
        },
      },
    });
    runtime.config.contactVisibility = "agents-and-users";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });

    await expect(api.listContacts({} as BridgeRequestContext, { query: "telegram" })).resolves.toEqual({
      contacts: [{
        ghost: {
          displayName: "Alice from Telegram",
          id: "alice",
          metadata: {
            openclaw: {
              displayName: "Alice from Telegram",
              ghostUserId: "@sh-openclaw_user_alice:example.com",
              source: "telegram",
              userId: "alice",
            },
          },
          mxid: "@sh-openclaw_user_alice:example.com",
        },
        userId: "@sh-openclaw_user_alice:example.com",
      }],
    });

    runtime.config.contactVisibility = "none";
    await expect(api.listContacts({} as BridgeRequestContext, {})).resolves.toEqual({ contacts: [] });
  });

  it("drops disallowed rooms, users, and bridge-owned ghost senders before forwarding to OpenClaw", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    const runtime = runtimeWith({
      responses: {
        "sessions.create": { key: "agent:codex:session_1" },
        "beeper.turn": { runId: "run_1", sessionKey: "agent:codex:session_1" },
      },
    });
    runtime.config.allowedRoomIds = ["!allowed:example.com"];
    runtime.config.allowedUserIds = ["@alice:example.com"];
    runtime.config.matrixUserId = "@sh-openclawbot:example.com";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const portal = {
      id: "agent:codex",
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com", sessionKey: "agent:codex" } },
      mxid: "!blocked:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$blocked-room" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "hello",
    } as MatrixMessage);
    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$blocked-user" },
      portal: { ...portal, mxid: "!allowed:example.com" },
      sender: { userId: "@mallory:example.com" },
      text: "hello",
    } as MatrixMessage);
    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$ghost" },
      portal: { ...portal, mxid: "!allowed:example.com" },
      sender: { userId: "@codex:example.com" },
      text: "hello",
    } as MatrixMessage);

    expect(runtime.transport.request).not.toHaveBeenCalled();
  });

  it("accepts the Beeper owner MXID as a sender in self-hosted cloud rooms", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-owner-sender-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_owner", type: "run.completed" } }],
      responses: {
        "beeper.turn": { runId: "run_owner", sessionKey: "agent:main:main" },
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
    const sessionKey = "agent:main:main";
    const roomId = `!session:${Buffer.from(sessionKey).toString("base64url")}.openclaw:plugin:beeper.local`;

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

    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      sessionKey,
      message: "hello from owner",
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
          sessionKey: "agent:codex",
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
      kind: "session",
      lastRunId: "run_previous",
      lastStreamRunId: "run_previous",
      lastStreamTargetEventId: "$old",
      owner: "bridge",
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
          sessionKey: "agent:codex",
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
            sessionKey: "agent:codex",
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
      kind: "session",
      lastRunId: "run_streamed",
      lastStreamRunId: "run_streamed",
      lastStreamTargetEventId: "$old",
      owner: "bridge",
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
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com", sessionKey: "agent:codex" } },
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
      key: expect.stringMatching(/^agent:main:beeper:/u),
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
      id: "session:YWdlbnQ6bWFpbjphdXRv",
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
        id: "session:YWdlbnQ6bWFpbjphdXRv",
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
    runtime.config.approvalBehavior = "native";
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

    runtime.config.approvalBehavior = "disabled";
    await api.handleMatrixMessage({} as BridgeRequestContext, {
      content: {
        approvalId: "approval_native_disabled",
        approved: true,
        type: "tool-approval-response",
      },
      event: { eventId: "$native-disabled" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "Approved",
    } as MatrixMessage);
    expect(runtime.transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_native_disabled",
      decision: "approve",
    });
    expect(runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$native-disabled",
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

    runtime.config.approvalBehavior = "disabled";
    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$approve-disabled" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/approve approval_2",
    } as MatrixMessage);
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: "$approve-disabled",
      message: "/approve approval_2",
      sessionKey: "agent:codex:session_1",
    }));

  });

  it("rebuilds an OpenClaw room binding from a persisted Pickle session portal without metadata", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-rebuild-binding-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_rebuilt", type: "run.completed" } }],
      responses: {
        "beeper.turn": { runId: "run_rebuilt", sessionKey: "agent:codex:dashboard:one" },
      },
    });
    runtime.config.homeserverDomain = "example.com";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const sessionKey = "agent:codex:dashboard:one";
    const portal = {
      id: `session:${Buffer.from(sessionKey).toString("base64url")}`,
      mxid: "!session-room:example.com",
      portalKey: { id: `session:${Buffer.from(sessionKey).toString("base64url")}`, receiver: "openclaw:plugin" },
      receiver: "openclaw:plugin",
    };

    await api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$rebuilt" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "hello from persisted portal",
    } as MatrixMessage);

    expect(registry.getBindingByRoom("!session-room:example.com")).toMatchObject({
      agentId: "codex",
      ghostUserId: "@sh-openclaw_agent_codex:example.com",
      owner: "imported",
      sessionKey,
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "hello from persisted portal",
      sessionKey,
    }));
  });

  it("rebuilds an OpenClaw room binding from a cloud appservice session room id", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-cloud-room-binding-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_cloud", type: "run.completed" } }],
      responses: {
        "beeper.turn": { runId: "run_cloud", sessionKey: "agent:main:dashboard:abc" },
      },
    });
    runtime.config.homeserverDomain = "beeper.local";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const sessionKey = "agent:main:dashboard:abc";
    const roomId = `!session:${Buffer.from(sessionKey).toString("base64url")}.openclaw:plugin:beeper.local`;

    await api.handleMatrixMessage({
      log: vi.fn(),
    } as unknown as BridgeRequestContext, {
      event: { eventId: "$cloud-room" },
      portal: {
        id: roomId,
        mxid: roomId,
        portalKey: { id: roomId },
      },
      sender: { userId: "@alice:example.com" },
      text: "hello from cloud room",
    } as MatrixMessage);

    expect(registry.getBindingByRoom(roomId)).toMatchObject({
      agentId: "main",
      ghostUserId: "@sh-openclaw_agent_main:beeper.local",
      owner: "imported",
      sessionKey,
    });
    expect(runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      message: "hello from cloud room",
      sessionKey,
    }));
  });

  it("fetches OpenClaw chat history for Pickle backfill", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "chat.history": {
          messages: [
            { content: "hello", id: "m1", messageSeq: 1, role: "user", timestamp: "2026-05-16T11:59:00.000Z" },
            { content: "hi", id: "m2", messageSeq: 2, role: "assistant", timestamp: 1_779_000_000 },
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
    const portal = {
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
          sessionKey: "agent:codex",
        },
      },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    const response = await api.fetchMessages({} as BridgeRequestContext, { limit: 2, portal });
    expect(response.hasMore).toBe(false);
    expect(response.messages).toHaveLength(2);
    expect(response.messages.map((message) => message.event.getID())).toEqual(["m1", "m2"]);
    expect(response.messages.map((message) => message.event.getSender().sender)).toEqual(["@sh-openclawbot:localhost", "@codex:example.com"]);
    expect(response.messages.map((message) => message.event.getTimestamp())).toEqual([
      new Date("2026-05-16T11:59:00.000Z"),
      new Date(1_779_000_000_000),
    ]);
    expect(runtime.transport.request).toHaveBeenCalledWith("chat.history", {
      limit: 2,
      sessionKey: "agent:codex",
    });
  });
});

function login(): UserLogin {
  return { id: "openclaw:plugin", metadata: {}, userId: "@alice:example.com" };
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
