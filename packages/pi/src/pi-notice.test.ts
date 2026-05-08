import { describe, expect, it } from "vitest";
import { piEventNoticeText } from "./pi-notice";

describe("piEventNoticeText", () => {
  it("creates notices for outside-turn status events", () => {
    expect(piEventNoticeText({ type: "queue_update", followUp: ["next"], steering: [] })).toBe(
      "Pi queue updated: 1 follow-up, 0 steering messages."
    );
    expect(piEventNoticeText({ type: "session_info_changed", name: "Desktop" })).toBe(
      "Pi session renamed to Desktop."
    );
    expect(piEventNoticeText({ type: "thinking_level_changed", level: "high" })).toBe(
      "Pi thinking level changed to high."
    );
  });

  it("creates notices for compaction and retry lifecycle events", () => {
    expect(piEventNoticeText({ type: "compaction_start", reason: "history limit" })).toBe(
      "Pi compaction started (history limit)."
    );
    expect(piEventNoticeText({ type: "compaction_end", willRetry: true, errorMessage: "busy" })).toBe(
      "Pi compaction will retry: busy."
    );
    expect(piEventNoticeText({ type: "auto_retry_start", attempt: 2, maxAttempts: 3, errorMessage: "rate limited" })).toBe(
      "Pi retry 2/3 started: rate limited."
    );
    expect(piEventNoticeText({ type: "auto_retry_end", attempt: 2, success: true })).toBe(
      "Pi retry 2 succeeded."
    );
  });

  it("does not turn assistant content or turn bookends into notices", () => {
    expect(piEventNoticeText({ type: "message_update" })).toBeUndefined();
    expect(piEventNoticeText({ type: "message_end" })).toBeUndefined();
    expect(piEventNoticeText({ type: "turn_start" })).toBeUndefined();
    expect(piEventNoticeText({ type: "agent_start" })).toBeUndefined();
  });
});
