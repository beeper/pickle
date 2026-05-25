import {
  approvalKindForId,
  parseApprovalResponseContent,
  toOpenClawApprovalResolvePayload,
  type ParsedApprovalResponse,
} from "./approval";
import { createOpenClawStreamState, mapOpenClawEventToBeeperChunks } from "./openclaw-event-map";
import type { OpenClawGatewayRuntime, OpenClawGatewayEvent, OpenClawMatrixMessageMetadata } from "./openclaw-runtime";
import type { OpenClawBridgeRegistry } from "./registry";
import { AGUIEventType, type AGUIEvent } from "./stream-map";
import type { OpenClawSessionBinding } from "./types";

export interface OpenClawBridgeStreamPublisher {
  publish(binding: OpenClawSessionBinding, events: AGUIEvent[]): Promise<OpenClawStreamPublishResult | undefined> | OpenClawStreamPublishResult | undefined;
}

export interface OpenClawStreamPublishResult {
  targetEventId?: string;
}

export interface MatrixTextTurn {
  attachments?: unknown[];
  eventId: string;
  matrix?: OpenClawMatrixMessageMetadata;
  roomId: string;
  replyToEventId?: string;
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
    const binding = this.registry.getBindingByRoom(turn.roomId);
    if (!binding) {
      this.registry.markDedupe(turn.eventId);
      await this.registry.save();
      return;
    }
    const sessionKey = await this.ensureSession(binding);
    const run = await this.runtime.sendMessage({
      ...(turn.attachments && turn.attachments.length > 0 ? { attachments: turn.attachments } : {}),
      idempotencyKey: turn.eventId,
      ...(turn.matrix ? { matrix: turn.matrix } : {}),
      message: turn.text,
      ...(turn.replyToEventId ? { replyTo: { eventId: turn.replyToEventId, roomId: turn.roomId } } : {}),
      sessionKey,
    });
    this.registry.updateBinding(binding.id, (current) => ({
      ...current,
      lastMatrixEventId: turn.eventId,
      lastRunId: run.runId,
      sessionKey: run.sessionKey,
      updatedAt: Date.now(),
    }));
    await this.streamRun({ ...binding, sessionKey: run.sessionKey }, run.runId);
    this.registry.markDedupe(turn.eventId);
    await this.registry.save();
  }

  async handleApprovalContent(content: unknown, approvalId?: string): Promise<ParsedApprovalResponse | undefined> {
    const response = parseApprovalResponseContent(content);
    const resolvedApprovalId = response?.approvalId ?? approvalId;
    if (!response || !resolvedApprovalId) return undefined;
    const inferredApprovalKind = approvalKindForId(resolvedApprovalId);
    if (!response.approvalKind && inferredApprovalKind) response.approvalKind = inferredApprovalKind;
    await this.runtime.resolveApproval(toOpenClawApprovalResolvePayload(resolvedApprovalId, response));
    return response;
  }

  async streamRun(binding: OpenClawSessionBinding, runId: string): Promise<void> {
    const state = createOpenClawStreamState(runId);
    for await (const gatewayEvent of this.runtime.eventsForRun(runId)) {
      const chunks = mapOpenClawEventToBeeperChunks(state, openClawEventFromGateway(gatewayEvent));
      if (chunks.length > 0) {
        const result = await this.streams.publish({
          ...binding,
          lastRunId: runId,
          lastStreamRunId: runId,
        }, chunks);
        const targetEventId = result?.targetEventId;
        if (targetEventId) {
          this.registry.updateBinding(binding.id, (current) => ({
            ...current,
            lastStreamRunId: runId,
            lastStreamTargetEventId: targetEventId,
            updatedAt: Date.now(),
          }));
        }
        if (chunks.some(isTerminalStreamEvent)) break;
      }
    }
  }

  async ensureSession(binding: OpenClawSessionBinding): Promise<string> {
    if (binding.sessionKey !== agentPortalSessionKey(binding.agentId)) return binding.sessionKey;
    const createOptions: { agentId: string; label?: string } = {
      agentId: binding.agentId,
    };
    if (binding.label !== undefined) createOptions.label = binding.label;
    const session = await this.runtime.createSession(createOptions);
    this.registry.updateBinding(binding.id, (current) => ({
      ...current,
      sessionKey: session.key,
      updatedAt: Date.now(),
    }));
    return session.key;
  }
}

export function agentPortalSessionKey(agentId: string): string {
  return `agent:${agentId}`;
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

function isTerminalStreamEvent(event: AGUIEvent): boolean {
  return event.type === AGUIEventType.RUN_FINISHED || event.type === AGUIEventType.RUN_ERROR;
}
