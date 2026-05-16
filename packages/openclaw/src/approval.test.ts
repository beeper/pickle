import { describe, expect, it } from "vitest";
import {
  parseApprovalReactionContent,
  parseApprovalResponseContent,
  parseToolApprovalResponseChunk,
  toOpenClawApprovalResolvePayload,
} from "./approval";

describe("OpenClaw approval response parsing", () => {
  it("parses Beeper approval reactions into OpenClaw resolve payloads", () => {
    const response = parseApprovalReactionContent({
      "m.relates_to": {
        event_id: "approval_1",
        key: "approval.allow_once",
        rel_type: "m.annotation",
      },
      toolCallId: "call_1",
    });
    expect(response).toEqual({
      approvalId: "approval_1",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
      toolCallId: "call_1",
    });
    expect(toOpenClawApprovalResolvePayload("approval_1", response!)).toEqual({
      approvalId: "approval_1",
      decision: "approve",
      toolCallId: "call_1",
    });
  });

  it("maps allow-always and deny stream chunks", () => {
    expect(parseToolApprovalResponseChunk({
      approvalId: "approval_2",
      approved: true,
      approvedAlways: true,
      toolCallId: "call_2",
      type: "tool-approval-response",
    })).toEqual({
      approvalId: "approval_2",
      approved: true,
      approvedAlways: true,
      decision: "allow_always",
      toolCallId: "call_2",
    });

    const denied = parseToolApprovalResponseChunk({
      approvalId: "approval_3",
      approved: false,
      toolCallId: "call_3",
      type: "tool-approval-response",
    });
    expect(denied).toEqual({
      approvalId: "approval_3",
      approved: false,
      approvedAlways: false,
      decision: "deny",
      toolCallId: "call_3",
    });
    expect(toOpenClawApprovalResolvePayload("approval_3", denied!)).toEqual({
      approvalId: "approval_3",
      decision: "deny",
      toolCallId: "call_3",
    });
  });

  it("finds approval responses embedded in Beeper stream deltas", () => {
    expect(parseApprovalResponseContent({
      "com.beeper.llm.deltas": [
        {
          parts: [
            {
              approvalId: "approval_4",
              approved: true,
              decision: "allow-room",
              toolCallId: "call_4",
              type: "tool-approval-response",
            },
          ],
        },
      ],
    })).toEqual({
      approvalId: "approval_4",
      approved: true,
      approvedAlways: true,
      decision: "allow_room",
      toolCallId: "call_4",
    });
  });
});
