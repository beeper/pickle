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
import { AGUIEventType, createTurnId, type AGUIEvent } from "./stream-map";

type FinishReason = "stop" | "length" | "content_filter" | "tool_calls" | null;

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
  terminalPart?: AGUIEvent;
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

  async publish(part: AGUIEvent): Promise<void> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
      const { eventId: targetEventId } = await this.#start();
      await this.#publishPart(targetEventId, part);
    });
  }

  async publishMany(parts: Iterable<AGUIEvent>): Promise<void> {
    return this.#queue.run(async () => {
      for (const part of parts) {
        if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
        const { eventId: targetEventId } = await this.#start();
        await this.#publishPart(targetEventId, part);
      }
    });
  }

  async error(error: unknown): Promise<void> {
    await this.publish({ message: errorText(error), runId: this.turnId, type: AGUIEventType.RUN_ERROR });
  }

  async abort(reason?: string): Promise<void> {
    await this.publish({ message: reason ?? "aborted", runId: this.turnId, type: AGUIEventType.RUN_ERROR });
  }

  async finalize(options: BeeperStreamFinalizeOptions = {}): Promise<SentEvent> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Beeper stream is already finalized");
      const finishReason = normalizeFinishReason(options.finishReason);
      const { eventId: targetEventId } = await this.#start();
      await this.#publishPart(targetEventId, options.terminalPart ?? {
          finishReason,
          runId: this.turnId,
          threadId: this.turnId,
          type: AGUIEventType.RUN_FINISHED,
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
    return { descriptor: target.descriptor, eventId: target.eventId, turnId: this.turnId };
  }

  async #publishPart(targetEventId: string, part: AGUIEvent): Promise<void> {
    await this.#client.beeper.streams.publishPart({
      ...(this.#agentId ? { agentId: this.#agentId } : {}),
      eventId: targetEventId,
      part,
      roomId: this.roomId,
      turnId: this.turnId,
    });
    for (const accumulatorPart of aguiEventToFinalMessageParts(this.turnId, part)) {
      applyFinalMessagePart(this.#accumulator, accumulatorPart);
    }
  }
}

function aguiEventToFinalMessageParts(turnId: string, event: AGUIEvent): Record<string, unknown>[] {
  switch (event.type) {
    case AGUIEventType.RUN_STARTED:
      return [{
        messageId: stringValue(event.runId) ?? turnId,
        messageMetadata: { turn_id: stringValue(event.runId) ?? turnId },
        type: "start",
      }];
    case AGUIEventType.RUN_FINISHED:
      return [{
        finishReason: stringValue(event.finishReason) ?? "stop",
        messageMetadata: {
          finish_reason: stringValue(event.finishReason) ?? "stop",
          turn_id: stringValue(event.runId) ?? turnId,
        },
        type: "finish",
      }];
    case AGUIEventType.RUN_ERROR:
      return [{
        errorText: stringValue(event.message) ?? stringValue(event.error) ?? "Run failed",
        type: "error",
      }];
    case AGUIEventType.TEXT_MESSAGE_START:
      return [{
        id: stringValue(event.messageId) ?? turnId,
        type: "text-start",
      }];
    case AGUIEventType.TEXT_MESSAGE_CONTENT:
      return [{
        delta: stringValue(event.delta) ?? "",
        id: stringValue(event.messageId) ?? turnId,
        type: "text-delta",
      }];
    case AGUIEventType.TEXT_MESSAGE_END:
      return [{
        id: stringValue(event.messageId) ?? turnId,
        type: "text-end",
      }];
    case AGUIEventType.REASONING_MESSAGE_START:
      return [{
        id: reasoningPartId(event, turnId),
        type: "reasoning-start",
      }];
    case AGUIEventType.REASONING_MESSAGE_CONTENT:
      return [{
        delta: stringValue(event.delta) ?? "",
        id: reasoningPartId(event, turnId),
        type: "reasoning-delta",
      }];
    case AGUIEventType.REASONING_MESSAGE_END:
      return [{
        id: reasoningPartId(event, turnId),
        type: "reasoning-end",
      }];
    case AGUIEventType.TOOL_CALL_START:
      return [{
        dynamic: true,
        toolCallId: stringValue(event.toolCallId),
        toolName: stringValue(event.toolName) ?? stringValue(event.toolCallName),
        type: "tool-input-start",
      }];
    case AGUIEventType.TOOL_CALL_ARGS:
      return [{
        inputTextDelta: stringValue(event.delta) ?? stringifyValue(event.args),
        toolCallId: stringValue(event.toolCallId),
        type: "tool-input-delta",
      }];
    case AGUIEventType.TOOL_CALL_END:
      return [{
        dynamic: true,
        input: event.input ?? parseMaybeJSON(stringValue(event.args)),
        toolCallId: stringValue(event.toolCallId),
        toolName: stringValue(event.toolName) ?? stringValue(event.toolCallName),
        type: "tool-input-available",
      }];
    case AGUIEventType.TOOL_CALL_RESULT:
      return [{
        dynamic: true,
        ...(event.state === "error" ? { errorText: stringValue(event.content) ?? stringifyValue(event.content) } : { output: parseMaybeJSON(stringValue(event.content)) ?? event.content }),
        preliminary: event.state === "streaming" ? true : undefined,
        toolCallId: stringValue(event.toolCallId),
        toolName: stringValue(event.toolName),
        type: event.state === "error" ? "tool-output-error" : "tool-output-available",
      }];
    case AGUIEventType.CUSTOM:
      return customEventToFinalMessageParts(event);
    default:
      return [];
  }
}

function customEventToFinalMessageParts(event: AGUIEvent): Record<string, unknown>[] {
  const value = recordValue(event.value);
  if (event.name === "approval-requested" && value) {
    const approval = recordValue(value.approval);
    const approvalId = stringValue(value.approvalId) ?? stringValue(value.approvalMessageId) ?? stringValue(approval?.id);
    if (!approvalId) return [];
    return [{
      approvalId,
      message: value.message,
      toolCallId: stringValue(value.toolCallId),
      toolName: stringValue(value.toolName),
      type: "tool-approval-request",
    }];
  }
  if (event.name === "approval-responded" && value) {
    const approval = recordValue(value.approval);
    const approvalId = stringValue(value.approvalId) ?? stringValue(approval?.id);
    if (!approvalId) return [];
    return [{
      approvalId,
      approved: approval?.approved,
      approvedAlways: approval?.always,
      toolCallId: stringValue(value.toolCallId),
      type: "tool-approval-response",
    }];
  }
  return [];
}

function reasoningPartId(event: AGUIEvent, turnId: string): string {
  return `reasoning_${stringValue(event.messageId) ?? turnId}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parseMaybeJSON(value: string | undefined): unknown {
  if (value === undefined || value === "") return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}

function normalizeFinishReason(reason: string | undefined): FinishReason {
  if (reason === "length" || reason === "content_filter" || reason === "tool_calls") return reason;
  return "stop";
}
