import type { MatrixBeeper, MatrixBeeperAIRunStreamResult, SentEvent } from "@beeper/pickle";
import { SerialQueue } from "./serial";
import { AGUIEventType, createTurnId, type AGUIEvent } from "./beeper-turn-events";

type FinishReason = "stop" | "length" | "content_filter" | "tool_calls";

const BEEPER_AI_STREAM_TYPE = "com.beeper.llm";

export interface BeeperTurnStreamCoordinatorClient {
  beeper: MatrixBeeper;
}

export interface BeeperStreamSubscriber {
  deviceId: string;
  userId: string;
}

export interface CreateBeeperTurnStreamCoordinatorOptions {
  agentId?: string;
  agentName?: string;
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
  #agentId: string | undefined;
  #agentName: string | undefined;
  #client: BeeperTurnStreamCoordinatorClient;
  #descriptor: Record<string, unknown> | undefined;
  #eventId: string | undefined;
  #finalized = false;
  #initialMessageMetadata: Record<string, unknown>;
  #messageId: string | undefined;
  #queue = new SerialQueue();
  #started = false;
  #subscribers: BeeperStreamSubscriber[];
  #threadRoot: string | undefined;
  #userId: string | undefined;

  constructor(options: CreateBeeperTurnStreamCoordinatorOptions) {
    this.#agentId = options.agentId;
    this.#agentName = options.agentName;
    this.#client = options.client;
    this.#initialMessageMetadata = options.initialMessageMetadata ?? {};
    this.roomId = options.roomId;
    this.turnId = options.turnId ?? createTurnId();
    this.#subscribers = options.subscribers ?? [];
    this.#threadRoot = options.threadRoot;
    this.#userId = options.userId;
  }

  get targetEventId(): string | undefined {
    return this.#eventId;
  }

  async start(): Promise<BeeperStreamStartResult> {
    return this.#queue.run(async () => {
      const result = await this.#ensureStarted();
      return { descriptor: result.descriptor, eventId: result.eventId, turnId: this.turnId };
    });
  }

  async publish(part: AGUIEvent): Promise<void> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
      await this.#ensureStarted();
      await this.#client.beeper.aiRunStreams.appendEvent({
        event: this.#canonicalizePart(part),
        runId: this.turnId,
      });
    });
  }

  async publishMany(parts: Iterable<AGUIEvent>): Promise<void> {
    return this.#queue.run(async () => {
      for (const part of parts) {
        if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
        await this.#ensureStarted();
        await this.#client.beeper.aiRunStreams.appendEvent({
          event: this.#canonicalizePart(part),
          runId: this.turnId,
        });
      }
    });
  }

  async finalize(options: BeeperStreamFinalizeOptions = {}): Promise<SentEvent> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Beeper stream is already finalized");
      await this.#ensureStarted();
      const terminalPart = options.terminalPart ?? {
        finishReason: normalizeFinishReason(options.finishReason),
        runId: this.turnId,
        threadId: this.turnId,
        type: AGUIEventType.RUN_FINISHED,
      };
      const finishReason = normalizeFinishReason(stringValue((terminalPart as Record<string, unknown>).finishReason) ?? options.finishReason);
      const result = terminalPart.type === AGUIEventType.RUN_ERROR
        ? await this.#client.beeper.aiRunStreams.error({
            message: terminalFallbackText(terminalPart),
            runId: this.turnId,
            terminal: terminalPart as Record<string, unknown>,
            type: stringValue((terminalPart as Record<string, unknown>).terminalType) === "abort" ? "abort" : "error",
          })
        : await this.#client.beeper.aiRunStreams.finish({
            finishReason,
            runId: this.turnId,
            terminal: terminalPart as Record<string, unknown>,
          });
      this.#rememberStreamResult(result);
      this.#finalized = true;
      return {
        eventId: result.eventId,
        roomId: result.roomId,
        raw: {
          logicalEventId: result.eventId,
          raw: result.raw,
          replacementEventId: result.replacementEventId,
        },
      };
    });
  }

  async #ensureStarted(): Promise<BeeperStreamStartResult> {
    if (this.#started && this.#eventId) {
      return {
        descriptor: this.#descriptor ?? {},
        eventId: this.#eventId,
        turnId: this.turnId,
      };
    }
    this.#started = true;
    const result = await this.#client.beeper.aiRunStreams.start({
      ...(this.#agentId ? { agentId: this.#agentId } : {}),
      ...(this.#agentName ? { agentName: this.#agentName } : {}),
      data: this.#initialMessageMetadata,
      model: "openclaw/plugin",
      roomId: this.roomId,
      runId: this.turnId,
      streamType: BEEPER_AI_STREAM_TYPE,
      ...(this.#subscribers.length > 0 ? { subscribers: this.#subscribers } : {}),
      ...(this.#threadRoot ? { threadRootEventId: this.#threadRoot } : {}),
      threadId: this.turnId,
      ...(this.#userId ? { userId: this.#userId } : {}),
    });
    this.#rememberStreamResult(result);
    if (!this.#eventId) throw new Error("Beeper AI run stream did not return an event ID");
    return {
      descriptor: this.#descriptor ?? {},
      eventId: this.#eventId,
      turnId: this.turnId,
    };
  }

  #rememberStreamResult(result: MatrixBeeperAIRunStreamResult): void {
    this.#descriptor = recordValue(result.descriptor) ?? this.#descriptor;
    this.#eventId = result.eventId || this.#eventId;
    this.#messageId = result.messageId || this.#messageId || `msg-${this.turnId}`;
  }

  #canonicalizePart(part: AGUIEvent): AGUIEvent {
    const event = { ...(part as Record<string, unknown>) };
    const messageId = this.#messageId ?? `msg-${this.turnId}`;
    if (event.type === AGUIEventType.RUN_STARTED || event.type === AGUIEventType.RUN_FINISHED) {
      event.runId = this.turnId;
      event.threadId = this.turnId;
    }
    if (event.type === AGUIEventType.RUN_ERROR && !stringValue(event.message)) {
      event.message = terminalFallbackText(part);
    }
    if (usesCanonicalMessageId(event.type)) {
      event.messageId = messageId;
    }
    if (event.type === AGUIEventType.TOOL_CALL_START) {
      event.parentMessageId = messageId;
    }
    return stripUndefined(event) as AGUIEvent;
  }
}

function usesCanonicalMessageId(type: unknown): boolean {
  return type === AGUIEventType.TEXT_MESSAGE_START ||
    type === AGUIEventType.TEXT_MESSAGE_CONTENT ||
    type === AGUIEventType.TEXT_MESSAGE_END ||
    type === AGUIEventType.REASONING_START ||
    type === AGUIEventType.REASONING_MESSAGE_START ||
    type === AGUIEventType.REASONING_MESSAGE_CONTENT ||
    type === AGUIEventType.REASONING_MESSAGE_END ||
    type === AGUIEventType.REASONING_END ||
    type === AGUIEventType.TOOL_CALL_RESULT;
}

function terminalFallbackText(event: AGUIEvent | undefined): string {
  if (!event) return "";
  if (event.type === AGUIEventType.RUN_ERROR) {
    return stringValue(event.message) ?? stringValue(event.error) ?? "OpenClaw run failed";
  }
  return "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function normalizeFinishReason(reason: string | undefined): FinishReason {
  if (reason === "length" || reason === "content_filter" || reason === "tool_calls") return reason;
  return "stop";
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
