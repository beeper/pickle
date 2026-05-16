import {
  parseApprovalResponseContent,
  toOpenClawApprovalResolvePayload,
  type ParsedApprovalResponse,
} from "./approval";
import { createOpenClawStreamState, mapOpenClawEventToBeeperChunks } from "./openclaw-event-map";
import type { OpenClawGatewayRuntime, OpenClawGatewayEvent } from "./openclaw-runtime";
import type { OpenClawBridgeRegistry } from "./registry";
import { createTurnId, type BeeperUIMessageChunk } from "./stream-map";
import type { OpenClawSessionBinding } from "./types";

export interface OpenClawBridgeStreamPublisher {
  publish(binding: OpenClawSessionBinding, chunks: BeeperUIMessageChunk[]): Promise<void> | void;
}

export interface MatrixTextTurn {
  eventId: string;
  roomId: string;
  sender: string;
  text: string;
}

export class OpenClawMatrixBridgeAgent {
  readonly registry: OpenClawBridgeRegistry;
  readonly runtime: OpenClawGatewayRuntime;
  readonly streams: OpenClawBridgeStreamPublisher;

  constructor(options: {
    registry: OpenClawBridgeRegistry;
    runtime: OpenClawGatewayRuntime;
    streams: OpenClawBridgeStreamPublisher;
  }) {
    this.registry = options.registry;
    this.runtime = options.runtime;
    this.streams = options.streams;
  }

  async syncAgentContacts(): Promise<void> {
    for (const contact of await this.runtime.listAgentContacts()) {
      this.registry.upsertAgent(contact);
    }
    await this.registry.save();
  }

  async handleMatrixText(turn: MatrixTextTurn): Promise<void> {
    if (this.registry.hasDedupe(turn.eventId)) return;
    this.registry.markDedupe(turn.eventId);
    const binding = this.registry.getBindingByRoom(turn.roomId);
    if (!binding) {
      await this.registry.save();
      return;
    }
    const run = await this.runtime.sendMessage({
      idempotencyKey: turn.eventId,
      message: turn.text,
      sessionKey: binding.sessionKey,
    });
    this.registry.updateBinding(binding.id, (current) => ({
      ...current,
      lastMatrixEventId: turn.eventId,
      lastRunId: run.runId,
      updatedAt: Date.now(),
    }));
    await this.streamRun(binding, run.runId);
    await this.registry.save();
  }

  async handleApprovalContent(content: unknown, approvalId?: string): Promise<ParsedApprovalResponse | undefined> {
    const response = parseApprovalResponseContent(content);
    const resolvedApprovalId = response?.approvalId ?? approvalId;
    if (!response || !resolvedApprovalId) return undefined;
    await this.runtime.resolveApproval(toOpenClawApprovalResolvePayload(resolvedApprovalId, response));
    return response;
  }

  async streamRun(binding: OpenClawSessionBinding, runId: string): Promise<void> {
    const state = createOpenClawStreamState(createTurnId());
    for await (const gatewayEvent of this.runtime.eventsForRun(runId)) {
      const chunks = mapOpenClawEventToBeeperChunks(state, openClawEventFromGateway(gatewayEvent));
      if (chunks.length > 0) await this.streams.publish(binding, chunks);
    }
  }
}

function openClawEventFromGateway(event: OpenClawGatewayEvent): unknown {
  if (event.event && event.payload && typeof event.payload === "object") {
    return { ...(event.payload as Record<string, unknown>), payload: event.payload, type: event.event };
  }
  if (event.payload && typeof event.payload === "object") {
    return event.payload;
  }
  if (event.event) return { type: event.event, data: event.payload };
  return event;
}
