export const APPROVAL_ALLOW_ONCE_REACTION = "approval.allow_once";
export const APPROVAL_ALLOW_ALWAYS_REACTION = "approval.allow_always";
export const APPROVAL_ALLOW_SESSION_REACTION = "approval.allow_session";
export const APPROVAL_ALLOW_ROOM_REACTION = "approval.allow_room";
export const APPROVAL_DENY_REACTION = "approval.deny";

export const AI_BRIDGE_APPROVAL_CHOICE_APPROVE = "approve";
export const AI_BRIDGE_APPROVAL_CHOICE_ALWAYS_APPROVE = "always_approve";
export const AI_BRIDGE_APPROVAL_CHOICE_DENY = "deny";

export interface BeeperApprovalChoice {
  alias: string;
  key: string;
  label: string;
  shortcut?: string;
  style?: string;
}

export type ApprovalDecision = "allow_once" | "allow_always" | "allow_session" | "allow_room" | "deny";
export type OpenClawApprovalKind = "exec" | "plugin";
export type OpenClawApprovalResolveDecision = "approve" | "approve_always" | "deny";

export interface ParsedApprovalResponse {
  approvalId?: string;
  approvalKind?: OpenClawApprovalKind;
  approved: boolean;
  approvedAlways: boolean;
  decision: ApprovalDecision;
  toolCallId?: string;
}

export interface OpenClawApprovalResolvePayload {
  approvalId: string;
  approvalKind?: OpenClawApprovalKind;
  decision: OpenClawApprovalResolveDecision;
  toolCallId?: string;
}

export function defaultBeeperApprovalChoices(): BeeperApprovalChoice[] {
  return [
    {
      alias: "✅",
      key: AI_BRIDGE_APPROVAL_CHOICE_APPROVE,
      label: "Allow once",
    },
    {
      alias: "☑️",
      key: AI_BRIDGE_APPROVAL_CHOICE_ALWAYS_APPROVE,
      label: "Allow always",
    },
    {
      alias: "❌",
      key: AI_BRIDGE_APPROVAL_CHOICE_DENY,
      label: "Deny",
      style: "danger",
    },
  ];
}

export function defaultBeeperApprovalActions(decisions: readonly ApprovalDecision[] = ["allow_once", "allow_session", "allow_room", "deny"]): Record<string, unknown>[] {
  return decisions.map((decision) => ({
    decision: decision.replace(/_/gu, "-"),
    id: decision.replace(/_/gu, "-"),
    reactionKey: approvalReactionKey(decision),
    title: approvalActionTitle(decision),
    variant: decision === "deny" ? "destructive" : "secondary",
  }));
}

export function parseApprovalReactionKey(key: unknown): ParsedApprovalResponse | undefined {
  switch (key) {
    case APPROVAL_ALLOW_ONCE_REACTION:
      return { approved: true, approvedAlways: false, decision: "allow_once" };
    case APPROVAL_ALLOW_ALWAYS_REACTION:
      return { approved: true, approvedAlways: true, decision: "allow_always" };
    case APPROVAL_ALLOW_SESSION_REACTION:
      return { approved: true, approvedAlways: false, decision: "allow_session" };
    case APPROVAL_ALLOW_ROOM_REACTION:
      return { approved: true, approvedAlways: true, decision: "allow_room" };
    case APPROVAL_DENY_REACTION:
      return { approved: false, approvedAlways: false, decision: "deny" };
    default:
      return undefined;
  }
}

export function parseApprovalReactionContent(content: unknown): ParsedApprovalResponse | undefined {
  const relates = recordValue(content)?.["m.relates_to"];
  const response = parseApprovalReactionKey(recordValue(relates)?.key);
  if (!response) return undefined;
  const approvalId = stringValue(recordValue(content)?.approvalId) ?? stringValue(recordValue(relates)?.event_id);
  const approvalKind = approvalKindValue(recordValue(content)?.approvalKind ?? recordValue(content)?.kind ?? recordValue(relates)?.approvalKind);
  const toolCallId = stringValue(recordValue(content)?.toolCallId);
  if (approvalId) response.approvalId = approvalId;
  if (approvalKind) response.approvalKind = approvalKind;
  if (toolCallId) response.toolCallId = toolCallId;
  return response;
}

export function parseToolApprovalResponseChunk(chunk: unknown): ParsedApprovalResponse | undefined {
  const record = recordValue(chunk);
  if (record?.type === "CUSTOM" && record.name === "approval-responded") return parseApprovalRespondedCustomValue(record.value);
  if (record?.type !== "tool-approval-response" || typeof record.approved !== "boolean") return undefined;
  const explicitDecision = approvalDecisionValue(record.decision);
  const approvedAlways = record.approvedAlways === true || explicitDecision === "allow_always" || explicitDecision === "allow_room";
  const response: ParsedApprovalResponse = {
    approved: record.approved,
    approvedAlways,
    decision: record.approved ? explicitDecision ?? (approvedAlways ? "allow_always" : "allow_once") : "deny",
  };
  const approvalId = stringValue(record.approvalId);
  const approvalKind = approvalKindValue(record.approvalKind ?? record.kind);
  const toolCallId = stringValue(record.toolCallId);
  if (approvalId) response.approvalId = approvalId;
  if (approvalKind) response.approvalKind = approvalKind;
  if (toolCallId) response.toolCallId = toolCallId;
  return response;
}

export function parseApprovalResponseContent(content: unknown): ParsedApprovalResponse | undefined {
  return parseToolApprovalResponseChunk(content)
    ?? parseApprovalResponseFromDeltas(content)
    ?? parseApprovalResponseFromAIMessage(content);
}

export function toOpenClawApprovalResolvePayload(
  approvalId: string,
  response: ParsedApprovalResponse
): OpenClawApprovalResolvePayload {
  const payload: OpenClawApprovalResolvePayload = {
    approvalId,
    ...(response.approvalKind ? { approvalKind: response.approvalKind } : {}),
    decision: response.approved ? (response.approvedAlways ? "approve_always" : "approve") : "deny",
  };
  if (response.toolCallId) payload.toolCallId = response.toolCallId;
  return payload;
}

export function approvalChoicesAsAny(choices: readonly BeeperApprovalChoice[] = defaultBeeperApprovalChoices()): Record<string, unknown>[] {
  return choices.map((choice) => stripUndefined({
    alias: choice.alias,
    key: choice.key,
    label: choice.label,
    shortcut: choice.shortcut,
    style: choice.style,
  }));
}

export function createBeeperApprovalNotice(params: {
  approvalId: string;
  messageId: string;
  body?: string;
  input?: Record<string, unknown>;
  state?: "approval-requested" | "approval-responded";
  approved?: boolean;
  decision?: string;
  expiresAtMs?: number;
  toolCallId?: string;
  toolName?: string;
  choices?: readonly BeeperApprovalChoice[];
}): Record<string, unknown> {
  const toolCallId = params.toolCallId ?? params.approvalId;
  const toolName = params.toolName ?? "OpenClaw tool";
  const approvalActions = defaultBeeperApprovalActions();
  return stripUndefined({
    "com.beeper.ai": {
      id: `approval_${params.approvalId}`,
      metadata: {
        approval: stripUndefined({
          expiresAt: params.expiresAtMs,
          id: params.approvalId,
        }),
        turn_id: `approval_${params.approvalId}`,
      },
      parts: [{
        approval: stripUndefined({
          actions: approvalActions,
          approved: params.approved,
          decision: params.decision,
          expiresAtMs: params.expiresAtMs,
          id: params.approvalId,
        }),
        id: toolCallId,
        input: stripUndefined({
          ...(params.input ?? {}),
          approvalActions,
          ...(params.expiresAtMs !== undefined ? { expiresAtMs: params.expiresAtMs } : {}),
        }),
        name: toolName,
        state: params.state ?? "approval-requested",
        toolCallId,
        type: "tool-call",
      }],
      role: "assistant",
    },
    choices: approvalChoicesAsAny(params.choices),
    id: params.approvalId,
    messageId: params.messageId,
    schema: "com.beeper.ai.approval.v1",
    state: "requested",
    toolCallId,
    toolName,
  });
}

function parseApprovalResponseFromDeltas(content: unknown): ParsedApprovalResponse | undefined {
  const deltas = recordValue(content)?.["com.beeper.llm.deltas"];
  if (!Array.isArray(deltas)) return undefined;
  for (const delta of deltas) {
    const parts = recordValue(delta)?.parts;
    if (!Array.isArray(parts)) continue;
    for (const part of parts) {
      const response = parseToolApprovalResponseChunk(part);
      if (response) return response;
    }
  }
  return undefined;
}

function parseApprovalResponseFromAIMessage(content: unknown): ParsedApprovalResponse | undefined {
  const parts = recordValue(recordValue(content)?.["com.beeper.ai"])?.parts;
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    const record = recordValue(part);
    const approval = recordValue(record?.approval);
    if (!record || !approval || typeof approval.approved !== "boolean") continue;
    const explicitDecision = approvalDecisionValue(approval.reason ?? approval.decision ?? record.decision);
    const approvedAlways = approval.always === true || record.approvedAlways === true || explicitDecision === "allow_always" || explicitDecision === "allow_room";
    const response: ParsedApprovalResponse = {
      approved: approval.approved,
      approvedAlways,
      decision: approval.approved ? explicitDecision ?? (approvedAlways ? "allow_always" : "allow_once") : "deny",
    };
    const approvalId = stringValue(approval.id) ?? stringValue(record.approvalId);
    const approvalKind = approvalKindValue(approval.kind ?? approval.approvalKind ?? record.approvalKind ?? record.kind);
    const toolCallId = stringValue(record.toolCallId);
    if (approvalId) response.approvalId = approvalId;
    if (approvalKind) response.approvalKind = approvalKind;
    if (toolCallId) response.toolCallId = toolCallId;
    return response;
  }
  return undefined;
}

function parseApprovalRespondedCustomValue(value: unknown): ParsedApprovalResponse | undefined {
  const record = recordValue(value);
  const approval = recordValue(record?.approval);
  const approved = approval?.approved;
  if (!record || !approval || typeof approved !== "boolean") return undefined;
  const explicitDecision = approvalDecisionValue(approval.reason ?? approval.decision ?? record.decision);
  const approvedAlways = approval.always === true || record.approvedAlways === true || explicitDecision === "allow_always" || explicitDecision === "allow_room";
  const response: ParsedApprovalResponse = {
    approved,
    approvedAlways,
    decision: approved ? explicitDecision ?? (approvedAlways ? "allow_always" : "allow_once") : "deny",
  };
  const approvalId = stringValue(approval.id) ?? stringValue(record.approvalId);
  const approvalKind = approvalKindValue(approval.kind ?? approval.approvalKind ?? record.approvalKind ?? record.kind);
  const toolCallId = stringValue(record.toolCallId);
  if (approvalId) response.approvalId = approvalId;
  if (approvalKind) response.approvalKind = approvalKind;
  if (toolCallId) response.toolCallId = toolCallId;
  return response;
}

function approvalDecisionValue(value: unknown): ApprovalDecision | undefined {
  switch (value) {
    case "allow_once":
    case "allow_always":
    case "allow_session":
    case "allow_room":
    case "deny":
      return value;
    case "allow-once":
      return "allow_once";
    case "allow-always":
      return "allow_always";
    case "allow-session":
      return "allow_session";
    case "allow-room":
      return "allow_room";
    case "allow":
      return "allow_once";
    case "always":
      return "allow_always";
    default:
      return undefined;
  }
}

function approvalReactionKey(decision: ApprovalDecision): string {
  switch (decision) {
    case "allow_once":
      return APPROVAL_ALLOW_ONCE_REACTION;
    case "allow_always":
      return APPROVAL_ALLOW_ALWAYS_REACTION;
    case "allow_session":
      return APPROVAL_ALLOW_SESSION_REACTION;
    case "allow_room":
      return APPROVAL_ALLOW_ROOM_REACTION;
    case "deny":
      return APPROVAL_DENY_REACTION;
  }
}

function approvalActionTitle(decision: ApprovalDecision): string {
  switch (decision) {
    case "allow_once":
      return "Allow Once";
    case "allow_always":
      return "Allow Always";
    case "allow_session":
      return "Allow This Session";
    case "allow_room":
      return "Allow This Room";
    case "deny":
      return "Cancel";
  }
}

export function approvalKindForId(approvalId: string | undefined): OpenClawApprovalKind | undefined {
  if (!approvalId) return undefined;
  if (approvalId.startsWith("plugin:") || approvalId.startsWith("plugin_") || approvalId.startsWith("plugin.")) return "plugin";
  if (approvalId.startsWith("exec:") || approvalId.startsWith("exec_") || approvalId.startsWith("exec.")) return "exec";
  return undefined;
}

function approvalKindValue(value: unknown): OpenClawApprovalKind | undefined {
  if (value === "plugin" || value === "plugin-approval" || value === "plugin.approval") return "plugin";
  if (value === "exec" || value === "execution" || value === "exec-approval" || value === "exec.approval") return "exec";
  return undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(record: T): T {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined)) as T;
}
