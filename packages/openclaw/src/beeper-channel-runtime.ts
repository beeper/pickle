import { readFile } from "node:fs/promises";
import type { MatrixClient, SentEvent } from "@beeper/pickle";
import type { OpenClawAgentContact } from "./types";

export interface BeeperChannelRuntimeOptions {
  client: MatrixClient;
  getAgents?: () => readonly OpenClawAgentContact[];
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
  #getAgents: () => readonly OpenClawAgentContact[];
  #log: BeeperChannelRuntimeOptions["log"];

  constructor(options: BeeperChannelRuntimeOptions) {
    this.client = options.client;
    this.#getAgents = options.getAgents ?? (() => []);
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
    if (this.userId) {
      return await this.client.appservice.sendMessage({
        content: withReplyRelation(content, options.replyToId),
        roomId: options.roomId,
        userId: this.userId,
      });
    }
    return await this.client.messages.send({
      content,
      roomId: options.roomId,
      text: options.text,
      ...(options.replyToId ? { replyTo: options.replyToId } : {}),
      ...(options.threadRoot != null ? { threadRoot: String(options.threadRoot) } : {}),
    });
  }

  async sendMedia(options: BeeperOutboundMedia & { roomId: string }): Promise<SentEvent> {
    const bytes = options.bytes ?? (options.path ? await readFile(options.path) : undefined);
    if (!bytes) {
      throw new Error("Beeper media send requires bytes or a local file path.");
    }
    return await this.client.messages.sendMedia({
      bytes,
      kind: options.kind ?? "file",
      roomId: options.roomId,
      ...(options.caption !== undefined ? { caption: options.caption } : {}),
      ...(options.filename !== undefined ? { filename: options.filename } : {}),
      ...(options.threadRoot !== undefined ? { threadRoot: options.threadRoot } : {}),
    });
  }

  async edit(options: {
    content?: Record<string, unknown>;
    eventId: string;
    roomId: string;
    text: string;
  }): Promise<SentEvent> {
    return await this.client.messages.edit({
      eventId: options.eventId,
      roomId: options.roomId,
      text: options.text,
      ...(options.content !== undefined ? { content: options.content } : {}),
    });
  }

  async redact(options: { eventId: string; reason?: string; roomId: string }): Promise<void> {
    await this.client.messages.redact({
      eventId: options.eventId,
      roomId: options.roomId,
      ...(options.reason !== undefined ? { reason: options.reason } : {}),
    });
  }

  async react(options: { emoji: string; eventId: string; roomId: string }): Promise<SentEvent> {
    return await this.client.reactions.send({
      eventId: options.eventId,
      key: options.emoji,
      roomId: options.roomId,
    });
  }

  async removeReaction(options: { emoji: string; eventId: string; roomId: string }): Promise<void> {
    await this.client.reactions.redact({
      eventId: options.eventId,
      key: options.emoji,
      roomId: options.roomId,
    });
  }

  async typing(options: { roomId: string; timeoutMs?: number; typing?: boolean }): Promise<void> {
    await this.client.typing.set({
      roomId: options.roomId,
      typing: options.typing ?? true,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  }

  debug(message: string, data?: unknown): void {
    this.#log?.("debug", message, data);
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
