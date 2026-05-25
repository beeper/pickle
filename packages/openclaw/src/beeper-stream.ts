import type { MatrixBeeper, SentEvent } from "@beeper/pickle";
import {
  applyFinalMessagePart,
  compactFinalContent,
  createFinalMessageAccumulator,
  finalizeAccumulatedAIMessage,
  getFinalMessageText,
  type BeeperFinalMessageAccumulator,
} from "@beeper/pickle/streams/beeper-message";
import type { OpenClawBridgeStreamPublisher, OpenClawStreamPublishResult } from "./bridge-agent";
import { SerialQueue } from "./serial";
import { AGUIEventType, createTurnId, type AGUIEvent } from "./stream-map";
import type { OpenClawBridgeConfig, OpenClawSessionBinding } from "./types";

type FinishReason = "stop" | "length" | "content_filter" | "tool_calls" | null;

const BEEPER_AI_KEY = "com.beeper.ai";
const BEEPER_AI_METADATA_KEY = "com.beeper.ai.metadata";
const BEEPER_STREAM_DESCRIPTOR_KEY = "com.beeper.stream";
const BEEPER_AI_STREAM_TYPE = "com.beeper.llm";

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
  finalization?: OpenClawBridgeConfig["streamFinalization"];
  finishReason?: string;
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
      await this.#publishPart(eventId, options.terminalPart ?? {
        finishReason,
        runId: this.turnId,
        threadId: this.turnId,
        type: AGUIEventType.RUN_FINISHED,
      });
      const finalMessage = options.message ?? finalizeAccumulatedAIMessage(this.#accumulator);
      const accumulatedText = getFinalMessageText(finalMessage);
      const finalText = options.body ?? options.finalText ?? (accumulatedText || terminalFallbackText(options.terminalPart));
      const finalContent = compactFinalContent({
        aiMessage: finalMessage,
        body: finalText,
      });
      const finalMetadata = this.#runMetadata(options.terminalPart?.type === AGUIEventType.RUN_ERROR ? "error" : "complete", options.terminalPart);
      const finalization = options.finalization ?? "replace";
      if (finalization === "native-only") {
        this.#finalized = true;
        return {
          eventId,
          roomId: this.roomId,
          raw: {
            logicalEventId: eventId,
            nativeOnly: true,
          },
        };
      }
      const topLevelContent = finalization === "append"
        ? {}
        : {
            "com.beeper.dont_render_edited": true,
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
        topLevelContent,
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
    const metadata = this.#runMetadata("streaming");
    const target = await this.#client.beeper.streams.startMessage({
      content: {
        body: "...",
        [BEEPER_AI_KEY]: {
          id: this.turnId,
          metadata: { turn_id: this.turnId, ...this.#initialMessageMetadata },
          parts: [],
          role: "assistant",
        },
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
    return { descriptor: target.descriptor, eventId: target.eventId, turnId: this.turnId };
  }

  async #publishPart(eventId: string, part: AGUIEvent): Promise<void> {
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
    return stripUndefined({
      type: BEEPER_AI_STREAM_TYPE,
      user_id: this.#userId,
    });
  }
}

export interface OpenClawBeeperStreamPublisherOptions {
  client: BeeperStreamPublisherClient;
  config?: Pick<OpenClawBridgeConfig, "streamFinalization">;
  userId?: string;
}

export class OpenClawBeeperStreamPublisher implements OpenClawBridgeStreamPublisher {
  #client: BeeperStreamPublisherClient;
  #config: Pick<OpenClawBridgeConfig, "streamFinalization">;
  #publishers = new Map<string, BeeperStreamPublisher>();
  #userId: string | undefined;

  constructor(options: OpenClawBeeperStreamPublisherOptions) {
    this.#client = options.client;
    this.#config = options.config ?? {};
    this.#userId = options.userId;
  }

  async publish(binding: OpenClawSessionBinding, events: AGUIEvent[]): Promise<OpenClawStreamPublishResult | undefined> {
    if (!events.length) return undefined;
    const key = streamKey(binding, events);
    let publisher = this.#publishers.get(key);
    if (!publisher) {
      publisher = new BeeperStreamPublisher({
        agentId: binding.agentId,
        client: this.#client,
        initialMessageMetadata: {
          agent_id: binding.agentId,
          session_key: binding.sessionKey,
        },
        roomId: binding.roomId,
        turnId: firstRunId(events) ?? createTurnId(),
        ...(this.#userId ? { userId: this.#userId } : {}),
      });
      this.#publishers.set(key, publisher);
    }

    const terminal = events.find(isTerminalEvent);
    const nonTerminal = terminal ? events.filter((event) => event !== terminal) : events;
    await publisher.publishMany(nonTerminal);
    if (terminal) {
      try {
        const finalized = await publisher.finalize({
          finalization: this.#config.streamFinalization,
          terminalPart: terminal,
        });
        const raw = recordValue(finalized.raw);
        return { targetEventId: stringValue(raw?.logicalEventId) ?? finalized.eventId };
      } finally {
        this.#publishers.delete(key);
      }
    }
    return publisher.targetEventId ? { targetEventId: publisher.targetEventId } : undefined;
  }
}

function streamKey(binding: OpenClawSessionBinding, events: AGUIEvent[]): string {
  return `${binding.roomId}:${firstRunId(events) ?? binding.lastStreamRunId ?? binding.lastRunId ?? binding.sessionKey}`;
}

function firstRunId(events: AGUIEvent[]): string | undefined {
  for (const event of events) {
    const record = event as Record<string, unknown>;
    const runId = stringValue(record.runId) ?? stringValue(record.threadId) ?? stringValue(record.messageId);
    if (runId) return runId;
  }
  return undefined;
}

function isTerminalEvent(event: AGUIEvent): boolean {
  return event.type === AGUIEventType.RUN_FINISHED || event.type === AGUIEventType.RUN_ERROR;
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
    return [{ approvalId, message: value.message, toolCallId: stringValue(value.toolCallId), toolName: stringValue(value.toolName), type: "tool-approval-request" }];
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
