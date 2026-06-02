import {
  approvalKindForId,
  parseApprovalResponseContent,
  toOpenClawApprovalResolvePayload,
  type ParsedApprovalResponse,
} from "./approval";
import {
  BEEPER_SESSION_REASONING_LEVEL,
  type OpenClawMatrixMessageMetadata,
  type OpenClawRunRef,
  type OpenClawSessionCreateOptions,
  type OpenClawSessionPatchOptions,
  type OpenClawSessionSendOptions,
  type OpenClawSessionTurnRuntime,
} from "./openclaw-runtime";
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
  readonly runtime: OpenClawSessionTurnRuntime;
  readonly #sendTurn: (options: OpenClawSessionSendOptions) => Promise<OpenClawRunRef>;
  readonly #configuredSessions = new Set<string>();
  readonly #inFlightEvents = new Set<string>();
  readonly #turnsByBinding = new Map<string, Promise<void>>();

  constructor(options: {
    registry: OpenClawBridgeRegistry;
    runtime: OpenClawSessionTurnRuntime;
    sendTurn?: (options: OpenClawSessionSendOptions) => Promise<OpenClawRunRef>;
  }) {
    this.registry = options.registry;
    this.runtime = options.runtime;
    this.#sendTurn = options.sendTurn ?? ((sendOptions) => this.runtime.sendMessage(sendOptions));
  }

  async syncAgentContacts(): Promise<void> {
    this.registry.replaceAgents(await this.runtime.listAgentContacts());
    await this.registry.save();
  }

  async handleMatrixText(turn: MatrixTextTurn): Promise<void> {
    if (this.registry.hasDedupe(turn.eventId)) return;
    if (this.#inFlightEvents.has(turn.eventId)) return;
    const binding = this.registry.getBindingByRoom(turn.roomId);
    if (!binding) {
      this.registry.markDedupe(turn.eventId);
      await this.registry.save();
      return;
    }
    const processTurn = async () => {
      const sessionKey = await this.ensureSession(binding);
      const matrix: OpenClawMatrixMessageMetadata = {
        ...(turn.matrix ?? {}),
        roomId: turn.roomId,
      };
      const run = await this.#sendTurn({
        ...(turn.attachments && turn.attachments.length > 0 ? { attachments: turn.attachments } : {}),
        idempotencyKey: turn.eventId,
        matrix,
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
    };
    this.#inFlightEvents.add(turn.eventId);
    const previous = this.#turnsByBinding.get(binding.id) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(processTurn);
    this.#turnsByBinding.set(binding.id, current);
    try {
      await current;
    } finally {
      if (this.#turnsByBinding.get(binding.id) === current) this.#turnsByBinding.delete(binding.id);
      this.#inFlightEvents.delete(turn.eventId);
    }
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
    if (binding.sessionKey !== agentPortalSessionKey(binding.agentId)) {
      await this.ensureSessionConfiguration({
        agentId: binding.agentId,
        key: binding.sessionKey,
        reasoningLevel: BEEPER_SESSION_REASONING_LEVEL,
      });
      return binding.sessionKey;
    }
    const createOptions: OpenClawSessionCreateOptions = {
      agentId: binding.agentId,
      reasoningLevel: BEEPER_SESSION_REASONING_LEVEL,
    };
    if (binding.label !== undefined) createOptions.label = binding.label;
    const session = await this.runtime.createSession(createOptions);
    this.registry.updateBinding(binding.id, (current) => ({
      ...current,
      kind: "session",
      sessionKey: session.key,
      updatedAt: Date.now(),
    }));
    this.#configuredSessions.add(session.key);
    return session.key;
  }

  private async ensureSessionConfiguration(options: OpenClawSessionPatchOptions): Promise<void> {
    if (this.#configuredSessions.has(options.key)) return;
    await this.runtime.patchSession(options);
    this.#configuredSessions.add(options.key);
  }
}

export function agentPortalSessionKey(agentId: string): string {
  return `agent:${agentId}`;
}
