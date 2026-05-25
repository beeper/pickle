import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MatrixClient, SentEvent } from "@beeper/pickle";
import {
  createRemoteMessage,
  type PickleBridge,
  type PortalKey,
  type RemoteEdit,
  type RemoteMessageRemove,
  type RemoteReaction,
  type RemoteReactionRemove,
  type RemoteTyping,
  type UserLogin,
} from "@beeper/pickle-bridge";
import type { OpenClawAgentContact, OpenClawSessionBinding } from "./types";

export interface BeeperChannelRuntimeOptions {
  bridge?: PickleBridge;
  client: MatrixClient;
  getAgents?: () => readonly OpenClawAgentContact[];
  getBindingByRoom?: (roomId: string) => OpenClawSessionBinding | undefined;
  login?: UserLogin;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
  userId?: string;
}

export interface BeeperOutboundMedia {
  bytes?: Uint8Array;
  caption?: string;
  filename?: string;
  kind?: "image" | "video" | "audio" | "file";
  path?: string;
  threadRoot?: string;
}

export class BeeperChannelRuntime {
  readonly client: MatrixClient;
  readonly userId: string | undefined;
  #bridge: PickleBridge | undefined;
  #getAgents: () => readonly OpenClawAgentContact[];
  #getBindingByRoom: (roomId: string) => OpenClawSessionBinding | undefined;
  #login: UserLogin | undefined;
  #log: BeeperChannelRuntimeOptions["log"];

  constructor(options: BeeperChannelRuntimeOptions) {
    this.#bridge = options.bridge;
    this.client = options.client;
    this.#getAgents = options.getAgents ?? (() => []);
    this.#getBindingByRoom = options.getBindingByRoom ?? (() => undefined);
    this.#login = options.login;
    this.#log = options.log;
    this.userId = options.userId;
  }

  listAgents(): readonly OpenClawAgentContact[] {
    return this.#getAgents();
  }

  async sendText(options: {
    content?: Record<string, unknown>;
    replyToId?: string | null;
    roomId: string;
    text: string;
    threadRoot?: string | number | null;
  }): Promise<SentEvent> {
    const content = {
      body: options.text,
      msgtype: "m.text",
      ...options.content,
    };
    return await this.#queueRemoteText(options.roomId, withReplyRelation(content, options.replyToId));
  }

  async sendMedia(options: BeeperOutboundMedia & { roomId: string }): Promise<SentEvent> {
    const bytes = options.bytes ?? (options.path ? await readFile(options.path) : undefined);
    if (!bytes) {
      throw new Error("Beeper media send requires bytes or a local file path.");
    }
    return await this.#queueRemoteMedia(options.roomId, {
      bytes,
      kind: options.kind ?? "file",
      ...(options.caption !== undefined ? { caption: options.caption } : {}),
      ...(options.filename !== undefined ? { filename: options.filename } : {}),
    });
  }

  async edit(options: {
    content?: Record<string, unknown>;
    eventId: string;
    roomId: string;
    text: string;
  }): Promise<SentEvent> {
    return await this.#queueRemoteEdit(options.roomId, options.eventId, {
      body: options.text,
      msgtype: "m.text",
      ...options.content,
    });
  }

  async redact(options: { eventId: string; reason?: string; roomId: string }): Promise<void> {
    await this.#queueRemoteMessageRemove(options.roomId, options.eventId);
  }

  async react(options: { emoji: string; eventId: string; roomId: string }): Promise<SentEvent> {
    return await this.#queueRemoteReaction(options.roomId, options.eventId, options.emoji, false);
  }

  async removeReaction(options: { emoji: string; eventId: string; roomId: string }): Promise<void> {
    await this.#queueRemoteReaction(options.roomId, options.eventId, options.emoji, true);
  }

  async typing(options: { roomId: string; timeoutMs?: number; typing?: boolean }): Promise<void> {
    await this.#queueRemoteTyping(options.roomId, options.typing ?? true, options.timeoutMs);
  }

  debug(message: string, data?: unknown): void {
    this.#log?.("debug", message, data);
  }

  async #queueRemoteText(roomId: string, content: Record<string, unknown>): Promise<SentEvent> {
    const route = this.#bridgeRoute(roomId);
    const messageId = openClawRemoteId();
    route.bridge.queueRemoteEvent(route.login, createRemoteMessage({
      convert: () => ({
        parts: [{
          content,
          type: "m.room.message",
        }],
      }),
      data: {},
      id: messageId,
      portalKey: route.portalKey,
      sender: this.#eventSender(roomId),
    }));
    await route.bridge.flushRemoteEvents();
    return { eventId: messageId, raw: { bridgeQueued: true }, roomId };
  }

  async #queueRemoteMedia(roomId: string, options: { bytes: Uint8Array; caption?: string; filename?: string; kind: NonNullable<BeeperOutboundMedia["kind"]> }): Promise<SentEvent> {
    const route = this.#bridgeRoute(roomId);
    const uploaded = await this.client.media.upload({
      bytes: options.bytes,
      ...(options.filename !== undefined ? { filename: options.filename } : {}),
    });
    const messageId = openClawRemoteId();
    route.bridge.queueRemoteEvent(route.login, createRemoteMessage({
      convert: () => ({
        parts: [{
          content: mediaMessageContent(options.kind, uploaded.contentUri, options.filename, options.caption),
          type: "m.room.message",
        }],
      }),
      data: {},
      id: messageId,
      portalKey: route.portalKey,
      sender: this.#eventSender(roomId),
    }));
    await route.bridge.flushRemoteEvents();
    return { eventId: messageId, raw: { bridgeQueued: true }, roomId };
  }

  async #queueRemoteEdit(roomId: string, targetMessageId: string, content: Record<string, unknown>): Promise<SentEvent> {
    const targetId = openClawTargetId(targetMessageId);
    const route = this.#bridgeRoute(roomId);
    const messageId = openClawRemoteId();
    const event: RemoteEdit = {
      convertEdit: async () => ({
        modifiedParts: [{
          content,
          type: "m.room.message",
        }],
      }),
      getPortalKey: () => route.portalKey,
      getSender: () => this.#eventSender(roomId),
      getTargetMessage: () => targetId,
      getType: () => "edit",
    };
    route.bridge.queueRemoteEvent(route.login, event);
    await route.bridge.flushRemoteEvents();
    return { eventId: messageId, raw: { bridgeQueued: true, targetMessageId: targetId }, roomId };
  }

  async #queueRemoteMessageRemove(roomId: string, targetMessageId: string): Promise<void> {
    const targetId = openClawTargetId(targetMessageId);
    const route = this.#bridgeRoute(roomId);
    const event: RemoteMessageRemove = {
      getPortalKey: () => route.portalKey,
      getSender: () => this.#eventSender(roomId),
      getTargetMessage: () => targetId,
      getType: () => "message_remove",
    };
    route.bridge.queueRemoteEvent(route.login, event);
    await route.bridge.flushRemoteEvents();
  }

  async #queueRemoteReaction(roomId: string, targetMessageId: string, emoji: string, remove: boolean): Promise<SentEvent> {
    const targetId = openClawTargetId(targetMessageId);
    const route = this.#bridgeRoute(roomId);
    const reactionId = openClawRemoteId("reaction");
    const event: RemoteReaction | RemoteReactionRemove = {
      getEmoji: () => emoji,
      getID: () => reactionId,
      getPortalKey: () => route.portalKey,
      getSender: () => this.#eventSender(roomId),
      getTargetMessage: () => targetId,
      getType: () => remove ? "reaction_remove" : "reaction",
    };
    route.bridge.queueRemoteEvent(route.login, event);
    await route.bridge.flushRemoteEvents();
    return { eventId: reactionId, raw: { bridgeQueued: true, targetMessageId: targetId }, roomId };
  }

  async #queueRemoteTyping(roomId: string, typing: boolean, timeoutMs: number | undefined): Promise<void> {
    const route = this.#bridgeRoute(roomId);
    const event: RemoteTyping = {
      getPortalKey: () => route.portalKey,
      getSender: () => this.#eventSender(roomId),
      ...(timeoutMs !== undefined ? { getTimeoutMs: () => timeoutMs } : {}),
      getType: () => "typing",
      isTyping: () => typing,
    };
    route.bridge.queueRemoteEvent(route.login, event);
    await route.bridge.flushRemoteEvents();
  }

  #bridgeRoute(roomId: string): { bridge: PickleBridge; login: UserLogin; portalKey: PortalKey } {
    if (!this.#bridge || !this.#login) throw new Error("Beeper channel runtime requires a Pickle bridge and user login for outbound actions.");
    const portal = this.#bridge.getPortalByMXID(roomId);
    if (!portal?.portalKey) throw new Error(`Beeper outbound target ${roomId} is not a bound bridge portal.`);
    return { bridge: this.#bridge, login: this.#login, portalKey: portal.portalKey };
  }

  #eventSender(roomId: string): { isFromMe: boolean; sender: string } {
    const binding = this.#getBindingByRoom(roomId);
    return {
      isFromMe: true,
      sender: binding?.ghostUserId ?? this.userId ?? "openclaw",
    };
  }
}

let currentRuntime: BeeperChannelRuntime | undefined;

export function setBeeperChannelRuntime(runtime: BeeperChannelRuntime | undefined): void {
  currentRuntime = runtime;
}

export function getBeeperChannelRuntime(): BeeperChannelRuntime | undefined {
  return currentRuntime;
}

export function requireBeeperChannelRuntime(): BeeperChannelRuntime {
  if (!currentRuntime) {
    throw new Error("Beeper channel runtime is not available; start the Beeper bridge account first.");
  }
  return currentRuntime;
}

function withReplyRelation(content: Record<string, unknown>, replyToId: string | null | undefined): Record<string, unknown> {
  if (!replyToId) return content;
  return {
    ...content,
    "m.relates_to": {
      "m.in_reply_to": {
        event_id: replyToId,
      },
    },
  };
}

function openClawRemoteId(prefix = "message"): string {
  return `openclaw:${prefix}:${randomUUID()}`;
}

function openClawTargetId(eventId: string): string {
  if (!eventId.startsWith("openclaw:")) {
    throw new Error(`Beeper bridge actions can only target OpenClaw bridge message ids, got ${eventId}.`);
  }
  return eventId;
}

function mediaMessageContent(kind: NonNullable<BeeperOutboundMedia["kind"]>, contentUri: string, filename: string | undefined, caption: string | undefined): Record<string, unknown> {
  const msgtype = kind === "image"
    ? "m.image"
    : kind === "video"
      ? "m.video"
      : kind === "audio"
        ? "m.audio"
        : "m.file";
  return {
    body: caption ?? filename ?? "attachment",
    msgtype,
    url: contentUri,
    ...(filename ? { filename } : {}),
  };
}
