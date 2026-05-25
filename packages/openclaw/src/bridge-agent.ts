import {
  approvalKindForId,
  parseApprovalResponseContent,
  toOpenClawApprovalResolvePayload,
  type ParsedApprovalResponse,
} from "./approval";
import type { OpenClawGatewayRuntime, OpenClawMatrixMessageMetadata } from "./openclaw-runtime";
import type { OpenClawBridgeRegistry } from "./registry";
import type { OpenClawSessionBinding } from "./types";

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

  constructor(options: {
    registry: OpenClawBridgeRegistry;
    runtime: OpenClawGatewayRuntime;
  }) {
    this.registry = options.registry;
    this.runtime = options.runtime;
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
