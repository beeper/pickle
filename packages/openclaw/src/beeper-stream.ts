import type { MatrixBeeper, MatrixBeeperAIRunSnapshot, SentEvent } from "@beeper/pickle";
import {
  applyFinalMessagePart,
  compactFinalContent,
  createFinalMessageAccumulator,
  finalizeAccumulatedAIMessage,
  getFinalMessageText,
  type BeeperFinalMessageAccumulator,
} from "@beeper/pickle/streams/beeper-message";
import { SerialQueue } from "./serial";
import { AGUIEventType, createTurnId, type AGUIEvent } from "./beeper-turn-events";

type FinishReason = "stop" | "length" | "content_filter" | "tool_calls" | null;

const BEEPER_AI_KEY = "com.beeper.ai";
const BEEPER_AI_METADATA_KEY = "com.beeper.ai.metadata";
const BEEPER_STREAM_DESCRIPTOR_KEY = "com.beeper.stream";
const BEEPER_AI_STREAM_TYPE = "com.beeper.llm";
const BEEPER_AI_STREAM_DELTAS_TYPE = "com.beeper.llm.deltas";

export interface BeeperTurnStreamCoordinatorClient {
  beeper: MatrixBeeper;
}

export interface BeeperStreamSubscriber {
  deviceId: string;
  userId: string;
}

export interface CreateBeeperTurnStreamCoordinatorOptions {
  agentId?: string;
  client: BeeperTurnStreamCoordinatorClient;
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
  message?: Record<string, unknown>;
  terminalPart?: AGUIEvent;
}

export class BeeperTurnStreamCoordinator {
  readonly roomId: string;
  readonly turnId: string;
  #accumulator: BeeperFinalMessageAccumulator;
  #agentId: string | undefined;
  #client: BeeperTurnStreamCoordinatorClient;
  #descriptor: Record<string, unknown> | undefined;
  #finalized = false;
  #initialMessageMetadata: Record<string, unknown>;
  #queue = new SerialQueue();
  #subscribers: BeeperStreamSubscriber[];
  #targetEventId: string | undefined;
  #threadRoot: string | undefined;
  #userId: string | undefined;

  constructor(options: CreateBeeperTurnStreamCoordinatorOptions) {
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
      const { eventId } = await this.#start();
      await this.#publishPart(eventId, part);
    });
  }

  async publishMany(parts: Iterable<AGUIEvent>): Promise<void> {
    return this.#queue.run(async () => {
      for (const part of parts) {
        if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
        const { eventId } = await this.#start();
        await this.#publishPart(eventId, part);
      }
    });
  }

  async finalize(options: BeeperStreamFinalizeOptions = {}): Promise<SentEvent> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Beeper stream is already finalized");
      const finishReason = normalizeFinishReason(options.finishReason);
      const { eventId } = await this.#start();
      const terminalPart = options.terminalPart ?? {
        finishReason,
        runId: this.turnId,
        threadId: this.turnId,
        type: AGUIEventType.RUN_FINISHED,
      };
      const snapshot = terminalPart.type === AGUIEventType.RUN_ERROR
        ? await this.#errorRun({
            message: terminalFallbackText(terminalPart),
            runId: this.turnId,
            type: stringValue((terminalPart as Record<string, unknown>).terminalType) === "abort" ? "abort" : "error",
          })
        : await this.#finishRun({
            finishReason,
            runId: this.turnId,
          });
      await this.#publishSnapshotEvents(eventId, snapshot);
      const finalMessage = options.message ?? nonEmptyRecordValue(snapshot.finalAIMessage) ?? finalizeAccumulatedAIMessage(this.#accumulator);
      const accumulatedText = getFinalMessageText(finalMessage);
      const finalText = options.body ?? options.finalText ?? (accumulatedText || snapshot.body || terminalFallbackText(terminalPart));
      const finalContent = compactFinalContent({
        aiMessage: finalMessage,
        body: finalText,
      });
      const finalMetadata = {
        ...this.#runMetadata(terminalPart.type === AGUIEventType.RUN_ERROR ? "error" : "complete", terminalPart),
        ...(recordValue(snapshot.metadata) ?? {}),
        status: this.#runMetadata(terminalPart.type === AGUIEventType.RUN_ERROR ? "error" : "complete", terminalPart).status,
      };
      const replacement = await this.#client.beeper.streams.finalizeMessage({
        body: finalContent.body || "...",
        content: {
          body: finalContent.body || "...",
          [BEEPER_AI_KEY]: finalContent.aiMessage,
          [BEEPER_AI_METADATA_KEY]: finalMetadata,
          [BEEPER_STREAM_DESCRIPTOR_KEY]: this.#streamDescriptor(),
          msgtype: "m.text",
        },
        eventId,
        roomId: this.roomId,
        topLevelContent: {
          "com.beeper.dont_render_edited": true,
        },
        ...(this.#userId ? { userId: this.#userId } : {}),
      });
      this.#finalized = true;
      return {
        eventId,
        roomId: replacement.roomId,
        raw: {
          logicalEventId: eventId,
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
    const snapshot = await this.#beginRun({
      ...(this.#agentId ? { agentId: this.#agentId } : {}),
      model: "openclaw/plugin",
      runId: this.turnId,
      threadId: this.turnId,
    });
    const metadata = {
      ...this.#runMetadata("streaming"),
      ...(recordValue(snapshot.metadata) ?? {}),
      data: this.#initialMessageMetadata,
    };
    const initialAIMessage = {
      id: this.turnId,
      metadata: { turn_id: this.turnId, ...this.#initialMessageMetadata },
      parts: [],
      role: "assistant",
      ...(recordValue(snapshot.initialAIMessage) ?? {}),
    };
    initialAIMessage.metadata = {
      turn_id: this.turnId,
      ...this.#initialMessageMetadata,
      ...(recordValue(initialAIMessage.metadata) ?? {}),
    };
    const target = await this.#client.beeper.streams.startMessage({
      content: {
        body: snapshot.body || "...",
        [BEEPER_AI_KEY]: initialAIMessage,
        [BEEPER_AI_METADATA_KEY]: metadata,
        [BEEPER_STREAM_DESCRIPTOR_KEY]: this.#streamDescriptor(),
        msgtype: "m.text",
      },
      roomId: this.roomId,
      streamType: BEEPER_AI_STREAM_TYPE,
      ...(this.#subscribers.length > 0 ? { subscribers: this.#subscribers } : {}),
      ...(this.#threadRoot ? { threadRootEventId: this.#threadRoot } : {}),
      ...(this.#userId ? { userId: this.#userId } : {}),
    });
    this.#descriptor = target.descriptor;
    this.#targetEventId = target.eventId;
    await this.#publishSnapshotEvents(target.eventId, snapshot);
    return { descriptor: target.descriptor, eventId: target.eventId, turnId: this.turnId };
  }

  async #publishPart(eventId: string, part: AGUIEvent): Promise<void> {
    const snapshot = await this.#appendRunEvent({
      event: part,
      runId: this.turnId,
    });
    await this.#publishSnapshotEvents(eventId, snapshot);
  }

  async #beginRun(options: { agentId?: string; model?: string; runId: string; threadId: string }): Promise<MatrixBeeperAIRunSnapshot> {
    return this.#client.beeper.aiRuns.begin(options);
  }

  async #appendRunEvent(options: { event: AGUIEvent; runId: string }): Promise<MatrixBeeperAIRunSnapshot> {
    return this.#client.beeper.aiRuns.appendEvent(options);
  }

  async #finishRun(options: { finishReason?: FinishReason; runId: string }): Promise<MatrixBeeperAIRunSnapshot> {
    return this.#client.beeper.aiRuns.finish({
      runId: options.runId,
      ...(options.finishReason ? { finishReason: options.finishReason } : {}),
    });
  }

  async #errorRun(options: { message?: string; runId: string; type?: "error" | "abort" }): Promise<MatrixBeeperAIRunSnapshot> {
    return this.#client.beeper.aiRuns.error(options);
  }

  async #publishSnapshotEvents(eventId: string, snapshot: MatrixBeeperAIRunSnapshot): Promise<void> {
    for (const part of snapshot.events as AGUIEvent[]) {
      await this.#client.beeper.streams.publishPart({
        ...(this.#agentId ? { agentId: this.#agentId } : {}),
        eventId,
        part,
        roomId: this.roomId,
        turnId: this.turnId,
      });
      for (const accumulatorPart of aguiEventToFinalMessageParts(this.turnId, part)) {
        applyFinalMessagePart(this.#accumulator, accumulatorPart);
      }
    }
  }

  #runMetadata(state: "streaming" | "complete" | "error", terminalPart?: AGUIEvent): Record<string, unknown> {
    return stripUndefined({
      agent: stripUndefined({
        id: this.#agentId,
      }),
      data: this.#initialMessageMetadata,
      messageId: this.turnId,
      model: "openclaw/plugin",
      preview: {
        text: "",
        truncated: false,
      },
      protocol: "ag-ui",
      runId: this.turnId,
      schema: "com.beeper.ai.run.v1",
      status: stripUndefined({
        error: state === "error" ? terminalError(terminalPart) : undefined,
        finishReason: state === "complete" ? terminalFinishReason(terminalPart) : undefined,
        state,
        terminal: terminalPart,
      }),
      threadId: this.turnId,
      usage: {
        completionTokens: 0,
        promptTokens: 0,
        totalTokens: 0,
      },
      usageDetails: {},
    });
  }

  #streamDescriptor(): Record<string, unknown> {
    if (this.#subscribers.length === 0) {
      return {
        type: BEEPER_AI_STREAM_DELTAS_TYPE,
      };
    }
    return stripUndefined({
      type: BEEPER_AI_STREAM_TYPE,
      user_id: this.#userId,
    });
  }
}

function terminalFallbackText(event: AGUIEvent | undefined): string {
  if (!event) return "";
  if (event.type === AGUIEventType.RUN_ERROR) {
    return stringValue(event.message) ?? stringValue(event.error) ?? "OpenClaw run failed";
  }
  return "";
}

function aguiEventToFinalMessageParts(turnId: string, event: AGUIEvent): Record<string, unknown>[] {
  switch (event.type) {
    case AGUIEventType.RUN_STARTED:
      return [{ messageId: stringValue(event.runId) ?? turnId, messageMetadata: { turn_id: stringValue(event.runId) ?? turnId }, type: "start" }];
    case AGUIEventType.RUN_FINISHED:
      return [{ finishReason: stringValue(event.finishReason) ?? "stop", messageMetadata: { finish_reason: stringValue(event.finishReason) ?? "stop", turn_id: stringValue(event.runId) ?? turnId }, type: "finish" }];
    case AGUIEventType.RUN_ERROR:
      if (stringValue((event as Record<string, unknown>).terminalType) === "abort") {
        return [{
          reason: stringValue((event as Record<string, unknown>).reason) ?? stringValue(event.message) ?? stringValue(event.error) ?? "Run aborted",
          type: "abort",
        }];
      }
      return [{ errorText: stringValue(event.message) ?? stringValue(event.error) ?? "Run failed", type: "error" }];
    case AGUIEventType.TEXT_MESSAGE_START:
      return [{ id: stringValue(event.messageId) ?? turnId, type: "text-start" }];
    case AGUIEventType.TEXT_MESSAGE_CONTENT:
      return [{ delta: stringValue(event.delta) ?? "", id: stringValue(event.messageId) ?? turnId, type: "text-delta" }];
    case AGUIEventType.TEXT_MESSAGE_END:
      return [{ id: stringValue(event.messageId) ?? turnId, type: "text-end" }];
    case AGUIEventType.REASONING_MESSAGE_START:
      return [{ id: reasoningPartId(event, turnId), type: "reasoning-start" }];
    case AGUIEventType.REASONING_MESSAGE_CONTENT:
      return [{ delta: stringValue(event.delta) ?? "", id: reasoningPartId(event, turnId), type: "reasoning-delta" }];
    case AGUIEventType.REASONING_MESSAGE_END:
      return [{ id: reasoningPartId(event, turnId), type: "reasoning-end" }];
    case AGUIEventType.TOOL_CALL_START:
      return [{ dynamic: true, toolCallId: stringValue(event.toolCallId), toolName: stringValue(event.toolName) ?? stringValue(event.toolCallName), type: "tool-input-start" }];
    case AGUIEventType.TOOL_CALL_ARGS:
      return [{ inputTextDelta: stringValue(event.delta) ?? stringifyValue(event.args), toolCallId: stringValue(event.toolCallId), type: "tool-input-delta" }];
    case AGUIEventType.TOOL_CALL_END:
      return [{ dynamic: true, input: event.input ?? parseMaybeJSON(stringValue(event.args)), toolCallId: stringValue(event.toolCallId), toolName: stringValue(event.toolName) ?? stringValue(event.toolCallName), type: "tool-input-available" }];
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
      approval: stripUndefined({
        actions: Array.isArray(value.approvalActions) ? value.approvalActions : undefined,
        id: approvalId,
      }),
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
      approvedAlways: approval?.approvedAlways ?? approval?.always,
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

function nonEmptyRecordValue(value: unknown): Record<string, unknown> | undefined {
  const record = recordValue(value);
  return record && Object.keys(record).length > 0 ? record : undefined;
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

function normalizeFinishReason(reason: string | undefined): FinishReason {
  if (reason === "length" || reason === "content_filter" || reason === "tool_calls") return reason;
  return "stop";
}

function terminalFinishReason(event: AGUIEvent | undefined): string {
  return stringValue(event?.finishReason) ?? "stop";
}

function terminalError(event: AGUIEvent | undefined): unknown {
  if (!event) return undefined;
  return stringValue(event.message) ?? stringValue(event.error) ?? event;
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
