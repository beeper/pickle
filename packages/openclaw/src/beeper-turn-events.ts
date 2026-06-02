export { EventType as AGUIEventType } from "@beeper/pickle-ag-ui";
export type { AGUIEvent } from "@beeper/pickle-ag-ui";

import { EventType as AGUIEventType, type AGUIEvent } from "@beeper/pickle-ag-ui";
import { defaultBeeperApprovalActions, defaultBeeperApprovalChoices } from "./approval";

export interface ApprovalRunState {
  toolCallIdToApprovalId: Record<string, string>;
}

export function createApprovalRunState(): ApprovalRunState {
  return { toolCallIdToApprovalId: {} };
}

export function mapOpenClawCustom(name: string, value: unknown): AGUIEvent[] {
  return [{ name, type: AGUIEventType.CUSTOM, value }];
}

export function mapOpenClawApprovalRequest(
  state: ApprovalRunState,
  event: { approvalId?: string; message?: string; toolCallId?: string; toolName?: string },
): AGUIEvent {
  const toolCallId = event.toolCallId ?? event.approvalId ?? "approval";
  const approvalId = event.approvalId ?? `approval_${toolCallId}`;
  state.toolCallIdToApprovalId[toolCallId] = approvalId;
  return {
    name: "approval-requested",
    type: AGUIEventType.CUSTOM,
    value: {
      approval: {
        id: approvalId,
        needsApproval: true,
      },
      approvalActions: defaultBeeperApprovalActions(),
      approvalMessageId: approvalId,
      choices: defaultBeeperApprovalChoices(),
      message: event.message,
      toolCallId,
      toolName: event.toolName,
    },
  };
}

export function mapOpenClawApprovalResponse(event: {
  approvalId: string;
  approved: boolean;
  approvedAlways?: boolean;
  toolCallId?: string;
}): AGUIEvent {
  return {
    name: "approval-responded",
    type: AGUIEventType.CUSTOM,
    value: {
      approval: {
        always: event.approvedAlways,
        approved: event.approved,
        id: event.approvalId,
      },
      toolCallId: event.toolCallId,
    },
  };
}
