import { describe, expect, it } from "vitest";
import { piEventNoticeText, piEventSessionTitle } from "./pi-notice";

describe("piEventNoticeText", () => {
  it("creates notices for session lifecycle events", () => {
    expect(piEventNoticeText({ type: "session_start", reason: "startup" })).toBe(
      "Session started (startup)."
    );
  });

  it("creates notices for outside-turn status events", () => {
    expect(piEventNoticeText({ type: "queue_update", followUp: ["next"], steering: [] })).toBe(
      "Queue updated: 1 follow-up and 0 steering messages."
    );
    expect(piEventNoticeText({ type: "session_info_changed", name: "Desktop" })).toBe(
      "Session renamed to Desktop."
    );
    expect(piEventNoticeText({ type: "session_info_changed" })).toBe("Session information changed.");
    expect(piEventNoticeText({ type: "thinking_level_changed", level: "high" })).toBe(
      "Thinking level set to High."
    );
  });

  it("creates notices for compaction and retry lifecycle events", () => {
    expect(piEventNoticeText({ type: "compaction_start", reason: "history limit" })).toBe(
      "Compaction started (history limit)."
    );
    expect(piEventNoticeText({ type: "compaction_end", willRetry: true, errorMessage: "busy" })).toBe(
      "Compaction will retry: busy."
    );
    expect(piEventNoticeText({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, errorMessage: "rate limited" })).toBe(
      "Retry 2 of 3 started: rate limited."
    );
    expect(piEventNoticeText({ type: "auto_retry_end", attempt: 2, success: true })).toBe(
      "Retry 2 succeeded."
    );
  });

  it("extracts generated session titles", () => {
    expect(piEventSessionTitle({ type: "session_info_changed", name: "Project plan" })).toBe("Project plan");
    expect(piEventSessionTitle({ type: "queue_update", name: "Project plan" })).toBeUndefined();
  });

  it("does not turn assistant content or turn bookends into notices", () => {
    expect(piEventNoticeText({ type: "message_update" })).toBeUndefined();
    expect(piEventNoticeText({ type: "message_end" })).toBeUndefined();
    expect(piEventNoticeText({ type: "turn_start" })).toBeUndefined();
    expect(piEventNoticeText({ type: "turn_end" })).toBeUndefined();
    expect(piEventNoticeText({ type: "agent_start" })).toBeUndefined();
    expect(piEventNoticeText({ type: "agent_end" })).toBeUndefined();
  });
});
