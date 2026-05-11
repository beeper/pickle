import type { MatrixClient, MatrixClientEvent, MatrixMessageEvent, MatrixSubscription } from "@beeper/pickle";
import { createDefaultConfig, readConfig } from "./config";
import { createPicklePiMatrixClient } from "./matrix";
import { createHeadlessPiSession, type HeadlessPiSession } from "./pi-runtime";
import { piEventNoticeText, piEventSessionTitle } from "./pi-notice";
import { PicklePiRegistry } from "./registry";
import { createSessionRoom } from "./rooms";
import { attachRoomToSpace, createProjectSpace, projectKeyForCwd } from "./spaces";
import type { PicklePiConfig } from "./types";

export interface PicklePiAgentOptions {
  client?: MatrixClient;
  config?: PicklePiConfig;
  configPath?: string;
  registry?: PicklePiRegistry;
}

export class PicklePiAgent {
  readonly config: PicklePiConfig;
  readonly registry: PicklePiRegistry;
  #client: MatrixClient | undefined;
  #sessions = new Map<string, HeadlessPiSession>();
  #subscription: MatrixSubscription | undefined;

  constructor(options: { client?: MatrixClient; config: PicklePiConfig; registry?: PicklePiRegistry }) {
    this.config = options.config;
    this.registry = options.registry ?? new PicklePiRegistry();
    this.#client = options.client;
  }

  static async create(options: PicklePiAgentOptions = {}): Promise<PicklePiAgent> {
    const config = options.config ?? (options.configPath ? await readConfig(options.configPath) : createDefaultConfig());
    return new PicklePiAgent({
      config,
      ...(options.client ? { client: options.client } : {}),
      ...(options.registry ? { registry: options.registry } : {}),
    });
  }

  async start(): Promise<void> {
    await this.registry.load();
    this.#client ??= createPicklePiMatrixClient(this.config);
    await this.#client.boot();
    this.#subscription = await this.#client.subscribe({ kind: ["message", "reaction"] }, (event) =>
      this.handleMatrixEvent(event)
    );
  }

  stop(): void {
    void this.#subscription?.stop();
    for (const session of this.#sessions.values()) session.unsubscribe();
    this.#sessions.clear();
    void this.#client?.close();
  }

  async handleMatrixEvent(event: MatrixClientEvent): Promise<void> {
    const eventId = "eventId" in event && typeof event.eventId === "string" ? event.eventId : undefined;
    const roomId = "roomId" in event && typeof event.roomId === "string" ? event.roomId : undefined;
    if (!roomId || !eventId) return;
    if (this.registry.hasDedupe(eventId)) return;
    this.registry.markDedupe(eventId);
    if (isTextMessageEvent(event) && isAllowedSender(this.config, event.sender.userId) && !event.sender.isMe) {
      await this.#handleMessage(event);
    }
    await this.registry.save();
  }

  async #handleMessage(event: MatrixMessageEvent): Promise<void> {
    if (event.text.startsWith("/pi ")) {
      await this.#handleCommand(event);
      return;
    }
    const binding = this.registry.getBindingByRoom(event.roomId);
    if (!binding) return;
    const headless = await this.#ensureHeadlessSession(binding.id);
    try {
      await headless.session.prompt(event.text, { source: "matrix" });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Failed to prompt Pi session", { bindingId: binding.id, error, text: event.text });
      await this.#client?.messages.send({
        messageType: "m.notice",
        roomId: event.roomId,
        text: `Pi session error: ${message}`,
      });
    }
  }

  async #handleCommand(event: MatrixMessageEvent): Promise<void> {
    const client = this.#client;
    if (!client) return;
    const [command, ...args] = event.text.slice(4).trim().split(/\s+/);
    if (command === "status") {
      const binding = this.registry.getBindingByRoom(event.roomId);
      await client.messages.send({
        messageType: "m.notice",
        roomId: event.roomId,
        text: binding ? `Pi session: ${binding.piSessionFile}` : "No Pi session is attached to this room.",
      });
      return;
    }
    if (command === "new") {
      const cwd = args.join(" ").trim() || process.cwd();
      const binding = await this.#createSession(cwd);
      await client.messages.send({
        messageType: "m.notice",
        roomId: event.roomId,
        text: `Created Pi session room ${binding.roomId} for ${cwd}`,
      });
      await client.messages.send({
        messageType: "m.notice",
        roomId: binding.roomId,
        text: `Pi session ready for ${cwd}`,
      });
      return;
    }
    if (command === "resume") {
      const binding = this.registry.getBindingByRoom(event.roomId);
      if (!binding) return;
      await this.#ensureHeadlessSession(binding.id);
      await client.messages.send({ messageType: "m.notice", roomId: event.roomId, text: "Pi session is ready." });
      return;
    }
    if (command === "attach") {
      await client.messages.send({
        messageType: "m.notice",
        roomId: event.roomId,
        text: `/pi attach is not implemented yet. Requested: ${args.join(" ")}`,
      });
      return;
    }
  }

  async #createSession(cwd: string) {
    const client = this.#client;
    if (!client) throw new Error("Matrix client is not started");
    const projectKey = projectKeyForCwd(cwd);
    let space = this.registry.getProjectSpace(projectKey);
    if (!space) {
      space = await createProjectSpace(client, this.config, cwd);
      this.registry.upsertProjectSpace(space);
    }
    const binding = await createSessionRoom(client, this.config, {
      cwd,
      sessionName: `Pi: ${cwd.split("/").filter(Boolean).at(-1) ?? cwd}`,
      spaceId: space.spaceId,
    });
    await attachRoomToSpace(client, binding.roomId, space.spaceId, [matrixDomainFromConfig(this.config)]);
    this.registry.upsertBinding(binding);
    await this.registry.save();
    return binding;
  }

  async #ensureHeadlessSession(bindingId: string): Promise<HeadlessPiSession> {
    const existing = this.#sessions.get(bindingId);
    if (existing) return existing;
    const binding = this.registry.data.bindings.find((item) => item.id === bindingId);
    if (!binding) throw new Error(`Unknown Pi binding: ${bindingId}`);
    const session = await createHeadlessPiSession({
      binding,
      config: this.config,
      onEvent: async (event) => {
        await this.#mirrorPiEvent(binding.roomId, event);
      },
    });
    this.#sessions.set(bindingId, session);
    return session;
  }

  async #mirrorPiEvent(roomId: string, event: unknown): Promise<void> {
    if (!this.#client) return;
    const title = piEventSessionTitle(event);
    if (title) {
      await this.#client.rooms.sendStateEvent({
        content: { name: title },
        eventType: "m.room.name",
        roomId,
        stateKey: "",
      });
    }
    const text = piEventNoticeText(event);
    if (!text) return;
    await this.#client.messages.send({ messageType: "m.notice", roomId, text });
  }
}

function isTextMessageEvent(event: MatrixClientEvent): event is MatrixMessageEvent {
  return event.kind === "message" && event.messageType === "m.text" && typeof event.text === "string";
}

function isAllowedSender(config: PicklePiConfig, sender: string): boolean {
  return !config.allowedUserIds?.length || config.allowedUserIds.includes(sender);
}

function matrixDomainFromConfig(config: PicklePiConfig): string {
  if (!config.homeserver) return "localhost";
  try {
    return new URL(config.homeserver).hostname;
  } catch {
    return "localhost";
  }
}
