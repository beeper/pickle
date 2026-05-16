import type { MatrixBeeper, SentEvent } from "@beeper/pickle";
import {
  applyFinalMessagePart,
  compactFinalContent,
  createFinalMessageAccumulator,
  finalizeAccumulatedAIMessage,
  getFinalMessageText,
  type BeeperFinalMessageAccumulator,
} from "@beeper/pickle/streams/beeper-message";
import { SerialQueue } from "./serial";
import { createTurnId, type BeeperUIMessageChunk } from "./stream-map";

export interface BeeperStreamPublisherClient {
  beeper: MatrixBeeper;
}

export interface BeeperStreamSubscriber {
  deviceId: string;
  userId: string;
}

export interface CreateBeeperStreamPublisherOptions {
  agentId?: string;
  client: BeeperStreamPublisherClient;
  initialMessageMetadata?: Record<string, unknown>;
  roomId: string;
  subscribers?: BeeperStreamSubscriber[];
  threadRoot?: string;
  turnId?: string;
  userId?: string;
}

export interface BeeperStreamStartResult {
  descriptor: Record<string, unknown>;
  eventId: string;
  turnId: string;
}

export interface BeeperStreamFinalizeOptions {
  body?: string;
  finalText?: string;
  finishReason?: string;
  messageMetadata?: Record<string, unknown>;
  message?: Record<string, unknown>;
  terminalPart?: BeeperUIMessageChunk;
}

export class BeeperStreamPublisher {
  readonly roomId: string;
  readonly turnId: string;
  #accumulator: BeeperFinalMessageAccumulator;
  #agentId: string | undefined;
  #client: BeeperStreamPublisherClient;
  #descriptor: Record<string, unknown> | undefined;
  #finalized = false;
  #initialMessageMetadata: Record<string, unknown>;
  #queue = new SerialQueue();
  #subscribers: BeeperStreamSubscriber[];
  #targetEventId: string | undefined;
  #threadRoot: string | undefined;
  #userId: string | undefined;

  constructor(options: CreateBeeperStreamPublisherOptions) {
    this.#agentId = options.agentId;
    this.#client = options.client;
    this.#initialMessageMetadata = options.initialMessageMetadata ?? {};
    this.roomId = options.roomId;
    this.turnId = options.turnId ?? createTurnId();
    this.#subscribers = options.subscribers ?? [];
    this.#threadRoot = options.threadRoot;
    this.#userId = options.userId;
    this.#accumulator = createFinalMessageAccumulator(this.turnId);
  }

  get targetEventId(): string | undefined {
    return this.#targetEventId;
  }

  async start(): Promise<BeeperStreamStartResult> {
    return this.#queue.run(() => this.#start());
  }

  async publish(part: BeeperUIMessageChunk): Promise<void> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
      const { eventId: targetEventId } = await this.#start();
      await this.#publishPart(targetEventId, part);
    });
  }

  async publishMany(parts: Iterable<BeeperUIMessageChunk>): Promise<void> {
    return this.#queue.run(async () => {
      for (const part of parts) {
        if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
        const { eventId: targetEventId } = await this.#start();
        await this.#publishPart(targetEventId, part);
      }
    });
  }

  async error(error: unknown): Promise<void> {
    await this.publish({ errorText: errorText(error), type: "error" });
  }

  async abort(reason?: string): Promise<void> {
    await this.publish({ ...(reason ? { reason } : {}), type: "abort" });
  }

  async finalize(options: BeeperStreamFinalizeOptions = {}): Promise<SentEvent> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Beeper stream is already finalized");
      const finishReason = options.finishReason ?? "stop";
      const { eventId: targetEventId } = await this.#start();
      await this.#publishPart(targetEventId, options.terminalPart ?? {
          finishReason,
          messageMetadata: { finish_reason: finishReason, turn_id: this.turnId, ...options.messageMetadata },
          type: "finish",
        });
      const finalAIMessage = options.message ?? finalizeAccumulatedAIMessage(this.#accumulator);
      const finalText = options.body ?? options.finalText ?? getFinalMessageText(finalAIMessage);
      const finalContent = compactFinalContent({
        aiMessage: finalAIMessage,
        body: finalText,
      });
      const replacement = await this.#client.beeper.streams.finalizeMessage({
        body: finalContent.body || "...",
        content: {
          body: finalContent.body || "...",
          "com.beeper.ai": finalContent.aiMessage,
          msgtype: "m.text",
        },
        eventId: targetEventId,
        roomId: this.roomId,
        topLevelContent: {
          "com.beeper.dont_render_edited": true,
        },
        ...(this.#userId ? { userId: this.#userId } : {}),
      });
      this.#finalized = true;
      return {
        eventId: targetEventId,
        roomId: replacement.roomId,
        raw: {
          logicalEventId: targetEventId,
          raw: replacement.raw,
          replacementEventId: replacement.replacementEventId,
        },
      };
    });
  }

  async #start(): Promise<BeeperStreamStartResult> {
    if (this.#targetEventId && this.#descriptor) {
      return { descriptor: this.#descriptor, eventId: this.#targetEventId, turnId: this.turnId };
    }
    const target = await this.#client.beeper.streams.startMessage({
      content: {
        body: "...",
        "com.beeper.ai": { id: this.turnId, metadata: { turn_id: this.turnId, ...this.#initialMessageMetadata }, parts: [], role: "assistant" },
        msgtype: "m.text",
      },
      roomId: this.roomId,
      streamType: "com.beeper.llm",
      ...(this.#subscribers.length > 0 ? { subscribers: this.#subscribers } : {}),
      ...(this.#threadRoot ? { threadRootEventId: this.#threadRoot } : {}),
      ...(this.#userId ? { userId: this.#userId } : {}),
    });
    this.#descriptor = target.descriptor;
    this.#targetEventId = target.eventId;
    await this.#publishPart(target.eventId, { messageId: this.turnId, messageMetadata: { turn_id: this.turnId, ...this.#initialMessageMetadata }, type: "start" });
    return { descriptor: target.descriptor, eventId: target.eventId, turnId: this.turnId };
  }

  async #publishPart(targetEventId: string, part: BeeperUIMessageChunk): Promise<void> {
    await this.#client.beeper.streams.publishPart({
      ...(this.#agentId ? { agentId: this.#agentId } : {}),
      eventId: targetEventId,
      part,
      roomId: this.roomId,
      turnId: this.turnId,
    });
    applyFinalMessagePart(this.#accumulator, part);
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}
