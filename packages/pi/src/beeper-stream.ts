import type { MatrixBeeper, MatrixMessages, SentEvent } from "@beeper/pickle";
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
  messages: Pick<MatrixMessages, "edit" | "get" | "send">;
}

export interface BeeperStreamSubscriber {
  deviceId: string;
  userId: string;
}

export interface CreateBeeperStreamPublisherOptions {
  client: BeeperStreamPublisherClient;
  initialMessageMetadata?: Record<string, unknown>;
  roomId: string;
  subscribers?: BeeperStreamSubscriber[];
  targetEventId?: string;
  threadRoot?: string;
  turnId?: string;
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
  #client: BeeperStreamPublisherClient;
  #descriptor: Record<string, unknown> | undefined;
  #finalized = false;
  #initialMessageMetadata: Record<string, unknown>;
  #queue = new SerialQueue();
  #seq = 1;
  #subscribers: BeeperStreamSubscriber[];
  #targetEventId: string | undefined;
  #threadRoot: string | undefined;

  constructor(options: CreateBeeperStreamPublisherOptions) {
    this.#client = options.client;
    this.#initialMessageMetadata = options.initialMessageMetadata ?? {};
    this.roomId = options.roomId;
    this.turnId = options.turnId ?? createTurnId();
    this.#subscribers = options.subscribers ?? [];
    this.#targetEventId = options.targetEventId;
    this.#threadRoot = options.threadRoot;
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
      const replacement = await this.#client.messages.edit({
        content: {
          body: finalContent.body || "...",
          "com.beeper.ai": finalContent.aiMessage,
          "com.beeper.stream": null,
          msgtype: "m.text",
        },
        eventId: targetEventId,
        messageType: "m.text",
        roomId: this.roomId,
        text: finalContent.body || "...",
        topLevelContent: {
          "com.beeper.dont_render_edited": true,
          "com.beeper.stream": null,
        },
      });
      this.#finalized = true;
      return {
        ...replacement,
        eventId: targetEventId,
        raw: {
          logicalEventId: targetEventId,
          raw: replacement.raw,
          replacementEventId: replacement.eventId,
        },
      };
    });
  }

  async #start(): Promise<BeeperStreamStartResult> {
    if (this.#targetEventId && this.#descriptor) {
      return { descriptor: this.#descriptor, eventId: this.#targetEventId, turnId: this.turnId };
    }
    if (this.#targetEventId) {
      const { message } = await this.#client.messages.get({ eventId: this.#targetEventId, roomId: this.roomId });
      const descriptor = message?.content["com.beeper.stream"];
      if (!isRecord(descriptor)) {
        throw new Error(`Target message ${this.#targetEventId} does not contain a Beeper stream descriptor`);
      }
      this.#descriptor = descriptor;
      return { descriptor, eventId: this.#targetEventId, turnId: this.turnId };
    }
    const stream = await this.#client.beeper.streams.create({ roomId: this.roomId, streamType: "com.beeper.llm" });
    this.#descriptor = stream.descriptor;
    const target = await this.#client.messages.send({
      content: {
        body: "...",
        "com.beeper.ai": { id: this.turnId, metadata: { turn_id: this.turnId, ...this.#initialMessageMetadata }, parts: [], role: "assistant" },
        "com.beeper.stream": stream.descriptor,
        msgtype: "m.text",
      },
      messageType: "m.text",
      roomId: this.roomId,
      text: "...",
      ...(this.#threadRoot ? { threadRoot: this.#threadRoot } : {}),
    });
    this.#targetEventId = target.eventId;
    await this.#client.beeper.streams.register({
      descriptor: stream.descriptor,
      eventId: target.eventId,
      roomId: this.roomId,
      ...(this.#subscribers.length > 0 ? { subscribers: this.#subscribers } : {}),
    });
    await this.#publishPart(target.eventId, { messageId: this.turnId, messageMetadata: { turn_id: this.turnId, ...this.#initialMessageMetadata }, type: "start" });
    return { descriptor: stream.descriptor, eventId: target.eventId, turnId: this.turnId };
  }

  async #publishPart(targetEventId: string, part: BeeperUIMessageChunk): Promise<void> {
    const descriptorType = descriptorTypeOf(this.#descriptor);
    const seq = this.#seq;
    const content = {
      [`${descriptorType}.deltas`]: [
        {
          "m.relates_to": { event_id: targetEventId, rel_type: "m.reference" },
          part,
          seq,
          target_event: targetEventId,
          turn_id: this.turnId,
        },
      ],
    };
    await this.#client.beeper.streams.publish({
      content,
      eventId: targetEventId,
      roomId: this.roomId,
    });
    this.#seq = seq + 1;
    applyFinalMessagePart(this.#accumulator, part);
  }
}

function descriptorTypeOf(descriptor: Record<string, unknown> | undefined): string {
  return typeof descriptor?.type === "string" ? descriptor.type : "com.beeper.llm";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}
