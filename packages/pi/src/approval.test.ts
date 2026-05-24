import { describe, expect, it } from "vitest";
import {
  APPROVAL_ALLOW_ALWAYS_REACTION,
  APPROVAL_ALLOW_ONCE_REACTION,
  APPROVAL_ALLOW_ROOM_REACTION,
  APPROVAL_ALLOW_SESSION_REACTION,
  APPROVAL_DENY_REACTION,
  parseApprovalReactionContent,
  parseApprovalReactionKey,
  parseApprovalResponseContent,
  parseToolApprovalResponseEvent,
  parseToolApprovalResponseChunk,
} from "./approval";

describe("Beeper approval response parsing", () => {
  it("parses approval reaction keys", () => {
    expect(parseApprovalReactionKey(APPROVAL_ALLOW_ONCE_REACTION)).toEqual({
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
    });
    expect(parseApprovalReactionKey(APPROVAL_ALLOW_ALWAYS_REACTION)).toEqual({
      approved: true,
      approvedAlways: true,
      decision: "allow_always",
    });
    expect(parseApprovalReactionKey(APPROVAL_ALLOW_SESSION_REACTION)).toEqual({
      approved: true,
      approvedAlways: false,
      decision: "allow_session",
    });
    expect(parseApprovalReactionKey(APPROVAL_ALLOW_ROOM_REACTION)).toEqual({
      approved: true,
      approvedAlways: true,
      decision: "allow_room",
    });
    expect(parseApprovalReactionKey(APPROVAL_DENY_REACTION)).toEqual({
      approved: false,
      approvedAlways: false,
      decision: "deny",
    });
    expect(parseApprovalReactionKey("👍")).toBeUndefined();
  });

  it("parses Matrix reaction content", () => {
    expect(
      parseApprovalReactionContent({
        "m.relates_to": {
          event_id: "$request",
          key: APPROVAL_ALLOW_ALWAYS_REACTION,
          rel_type: "m.annotation",
        },
      })
    ).toMatchObject({ approved: true, approvedAlways: true, decision: "allow_always" });
  });

  it("parses direct AG-UI approval response events", () => {
    expect(
      parseToolApprovalResponseEvent({
        name: "approval-responded",
        type: "CUSTOM",
        value: {
          approval: {
            approved: true,
            id: "approval_call_1",
          },
          toolCallId: "call_1",
        },
      })
    ).toEqual({
      approvalId: "approval_call_1",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
      toolCallId: "call_1",
    });

    expect(
      parseToolApprovalResponseEvent({
        name: "approval-responded",
        type: "CUSTOM",
        value: {
          approval: {
            always: true,
            approved: true,
            id: "approval_call_2",
          },
          toolCallId: "call_2",
        },
      })
    ).toMatchObject({ approved: true, approvedAlways: true, decision: "allow_always" });
  });

  it("keeps parsing legacy tool approval response chunks", () => {
    expect(
      parseToolApprovalResponseChunk({
        approvalId: "approval_call_1",
        approved: true,
        approvedAlways: false,
        toolCallId: "call_1",
        type: "tool-approval-response",
      })
    ).toEqual({
      approvalId: "approval_call_1",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
      toolCallId: "call_1",
    });

    expect(
      parseToolApprovalResponseChunk({
        approvalId: "approval_call_2",
        decision: "allow-room",
        approved: true,
        toolCallId: "call_2",
        type: "tool-approval-response",
      })
    ).toMatchObject({ approved: true, approvedAlways: true, decision: "allow_room" });

    expect(
      parseToolApprovalResponseChunk({
        approvalId: "approval_call_3",
        approved: false,
        approvedAlways: true,
        toolCallId: "call_3",
        type: "tool-approval-response",
      })
    ).toMatchObject({ approved: false, approvedAlways: true, decision: "deny" });
  });

  it("parses stream-like AG-UI approval response content", () => {
    expect(
      parseApprovalResponseContent({
        "com.beeper.llm.deltas": [
          {
            parts: [
              {
                name: "approval-responded",
                type: "CUSTOM",
                value: {
                  approval: {
                    always: true,
                    approved: true,
                    id: "approval_call_3",
                  },
                  toolCallId: "call_3",
                },
              },
            ],
            seq: 1,
            turn_id: "turn_1",
          },
        ],
      })
    ).toEqual({
      approvalId: "approval_call_3",
      approved: true,
      approvedAlways: true,
      decision: "allow_always",
      toolCallId: "call_3",
    });
  });

  it("ignores malformed approval response content", () => {
    expect(parseToolApprovalResponseChunk({ approved: true, type: "tool-approval-request" })).toBeUndefined();
    expect(parseToolApprovalResponseChunk({ approved: "true", type: "tool-approval-response" })).toBeUndefined();
    expect(parseApprovalResponseContent({ "com.beeper.llm.deltas": [{ parts: [{ type: "finish" }] }] })).toBeUndefined();
  });
});
