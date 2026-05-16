export const APPROVAL_ALLOW_ONCE_REACTION = "approval.allow_once";
export const APPROVAL_ALLOW_ALWAYS_REACTION = "approval.allow_always";
export const APPROVAL_ALLOW_SESSION_REACTION = "approval.allow_session";
export const APPROVAL_ALLOW_ROOM_REACTION = "approval.allow_room";
export const APPROVAL_DENY_REACTION = "approval.deny";

export type ApprovalDecision = "allow_once" | "allow_always" | "allow_session" | "allow_room" | "deny";
export type OpenClawApprovalResolveDecision = "approve" | "approve_always" | "deny";

export interface ParsedApprovalResponse {
  approvalId?: string;
  approved: boolean;
  approvedAlways: boolean;
  decision: ApprovalDecision;
  toolCallId?: string;
}

export interface OpenClawApprovalResolvePayload {
  approvalId: string;
  decision: OpenClawApprovalResolveDecision;
  toolCallId?: string;
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
  const toolCallId = stringValue(recordValue(content)?.toolCallId);
  if (approvalId) response.approvalId = approvalId;
  if (toolCallId) response.toolCallId = toolCallId;
  return response;
}

export function parseToolApprovalResponseChunk(chunk: unknown): ParsedApprovalResponse | undefined {
  const record = recordValue(chunk);
  if (record?.type !== "tool-approval-response" || typeof record.approved !== "boolean") return undefined;
  const explicitDecision = approvalDecisionValue(record.decision);
  const approvedAlways = record.approvedAlways === true || explicitDecision === "allow_always" || explicitDecision === "allow_room";
  const response: ParsedApprovalResponse = {
    approved: record.approved,
    approvedAlways,
    decision: record.approved ? explicitDecision ?? (approvedAlways ? "allow_always" : "allow_once") : "deny",
  };
  const approvalId = stringValue(record.approvalId);
  const toolCallId = stringValue(record.toolCallId);
  if (approvalId) response.approvalId = approvalId;
  if (toolCallId) response.toolCallId = toolCallId;
  return response;
}

export function parseApprovalResponseContent(content: unknown): ParsedApprovalResponse | undefined {
  return parseToolApprovalResponseChunk(content) ?? parseApprovalResponseFromDeltas(content) ?? parseApprovalReactionContent(content);
}

export function toOpenClawApprovalResolvePayload(
  approvalId: string,
  response: ParsedApprovalResponse
): OpenClawApprovalResolvePayload {
  const payload: OpenClawApprovalResolvePayload = {
    approvalId,
    decision: response.approved ? (response.approvedAlways ? "approve_always" : "approve") : "deny",
  };
  if (response.toolCallId) payload.toolCallId = response.toolCallId;
  return payload;
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
    default:
      return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
