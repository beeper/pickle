import { describe, expect, it } from "vitest";
import { toClientEvent } from "./events";
import type { MatrixCoreEvent } from "./runtime-types";

describe("toClientEvent", () => {
  it("maps every generic sync event kind", () => {
    const cases: Array<[MatrixCoreEvent["type"], string]> = [
      ["account_data", "accountData"],
      ["device_list", "deviceList"],
      ["ephemeral", "ephemeral"],
      ["membership", "membership"],
      ["presence", "presence"],
      ["raw_event", "raw"],
      ["receipt", "receipt"],
      ["redaction", "redaction"],
      ["room_state", "roomState"],
      ["to_device", "toDevice"],
      ["typing", "typing"],
    ];

    for (const [type, kind] of cases) {
      const mapped = toClientEvent({
        event: {
          class: kind,
          content: { ok: true },
          decrypted: true,
          encrypted: true,
          eventId: "$event",
          nextBatch: "s2",
          originServerTs: 1,
          raw: { raw: true },
          roomId: "!room:example.com",
          section: "section",
          sender: "@alice:example.com",
          stateKey: "@alice:example.com",
          type: "m.test",
        },
        nextBatch: "s2",
        since: "s1",
        type,
      } as Extract<MatrixCoreEvent, { event: unknown }>);

      expect(mapped).toMatchObject({
        content: { ok: true },
        decrypted: true,
        encrypted: true,
        eventId: "$event",
        kind,
        nextBatch: "s2",
        raw: { raw: true },
        roomId: "!room:example.com",
        section: "section",
        sender: { isMe: false, userId: "@alice:example.com" },
        type: "m.test",
      });
      if (kind === "raw") {
        expect(mapped).toMatchObject({ since: "s1" });
      }
    }
  });
});
