import type { BridgeRequestContext, MatrixEdit, MatrixMessage, MatrixReaction, MatrixRedaction, UserLogin } from "@beeper/pickle-bridge";
import { describe, expect, it, vi } from "vitest";
import { createDefaultConfig } from "./config";
import { createOpenClawConnector, OpenClawNetworkAPI, parseMatrixTextMessage, userLoginFromOpenClawConfig } from "./connector";
import { OpenClawGatewayRuntime, type OpenClawGatewayEvent, type OpenClawTransport } from "./openclaw-runtime";
import { OpenClawBridgeRegistry } from "./registry";

describe("OpenClawBridgeConnector", () => {
  it("exposes bridgev2-shaped metadata, capabilities, and login flow", async () => {
    const connector = createOpenClawConnector({
      config: createDefaultConfig({ dataDir: "/tmp/openclaw", gatewayUrl: "ws://gateway" }),
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
    expect(connector.getLoginFlows()).toEqual([
      {
        description: "Connect to an existing OpenClaw gateway by URL and optional bearer token.",
        id: "openclaw.gateway",
        name: "OpenClaw Gateway",
      },
    ]);

    const process = connector.createLogin({} as BridgeRequestContext, { id: "@alice:example.com" }, "openclaw.gateway");
    await expect(process.start()).resolves.toMatchObject({
      stepId: "openclaw.gateway.credentials",
      type: "user_input",
    });
    await expect(
      "submitUserInput" in process
        ? process.submitUserInput({ access_token: "token", gateway_url: "ws://gateway" })
        : undefined
    ).resolves.toMatchObject({
      complete: {
        userLogin: {
          metadata: {
            gatewayAccessToken: "token",
            gatewayUrl: "ws://gateway",
          },
          remoteName: "OpenClaw",
          userId: "@alice:example.com",
        },
      },
      type: "complete",
    });
  });

  it("keeps Beeper Matrix tokens separate from OpenClaw gateway bearer tokens", () => {
    expect(userLoginFromOpenClawConfig(createDefaultConfig({
      accessToken: "matrix-token",
      dataDir: "/tmp/openclaw",
      gatewayAccessToken: "gateway-token",
      gatewayUrl: "ws://gateway",
    }))).toMatchObject({
      metadata: {
        gatewayAccessToken: "gateway-token",
        gatewayUrl: "ws://gateway",
      },
    });
    expect(userLoginFromOpenClawConfig(createDefaultConfig({
      accessToken: "matrix-token",
      dataDir: "/tmp/openclaw",
      gatewayUrl: "ws://gateway",
    })).metadata).toEqual({
      gatewayUrl: "ws://gateway",
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
      streams: { publish: vi.fn() },
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
      streams: { publish: vi.fn() },
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
      streams: { publish: vi.fn() },
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
      runtime: runtimeWith({ responses: {} }),
      streams: { publish: vi.fn() },
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
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
          sessionKey: "agent:codex",
        },
      },
      mxid: "!codex-dm:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
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
        id: "agent:codex",
        metadata: {
          openclaw: {
            agentId: "codex",
            ghostUserId: "@codex:example.com",
            sessionKey: "agent:codex",
          },
        },
        portalKey: { id: "agent:codex", receiver: "login" },
        receiver: "login",
        roomType: "dm",
        mxid: "!codex-dm:example.com",
      },
      userId: "@codex:example.com",
    });
    expect(createPortal).toHaveBeenCalledWith(login(), {
      creationContent: { "m.federate": false },
      id: "agent:codex",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
          sessionKey: "agent:codex",
        },
      },
      name: "Codex",
      roomType: "dm",
      sender: "codex",
    });
    expect(registry.getBindingByRoom("!codex-dm:example.com")).toMatchObject({
      agentId: "codex",
      roomId: "!codex-dm:example.com",
      sessionKey: "agent:codex",
    });
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
      streams: { publish: vi.fn() },
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
      streams: { publish: vi.fn() },
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

  it("drops disallowed rooms, users, and bridge-owned senders before forwarding to OpenClaw", async () => {
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
      streams: { publish: vi.fn() },
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

  it("dispatches Matrix text and approval reactions to OpenClaw", async () => {
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
      streams: { publish: vi.fn() },
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
        },
      },
    });
    expect(runtime.transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "deny",
    });
  });

  it("parses Matrix replies and slash commands for OpenClaw turns", async () => {
    expect(parseMatrixTextMessage("> <@alice> old\n\nnew text", {
      "m.relates_to": {
        "m.in_reply_to": { event_id: "$old" },
      },
    })).toEqual({
      attachments: [],
      replyToEventId: "$old",
      text: "new text",
    });
    expect(parseMatrixTextMessage("/stop", {})).toEqual({
      attachments: [],
      command: { args: "", name: "stop" },
      text: "/stop",
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

    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
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
      streams: { publish: vi.fn() },
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
        relation: {
          kind: "reply",
          replyToEventId: "$old",
        },
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
      streams: { publish: vi.fn() },
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
      streams: { publish: vi.fn() },
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
      streams: { publish: vi.fn() },
    });
    const portal = {
      id: "agent:codex",
      metadata: { openclaw: { agentId: "codex", ghostUserId: "@codex:example.com", sessionKey: "agent:codex" } },
      mxid: "!room:example.com",
      portalKey: { id: "agent:codex", receiver: "login" },
      receiver: "login",
    };

    await api.handleMatrixEdit({} as BridgeRequestContext, {
      content: {},
      event: { eventId: "$edit" },
      existing: [],
      portal,
      sender: { userId: "@alice:example.com" },
      targetMessage: { id: "$old" },
      text: "corrected",
    } as MatrixEdit);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.send", expect.objectContaining({
      idempotencyKey: "$edit:edit",
      matrix: {
        relation: {
          kind: "edit",
          targetEventId: "$old",
        },
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
        },
        sender: "@alice:example.com",
      },
      message: "Reacted 👍 to $old",
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
        },
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
    runtime.config.gatewayUrl = "ws://gateway";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
      streams: { publish: vi.fn() },
    });
    const queueRemoteEvent = vi.fn();
    const createPortal = vi.fn(async () => ({
      id: "session:YWdlbnQ6Y29kZXg6bmV3",
      mxid: "!new-room:example.com",
      portalKey: { id: "session:YWdlbnQ6Y29kZXg6bmV3", receiver: "login" },
      receiver: "login",
    }));
    const ctx = { bridge: { createPortal }, queueRemoteEvent } as unknown as BridgeRequestContext;
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

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$new" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/new fresh",
    } as MatrixMessage);
    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", {
      agentId: "codex",
      label: "fresh",
    });
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
      sender: "codex",
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
  });

  it("creates a new agent session room from slash commands in unbound rooms", async () => {
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
      streams: { publish: vi.fn() },
    });
    const queueRemoteEvent = vi.fn();
    const createPortal = vi.fn(async () => ({
      id: "session:YWdlbnQ6Y29kZXg6bmV3LWZyb20tbWFuYWdlbWVudA",
      mxid: "!new-management-room:example.com",
      portalKey: { id: "session:YWdlbnQ6Y29kZXg6bmV3LWZyb20tbWFuYWdlbWVudA", receiver: "login" },
      receiver: "login",
    }));
    const ctx = { bridge: { createPortal }, queueRemoteEvent } as unknown as BridgeRequestContext;
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

    expect(runtime.transport.request).toHaveBeenCalledWith("sessions.create", {
      agentId: "codex",
      label: "Deep work",
    });
    expect(createPortal).toHaveBeenCalledWith(login(), {
      creationContent: { "m.federate": false },
      id: "session:YWdlbnQ6Y29kZXg6bmV3LWZyb20tbWFuYWdlbWVudA",
      metadata: {
        openclaw: {
          agentId: "codex",
          ghostUserId: "@codex:example.com",
          sessionKey: "agent:codex:new-from-management",
        },
      },
      name: "Deep work",
      roomType: "dm",
      sender: "codex",
    });
    expect(registry.getBindingByRoom("!new-management-room:example.com")).toMatchObject({
      agentId: "codex",
      label: "Deep work",
      sessionKey: "agent:codex:new-from-management",
    });

    await api.handleMatrixMessage(ctx, {
      event: { eventId: "$new-missing-agent" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/new",
    } as MatrixMessage);
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: expect.stringContaining("Usage: /new [agent-id]") } }],
    });
  });

  it("honors configured approval behavior for reactions and slash commands", async () => {
    const registry = new OpenClawBridgeRegistry("/tmp/openclaw-connector-test.json");
    const runtime = runtimeWith({
      responses: {
        "exec.approval.resolve": { ok: true },
      },
    });
    runtime.config.approvalBehavior = "slash";
    const api = new OpenClawNetworkAPI({
      config: runtime.config,
      login: login(),
      registry,
      runtime,
      streams: { publish: vi.fn() },
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

    const queueRemoteEvent = vi.fn();
    await api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
      event: { eventId: "$approve" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/approve approval_1",
    } as MatrixMessage);
    expect(runtime.transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
      approvalId: "approval_1",
      decision: "approve",
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
    expect(runtime.transport.request).toHaveBeenCalledWith("exec.approval.resolve", {
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

    runtime.config.approvalBehavior = "slash";
    await api.handleMatrixMessage({ queueRemoteEvent } as unknown as BridgeRequestContext, {
      event: { eventId: "$approve-missing" },
      portal,
      sender: { userId: "@alice:example.com" },
      text: "/approve",
    } as MatrixMessage);
    await expect(queueRemoteEvent.mock.calls.at(-1)?.[1].convertMessage()).resolves.toMatchObject({
      parts: [{ content: { body: "Usage: /approve <approval-id> or reply to an approval message with /approve" } }],
    });
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
      streams: { publish: vi.fn() },
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
    expect(response.messages.map((message) => message.event.getSender().sender)).toEqual(["login:human", "codex"]);
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
  return { id: "login", metadata: { gatewayUrl: "ws://gateway" }, userId: "@alice:example.com" };
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
