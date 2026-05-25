import { describe, expect, it } from "vitest";
import {
  createBeeperApprovalNotice,
  defaultBeeperApprovalChoices,
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

  it("preserves plugin approval kind from native content and reactions", () => {
    const reaction = parseApprovalReactionContent({
      approvalKind: "plugin",
      "m.relates_to": {
        event_id: "plugin:approval_1",
        key: "✅",
        rel_type: "m.annotation",
      },
    });
    expect(reaction).toEqual({
      approvalId: "plugin:approval_1",
      approvalKind: "plugin",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
    });
    expect(toOpenClawApprovalResolvePayload("plugin:approval_1", reaction!)).toEqual({
      approvalId: "plugin:approval_1",
      approvalKind: "plugin",
      decision: "approve",
    });

    expect(parseApprovalResponseContent({
      approvalId: "plugin:approval_2",
      approvalKind: "plugin",
      approved: false,
      type: "tool-approval-response",
    })).toEqual({
      approvalId: "plugin:approval_2",
      approvalKind: "plugin",
      approved: false,
      approvedAlways: false,
      decision: "deny",
    });
  });

  it("also accepts ai-bridge/OpenClaw Matrix approval choice keys and emoji as fallback reactions", () => {
    expect(parseApprovalReactionContent({
      "m.relates_to": {
        event_id: "approval_ai_1",
        key: "✅",
      },
    })).toMatchObject({
      approvalId: "approval_ai_1",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
    });

    expect(parseApprovalReactionContent({
      "m.relates_to": {
        event_id: "approval_ai_2",
        key: "always_approve",
      },
    })).toMatchObject({
      approvalId: "approval_ai_2",
      approved: true,
      approvedAlways: true,
      decision: "allow_always",
    });

    expect(parseApprovalReactionContent({
      "m.relates_to": {
        event_id: "approval_ai_3",
        key: "❌",
      },
    })).toMatchObject({
      approvalId: "approval_ai_3",
      approved: false,
      approvedAlways: false,
      decision: "deny",
    });
  });

  it("builds the same approval notice shape as ai-bridge matrix content", () => {
    expect(defaultBeeperApprovalChoices()).toEqual([
      { alias: "✅", key: "approve", label: "Allow once" },
      { alias: "☑️", key: "always_approve", label: "Allow always" },
      { alias: "❌", key: "deny", label: "Deny", style: "danger" },
    ]);
    expect(createBeeperApprovalNotice({
      approvalId: "approval_1",
      messageId: "msg_1",
      toolCallId: "call_1",
      toolName: "shell",
    })).toMatchObject({
      "com.beeper.ai": {
        id: "approval_approval_1",
        metadata: {
          approval: { id: "approval_1" },
          turn_id: "approval_approval_1",
        },
        parts: [{
          approval: {
            actions: [
              { decision: "allow-once", id: "allow-once", reactionKey: "approval.allow_once", title: "Allow Once", variant: "secondary" },
              { decision: "allow-session", id: "allow-session", reactionKey: "approval.allow_session", title: "Allow This Session", variant: "secondary" },
              { decision: "allow-room", id: "allow-room", reactionKey: "approval.allow_room", title: "Allow This Room", variant: "secondary" },
              { decision: "deny", id: "deny", reactionKey: "approval.deny", title: "Cancel", variant: "destructive" },
            ],
            id: "approval_1",
          },
          state: "approval-requested",
          toolCallId: "call_1",
          toolName: "shell",
          type: "dynamic-tool",
        }],
        role: "assistant",
      },
      choices: [
        { alias: "✅", key: "approve", label: "Allow once" },
        { alias: "☑️", key: "always_approve", label: "Allow always" },
        { alias: "❌", key: "deny", label: "Deny", style: "danger" },
      ],
      id: "approval_1",
      messageId: "msg_1",
      schema: "com.beeper.ai.approval.v1",
      state: "requested",
      toolCallId: "call_1",
      toolName: "shell",
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

  it("accepts AG-UI approval response events and accumulated Beeper AI parts", () => {
    expect(parseToolApprovalResponseChunk({
      name: "approval-responded",
      type: "CUSTOM",
      value: {
        approval: {
          always: true,
          approved: true,
          id: "approval_5",
        },
        toolCallId: "call_5",
      },
    })).toEqual({
      approvalId: "approval_5",
      approved: true,
      approvedAlways: true,
      decision: "allow_always",
      toolCallId: "call_5",
    });

    expect(parseApprovalResponseContent({
      "com.beeper.ai": {
        parts: [
          {
            approval: {
              approved: true,
              id: "approval_6",
              reason: "allow",
            },
            state: "approval-responded",
            toolCallId: "call_6",
            type: "dynamic-tool",
          },
        ],
      },
    })).toEqual({
      approvalId: "approval_6",
      approved: true,
      approvedAlways: false,
      decision: "allow_once",
      toolCallId: "call_6",
    });
  });
});
