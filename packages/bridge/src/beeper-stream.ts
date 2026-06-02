import type { MatrixBeeper, MatrixBeeperAIRunStreamResult, SentEvent } from "@beeper/pickle";

type AGUIEvent = Record<string, unknown> & { type?: string };
type FinishReason = "stop" | "length" | "content_filter" | "tool_calls";

const BEEPER_AI_STREAM_TYPE = "com.beeper.llm";

const EVENT_RUN_ERROR = "RUN_ERROR";
const EVENT_RUN_FINISHED = "RUN_FINISHED";
const EVENT_RUN_STARTED = "RUN_STARTED";
const EVENT_TEXT_MESSAGE_START = "TEXT_MESSAGE_START";
const EVENT_TEXT_MESSAGE_CONTENT = "TEXT_MESSAGE_CONTENT";
const EVENT_TEXT_MESSAGE_END = "TEXT_MESSAGE_END";
const EVENT_REASONING_START = "REASONING_START";
const EVENT_REASONING_MESSAGE_START = "REASONING_MESSAGE_START";
const EVENT_REASONING_MESSAGE_CONTENT = "REASONING_MESSAGE_CONTENT";
const EVENT_REASONING_MESSAGE_END = "REASONING_MESSAGE_END";
const EVENT_REASONING_END = "REASONING_END";
const EVENT_TOOL_CALL_START = "TOOL_CALL_START";
const EVENT_TOOL_CALL_RESULT = "TOOL_CALL_RESULT";
const EVENT_ACTIVITY_SNAPSHOT = "ACTIVITY_SNAPSHOT";
const EVENT_ACTIVITY_DELTA = "ACTIVITY_DELTA";

export interface BeeperTurnStreamClient {
  beeper: MatrixBeeper;
}

export interface BeeperStreamSubscriber {
  deviceId: string;
  userId: string;
}

export interface CreateBeeperTurnStreamOptions {
  agentId?: string;
  agentName?: string;
  client: BeeperTurnStreamClient;
  initialMessageMetadata?: Record<string, unknown>;
  model?: string;
  roomId: string;
  subscribers?: BeeperStreamSubscriber[];
  threadRoot?: string;
  turnId: string;
  userId?: string;
}

export interface BeeperStreamStartResult {
  descriptor: Record<string, unknown>;
  eventId: string;
  turnId: string;
}

export interface BeeperStreamFinalizeOptions {
  finishReason?: string;
  terminalPart?: AGUIEvent;
  usage?: unknown;
}

export interface RunBeeperTurnStreamOptions<T> {
  events: Iterable<T> | AsyncIterable<T>;
  finishReason?: string;
  mapEvent: (event: T, stream: BeeperTurnStream) => Iterable<AGUIEvent> | AGUIEvent | undefined | Promise<Iterable<AGUIEvent> | AGUIEvent | undefined>;
  stream: BeeperTurnStream;
}

export class BeeperTurnStream {
  readonly roomId: string;
  readonly turnId: string;
  #agentId: string | undefined;
  #agentName: string | undefined;
  #client: BeeperTurnStreamClient;
  #descriptor: Record<string, unknown> | undefined;
  #eventId: string | undefined;
  #finalized = false;
  #initialMessageMetadata: Record<string, unknown>;
  #messageId: string | undefined;
  #model: string;
  #queue = new SerialQueue();
  #started = false;
  #subscribers: BeeperStreamSubscriber[];
  #threadRoot: string | undefined;
  #userId: string | undefined;

  constructor(options: CreateBeeperTurnStreamOptions) {
    this.#agentId = options.agentId;
    this.#agentName = options.agentName;
    this.#client = options.client;
    this.#initialMessageMetadata = options.initialMessageMetadata ?? {};
    this.#model = options.model ?? "bridge/plugin";
    this.roomId = options.roomId;
    this.turnId = options.turnId;
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

  async publish(event: AGUIEvent): Promise<void> {
    await this.publishMany([event]);
  }

  async publishMany(events: Iterable<AGUIEvent>): Promise<void> {
    return this.#queue.run(async () => {
      for (const event of events) {
        if (this.#finalized) throw new Error("Cannot publish to finalized Beeper stream");
        await this.#ensureStarted();
        await this.#client.beeper.aiRunStreams.appendEvent({
          event: this.#canonicalizeEvent(event),
          runId: this.turnId,
        });
      }
    });
  }

  async finalize(options: BeeperStreamFinalizeOptions = {}): Promise<SentEvent> {
    return this.#queue.run(async () => {
      if (this.#finalized) throw new Error("Beeper stream is already finalized");
      await this.#ensureStarted();
      const terminal = options.terminalPart ?? {
        finishReason: normalizeFinishReason(options.finishReason),
        runId: this.turnId,
        threadId: this.turnId,
        type: EVENT_RUN_FINISHED,
      };
      const finishReason = normalizeFinishReason(stringValue(terminal.finishReason) ?? options.finishReason);
      const result = terminal.type === EVENT_RUN_ERROR
        ? await this.#client.beeper.aiRunStreams.error({
            message: terminalFallbackText(terminal),
            runId: this.turnId,
            terminal,
            type: stringValue(terminal.terminalType) === "abort" ? "abort" : "error",
          })
        : await this.#client.beeper.aiRunStreams.finish({
            finishReason,
            runId: this.turnId,
            terminal,
            ...(options.usage !== undefined ? { usage: options.usage } : {}),
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
      model: this.#model,
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

  #canonicalizeEvent(event: AGUIEvent): AGUIEvent {
    const canonical = { ...event };
    const messageId = this.#messageId ?? `msg-${this.turnId}`;
    if (canonical.type === EVENT_RUN_STARTED || canonical.type === EVENT_RUN_FINISHED) {
      canonical.runId = this.turnId;
      canonical.threadId = this.turnId;
    }
    if (canonical.type === EVENT_RUN_ERROR && !stringValue(canonical.message)) {
      canonical.message = terminalFallbackText(event);
    }
    if (usesCanonicalMessageId(canonical.type)) {
      canonical.messageId = messageId;
    }
    if (canonical.type === EVENT_TOOL_CALL_START) {
      canonical.parentMessageId = messageId;
    }
    return stripUndefined(canonical);
  }
}

export async function runBeeperTurnStream<T>(options: RunBeeperTurnStreamOptions<T>): Promise<SentEvent> {
  try {
    for await (const event of toAsyncIterable(options.events)) {
      const mapped = await options.mapEvent(event, options.stream);
      const events = mapped === undefined ? [] : isAGUIEvent(mapped) ? [mapped] : [...mapped];
      if (events.length > 0) await options.stream.publishMany(events);
    }
    return await options.stream.finalize(options.finishReason === undefined ? {} : { finishReason: options.finishReason });
  } catch (error) {
    await options.stream.finalize({
      terminalPart: {
        error: { message: errorMessage(error) },
        message: errorMessage(error),
        runId: options.stream.turnId,
        threadId: options.stream.turnId,
        type: EVENT_RUN_ERROR,
      },
    });
    throw error;
  }
}

class SerialQueue {
  #tail = Promise.resolve();

  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(operation, operation);
    this.#tail = next.then(() => undefined, () => undefined);
    return next;
  }
}

function usesCanonicalMessageId(type: unknown): boolean {
  return type === EVENT_TEXT_MESSAGE_START ||
    type === EVENT_TEXT_MESSAGE_CONTENT ||
    type === EVENT_TEXT_MESSAGE_END ||
    type === EVENT_REASONING_START ||
    type === EVENT_REASONING_MESSAGE_START ||
    type === EVENT_REASONING_MESSAGE_CONTENT ||
    type === EVENT_REASONING_MESSAGE_END ||
    type === EVENT_REASONING_END ||
    type === EVENT_ACTIVITY_SNAPSHOT ||
    type === EVENT_ACTIVITY_DELTA;
}

function terminalFallbackText(event: AGUIEvent | undefined): string {
  if (!event) return "";
  if (event.type === EVENT_RUN_ERROR) {
    return stringValue(event.message) ?? stringValue(event.error) ?? "Bridge run failed";
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

async function* toAsyncIterable<T>(events: Iterable<T> | AsyncIterable<T>): AsyncIterable<T> {
  if (Symbol.asyncIterator in events) {
    yield* events;
    return;
  }
  yield* events;
}

function isAGUIEvent(value: unknown): value is AGUIEvent {
  return Boolean(recordValue(value)?.type);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
