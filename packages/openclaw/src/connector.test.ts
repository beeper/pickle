import type { MatrixCommand, MatrixEdit, MatrixMessage, MatrixReaction, MatrixReactionRemove, MatrixRedaction, UserLogin } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawConnector, OpenClawNetworkAPI, parseMatrixTextMessage, userLoginFromOpenClawConfig } from "./connector";
import { OpenClawGatewayRuntime, type OpenClawGatewayEvent, type OpenClawTransport } from "./openclaw-runtime";
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

  it("handles slash-prefixed OpenClaw commands through management command fallback", async () => {
    const connector = createOpenClawConnector({
      config: createDefaultConfig({
        dataDir: "/tmp/openclaw",
        importSources: ["dashboard"],
      }),
    });
    const response = await connector.handleCommand({} as never, {
      args: [],
      body: "/status",
      command: "/status",
      event: { eventId: "$status", kind: "message", roomId: "!management:example" },
      prefix: "!openclaw",
      room: { mxid: "!management:example" },
      sender: { userId: "@alice:example.com" },
      text: "/status",
    } as MatrixCommand);

    expect(response).toMatchObject({
      handled: true,
      text: expect.stringContaining("Import sources: dashboard"),
    });
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
          ghostUserId: "@openclaw_agent_codex:localhost",
        },
      },
      mxid: "@openclaw_agent_codex:localhost",
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
              ghostUserId: "@openclaw_agent_codex:localhost",
            },
          },
          mxid: "@openclaw_agent_codex:localhost",
        },
        userId: "@openclaw_agent_codex:localhost",
      }],
    });
  });

  it("applies contact visibility to Beeper contact listing", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-contacts-test.json");
    registry.upsertUser({
      displayName: "Alice from Telegram",
      ghostUserId: "@openclaw_user_alice:example.com",
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
              ghostUserId: "@openclaw_user_alice:example.com",
              source: "telegram",
              userId: "alice",
            },
          },
          mxid: "@openclaw_user_alice:example.com",
        },
        userId: "@openclaw_user_alice:example.com",
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
        "sessions.send": { runId: "run_1", sessionKey: "agent:codex:session_1" },
      },
    });
    runtime.config.allowedRoomIds = ["!allowed:example.com"];
    runtime.config.allowedUserIds = ["@alice:example.com"];
    runtime.config.matrixUserId = "@openclawbot:example.com";
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
        "sessions.send": { runId: "run_owner", sessionKey: "agent:main:main" },
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

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      key: sessionKey,
      message: "hello from owner",
    }), { expectFinal: false });
  });

  it("dispatches Matrix text and native approval responses to OpenClaw", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_1", type: "run.completed" } }],
      responses: {
        "exec.approval.resolve": { ok: true },
        "sessions.create": { key: "agent:codex:session_1" },
        "sessions.send": { runId: "run_1", sessionKey: "agent:codex:session_1" },
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

    await expect(api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$message" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "hello",
    } as MatrixMessage)).resolves.toEqual({ pending: false });
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$message",
      key: "agent:codex:session_1",
      matrix: {
        roomId: "!room:example.com",
        sender: "@alice:example.com",
      },
      message: "hello",
    }, { expectFinal: false });

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

    await expect(api.handleMatrixMessage({} as BridgeRequestContext, {
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
    expect(runtime.transport.request).not.toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$native-approval",
    }), expect.anything());
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
        "sessions.send": { runId: "run_2", sessionKey: "agent:codex:session_2" },
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
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      attachments: [{ contentType: "image/png", contentUri: "mxc://example/photo", filename: "photo.png", kind: "image" }],
      idempotencyKey: "$reply",
      key: "agent:codex:session_2",
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
    }, { expectFinal: false });
  });

  it("passes Matrix formatted body, mentions, and thread metadata to OpenClaw", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_thread", type: "run.completed" } }],
      responses: {
        "sessions.create": { key: "agent:codex:session_thread" },
        "sessions.send": { runId: "run_thread", sessionKey: "agent:codex:session_thread" },
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

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", {
      idempotencyKey: "$thread-message",
      key: "agent:codex:session_thread",
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
    }, { expectFinal: false });
  });

  it("maps /stop and /abort slash commands to session abort", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@codex:example.com",
      id: "binding",
      kind: "session",
      lastRunId: "run_1",
      owner: "bridge",
      roomId: "!room:example.com",
      sessionKey: "agent:codex:session_1",
      updatedAt: 1,
    });
    const runtime = runtimeWith({
      responses: {
        "sessions.abort": { ok: true },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
      login: login(),
      registry,
      runtime,
    });

    await expect(api.handleMatrixMessage({} as BridgeRequestContext, {
      event: { eventId: "$stop" },
      portal: {
        id: "agent:codex",
        metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com", sessionKey: "agent:codex:session_1" } },
        mxid: "!room:example.com",
        portalKey: { id: "agent:codex", receiver: "login" },
        receiver: "login",
      },
      sender: { userId: "@alice:example.com" },
      text: "/stop",
    } as MatrixMessage)).resolves.toEqual({ pending: false });
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.abort", {
      key: "agent:codex:session_1",
      runId: "run_1",
    }, undefined);
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
        "sessions.send": { runId: "run_edit", sessionKey: "agent:codex:session_1" },
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
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
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
    }), { expectFinal: false });

    await expect(api.handleMatrixReaction({} as BridgeRequestContext, {
      content: { "m.relates_to": { event_id: "$old", key: "👍", rel_type: "m.annotation" } },
      event: { eventId: "$react", sender: "@alice:example.com" },
      portal,
      targetMessage: { id: "$old" },
    } as MatrixReaction)).resolves.toEqual({
      id: "$react",
      metadata: { openclaw: { reaction: "👍", targetMessageId: "$old" } },
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
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
    }), { expectFinal: false });

    await api.handleMatrixReactionRemove({} as BridgeRequestContext, {
      content: { "m.relates_to": { event_id: "$old", key: "👍", rel_type: "m.annotation" } },
      event: { eventId: "$react-redact", sender: "@alice:example.com" },
      portal,
      targetMessage: { id: "$old" },
      targetReaction: { id: "$react" },
    } as MatrixReactionRemove);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
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
    }), { expectFinal: false });

    await api.handleMatrixRedaction({} as BridgeRequestContext, {
      eventId: "$redact",
      portal,
      targetMessage: { id: "$old" },
    } as MatrixRedaction);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
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
    }), { expectFinal: false });
  });

  it("handles bridge slash commands without forwarding them as chat turns", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertBinding({
      agentId: "codex",
      createdAt: 1,
      ghostUserId: "@codex:example.com",
      id: "binding",
      kind: "session",
      owner: "bridge",
      roomId: "!room:example.com",
      sessionKey: "agent:codex:session_1",
      updatedAt: 1,
    });
    const runtime = runtimeWith({
      responses: {
        "chat.history": { messages: [{ content: "hello", id: "m1", role: "user" }] },
        "sessions.create": { key: "agent:codex:new" },
        "sessions.list": {
          sessions: [
            { displayName: "Desktop chat", key: "agent:codex:desktop", origin: { surface: "mac-app" } },
            { displayName: "Terminal chat", key: "agent:codex:tui", origin: { surface: "terminal" } },
          ],
        },
      },
    });
    runtime.config.importSources = ["dashboard"];
    runtime.config.backfillLimit = 5;
    runtime.config.allowedRoomIds = ["!room:example.com"];
    runtime.config.allowedUserIds = ["@alice:example.com"];
    runtime.config.beeperEnv = "staging";
    runtime.config.bridgeManagerPostState = false;
    runtime.config.bridgeManagerToken = "hungry-token";
    runtime.config.contactVisibility = "agents-and-users";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const queueRemoteEvent = vi.fn();
    const createPortal = vi.fn(async (_login: UserLogin, options: { id: string }) => ({
      id: options.id,
      mxid: options.id.includes("ZGVza3RvcA") ? "!imported-desktop:example.com" : "!new-room:example.com",
      portalKey: { id: options.id, receiver: "login" },
      receiver: "login",
    }));
    const backfillPortal = vi.fn();
    const ctx = { bridge: { backfillPortal, createPortal }, queueRemoteEvent } as unknown as BridgeRequestContext;
    const portal = {
      id: "agent:codex",
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com", sessionKey: "agent:codex:session_1" } },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await expect(api.handleMatrixMessage(ctx, {
      event: { eventId: "$status" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/status",
    } as MatrixMessage)).resolves.toEqual({ pending: false });
    expect(queueRemoteEvent.mock.calls.at(-1)?.[1].getID()).toBe("$status:openclaw-command");
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: expect.stringContaining("Import sources: dashboard") } }],
    });
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: expect.stringContaining("Approvals: native Beeper UI") } }],
    });

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$settings" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/settings",
    } as MatrixMessage);
    const settingsBody = (await queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).parts[0].content.body;
    expect(settingsBody).toContain("OpenClaw Beeper settings");
    expect(settingsBody).toContain("Beeper environment: staging");
    expect(settingsBody).toContain("Bridge manager token: configured");
    expect(settingsBody).toContain("Post bridge state: disabled");
    expect(settingsBody).toContain("Contact visibility: agents-and-users");
    expect(settingsBody).toContain("Allowed rooms: !room:example.com");
    expect(settingsBody).toContain("Allowed users: @alice:example.com");

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$sessions" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/sessions",
    } as MatrixMessage);
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: expect.stringContaining("Desktop chat") } }],
    });
    const sessionsBody = (await queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).parts[0].content.body;
    expect(sessionsBody).not.toContain("Terminal chat");

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$backfill" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/backfill",
    } as MatrixMessage);
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: "Queued backfill for 1 message." } }],
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("chat.history", {
      limit: 5,
      sessionKey: "agent:codex:session_1",
    });
    expect(backfillPortal).toHaveBeenCalledWith(login(), portal, { limit: 5 });

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$import" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/import",
    } as MatrixMessage);
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: "Imported 1 OpenClaw session.\nSkipped 0 already imported or unavailable sessions." } }],
    });
    expect(createPortal).toHaveBeenCalledWith(login(), expect.objectContaining({
      id: "session:YWdlbnQ6Y29kZXg6ZGVza3RvcA",
      name: "Desktop chat",
      roomType: "dm",
    }));
    expect(backfillPortal).toHaveBeenCalledWith(login(), expect.objectContaining({
      mxid: "!imported-desktop:example.com",
    }), { limit: 5 });
    expect(registry.getBindingBySessionKey("agent:codex:desktop")).toMatchObject({
      owner: "imported",
      roomId: "!imported-desktop:example.com",
    });

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$new" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/new fresh",
    } as MatrixMessage);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      agentId: "codex",
      key: expect.stringMatching(/^agent:codex:beeper:/u),
      label: "fresh",
    }));
    expect(createPortal).toHaveBeenCalledWith(login(), {
      creationContent: { "m.federate": false },
      id: "session:YWdlbnQ6Y29kZXg6bmV3",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
          sessionKey: "agent:codex:new",
        },
      },
      name: "fresh",
      roomType: "dm",
    });
    expect(registry.getBindingByRoom("!new-room:example.com")).toMatchObject({
      agentId: "codex",
      label: "fresh",
      sessionKey: "agent:codex:new",
    });
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: "Created a new OpenClaw session room: !new-room:example.com" } }],
    });
    expect(runtime.transport.request).not.toHaveBeenCalledWith("sessions.send", expect.anything(), expect.anything());

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$new-default" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/new",
    } as MatrixMessage);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      agentId: "codex",
      key: expect.stringMatching(/^agent:codex:beeper:/u),
      label: "New OpenClaw Session",
    }));
  });

  it("binds unbound rooms to new OpenClaw sessions from slash commands", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    registry.upsertAgent({ agentId: "codex", displayName: "Codex", ghostUserId: "@codex:example.com" });
    const runtime = runtimeWith({
      responses: {
        "sessions.create": { key: "agent:codex:new-from-management" },
      },
    });
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
    });
    const queueRemoteEvent = vi.fn();
    const registerPortal = vi.fn();
    const ctx = { bridge: { registerPortal }, queueRemoteEvent } as unknown as BridgeRequestContext;
    const portal = {
      id: "management",
      mxid: "!management:example.com",
      portalKey: { id: "management", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$new-unbound" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/new codex Deep work",
    } as MatrixMessage);

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      agentId: "codex",
      key: expect.stringMatching(/^agent:codex:beeper:/u),
      label: "Deep work",
    }));
    expect(registry.getBindingByRoom("!management:example.com")).toMatchObject({
      agentId: "codex",
      label: "Deep work",
      sessionKey: "agent:codex:new-from-management",
    });
    expect(registerPortal).toHaveBeenCalledWith(expect.objectContaining({
      id: "session:YWdlbnQ6Y29kZXg6bmV3LWZyb20tbWFuYWdlbWVudA",
      mxid: "!management:example.com",
      portalKey: {
        id: "session:YWdlbnQ6Y29kZXg6bmV3LWZyb20tbWFuYWdlbWVudA",
        receiver: "openclaw:plugin",
      },
      receiver: "openclaw:plugin",
    }));
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: expect.stringContaining("Created a new OpenClaw session in this room") } }],
    });

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$new-missing-agent" },
      portal: {
        id: "fresh-management",
        mxid: "!fresh-management:example.com",
        portalKey: { id: "fresh-management", receiver: "login" },
        receiver: "login",
      },
      sender: { userId: "@alice:example.com" },
      text: "/new",
    } as MatrixMessage);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", expect.objectContaining({
      agentId: "main",
      key: expect.stringMatching(/^agent:main:beeper:/u),
      label: "New OpenClaw Session",
    }));
    expect(registry.getBindingByRoom("!fresh-management:example.com")).toMatchObject({
      agentId: "main",
      label: "New OpenClaw Session",
    });
  });

  it("auto-binds unbound Beeper rooms before forwarding chat turns", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "sessions.create": { key: "agent:main:auto" },
        "sessions.send": { runId: "run_auto", sessionKey: "agent:main:auto" },
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
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$hello",
      key: "agent:main:auto",
      message: "hey",
    }), { expectFinal: false });
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
          ghostUserId: "@openclaw_agent_main:localhost",
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

  it("rejects reaction and slash approval fallbacks", async () => {
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
    expect(runtime.transport.request).not.toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$native-disabled",
    }), expect.anything());

    const queueRemoteEvent = vi.fn();
    await api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
      event: { eventId: "$approve" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/approve approval_1",
    } as MatrixMessage);
    expect(runtime.transport.request).not.toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
    });
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: "Approval slash commands are disabled for this bridge." } }],
    });

    await api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
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

    runtime.config.approvalBehavior = "disabled";
    await api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
      event: { eventId: "$approve-disabled" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/approve approval_2",
    } as MatrixMessage);
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: "Approval slash commands are disabled for this bridge." } }],
    });

  });

  it("rebuilds an OpenClaw room binding from a persisted Pickle session portal without metadata", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-rebuild-binding-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_rebuilt", type: "run.completed" } }],
      responses: {
        "sessions.send": { runId: "run_rebuilt", sessionKey: "agent:codex:dashboard:one" },
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
      ghostUserId: "@openclaw_agent_codex:example.com",
      owner: "imported",
      sessionKey,
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      key: sessionKey,
      message: "hello from persisted portal",
    }), { expectFinal: false });
  });

  it("rebuilds an OpenClaw room binding from a cloud appservice session room id", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-cloud-room-binding-test.json");
    const runtime = runtimeWith({
      events: [{ event: "run.completed", payload: { runId: "run_cloud", type: "run.completed" } }],
      responses: {
        "sessions.send": { runId: "run_cloud", sessionKey: "agent:main:dashboard:abc" },
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
      ghostUserId: "@openclaw_agent_main:beeper.local",
      owner: "imported",
      sessionKey,
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      key: sessionKey,
      message: "hello from cloud room",
    }), { expectFinal: false });
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
    expect(response.messages.map((message) => message.event.getSender().sender)).toEqual(["@openclawbot:localhost", "@codex:example.com"]);
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
}): OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } } {
  const transport = {
    async *events(filter?: (event: OpenClawGatewayEvent) => boolean) {
      for (const event of options.events ?? []) {
        if (!filter || filter(event)) yield event;
      }
    },
    request: vi.fn(async (method: string) => options.responses[method]),
  };
  return new OpenClawGatewayRuntime({
    config: createDefaultConfig({ dataDir: "/tmp/openclaw" }),
    transport,
  }) as OpenClawGatewayRuntime & { transport: OpenClawTransport & { request: ReturnType<typeof vi.fn> } };
}
