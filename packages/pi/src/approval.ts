export const APPROVAL_ALLOW_ONCE_REACTION = "approval.allow_once";
export const APPROVAL_ALLOW_ALWAYS_REACTION = "approval.allow_always";
export const APPROVAL_DENY_REACTION = "approval.deny";

export type ApprovalReactionKey =
  | typeof APPROVAL_ALLOW_ONCE_REACTION
  | typeof APPROVAL_ALLOW_ALWAYS_REACTION
  | typeof APPROVAL_DENY_REACTION;

export type ApprovalDecision = "allow_once" | "allow_always" | "deny";

export interface ParsedApprovalResponse {
  approvalId?: string;
  approved: boolean;
  approvedAlways: boolean;
  decision: ApprovalDecision;
  toolCallId?: string;
}

export interface ToolApprovalResponseChunk {
  approvalId?: string;
  approved: boolean;
  approvedAlways?: boolean;
  toolCallId?: string;
  type: "tool-approval-response";
}

export function parseApprovalReactionKey(key: unknown): ParsedApprovalResponse | undefined {
  switch (key) {
    case APPROVAL_ALLOW_ONCE_REACTION:
      return { approved: true, approvedAlways: false, decision: "allow_once" };
    case APPROVAL_ALLOW_ALWAYS_REACTION:
      return { approved: true, approvedAlways: true, decision: "allow_always" };
    case APPROVAL_DENY_REACTION:
      return { approved: false, approvedAlways: false, decision: "deny" };
    default:
      return undefined;
  }
}

export function parseApprovalReactionContent(content: unknown): ParsedApprovalResponse | undefined {
  const relates = recordValue(content)?.["m.relates_to"];
  return parseApprovalReactionKey(recordValue(relates)?.key);
}

export function parseToolApprovalResponseChunk(chunk: unknown): ParsedApprovalResponse | undefined {
  const record = recordValue(chunk);
  if (record?.type !== "tool-approval-response" || typeof record.approved !== "boolean") {
    return undefined;
  }

  const approvedAlways = record.approvedAlways === true;
  const response: ParsedApprovalResponse = {
    approved: record.approved,
    approvedAlways,
    decision: record.approved ? (approvedAlways ? "allow_always" : "allow_once") : "deny",
  };
  const approvalId = stringValue(record.approvalId);
  const toolCallId = stringValue(record.toolCallId);
  if (approvalId) response.approvalId = approvalId;
  if (toolCallId) response.toolCallId = toolCallId;
  return response;
}

export function parseApprovalResponseContent(content: unknown): ParsedApprovalResponse | undefined {
  return parseToolApprovalResponseChunk(content) ?? parseApprovalResponseFromDeltas(content);
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
