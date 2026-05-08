import { describe, expect, it } from "vitest";
import { MatrixInboundTurnQueue } from "./queue";
import type { MatrixInboundTurn } from "./types";

describe("MatrixInboundTurnQueue", () => {
  it("dequeues control, priority, then default turns with FIFO order within each priority", () => {
    const queue = new MatrixInboundTurnQueue();
    queue.enqueue(turn({ id: "default-1", priority: "default" }));
    queue.enqueue(turn({ id: "priority-1", priority: "priority" }));
    queue.enqueue(turn({ id: "control-1", priority: "control" }));
    queue.enqueue(turn({ id: "priority-2", priority: "priority" }));
    queue.enqueue(turn({ id: "default-2", priority: "default" }));
    queue.enqueue(turn({ id: "control-2", priority: "control" }));

    expect(queue.snapshot().map((queued) => queued.id)).toEqual([
      "control-1",
      "control-2",
      "priority-1",
      "priority-2",
      "default-1",
      "default-2",
    ]);
    expect(queue.drainDispatchable().map((queued) => queued.id)).toEqual([
      "control-1",
      "control-2",
      "priority-1",
      "priority-2",
      "default-1",
      "default-2",
    ]);
    expect(queue.isEmpty).toBe(true);
  });

  it("cancels queued turns by id or Matrix event id without disturbing the rest of the queue", () => {
    const queue = new MatrixInboundTurnQueue([
      turn({ eventId: "$a", id: "a", priority: "default" }),
      turn({ eventId: "$b", id: "b", priority: "control" }),
      turn({ eventId: "$c", id: "c", priority: "priority" }),
    ]);

    expect(queue.cancelById("missing")).toBeUndefined();
    expect(queue.cancelById("b")?.eventId).toBe("$b");
    expect(queue.cancelByEventId("$a")?.id).toBe("a");
    expect(queue.snapshot().map((queued) => queued.id)).toEqual(["c"]);
    expect(queue.size).toBe(1);
  });

  it("updates queued text by Matrix event id in place in queue order", () => {
    const queue = new MatrixInboundTurnQueue([
      turn({ eventId: "$a", id: "a", text: "old" }),
      turn({ eventId: "$b", id: "b", text: "unchanged" }),
    ]);

    expect(queue.updateTextByEventId("$missing", "ignored")).toBeUndefined();
    expect(queue.updateTextByEventId("$a", "new")).toMatchObject({ eventId: "$a", text: "new" });
    expect(queue.snapshot().map((queued) => queued.text)).toEqual(["new", "unchanged"]);
  });

  it("only pops a dispatch candidate when canDispatch accepts the current head turn", () => {
    const queue = new MatrixInboundTurnQueue([
      turn({ id: "control", priority: "control", roomId: "!busy:example.com" }),
      turn({ id: "priority", priority: "priority", roomId: "!idle:example.com" }),
    ]);
    const canDispatch = (queued: MatrixInboundTurn) => queued.roomId === "!idle:example.com";

    expect(queue.peek(canDispatch)).toBeUndefined();
    expect(queue.dispatchNext(canDispatch)).toBeUndefined();
    expect(queue.snapshot().map((queued) => queued.id)).toEqual(["control", "priority"]);

    expect(queue.cancelById("control")?.id).toBe("control");
    expect(queue.dispatchNext(canDispatch)?.id).toBe("priority");
    expect(queue.isEmpty).toBe(true);
  });

  it("stops draining as soon as the current head turn cannot dispatch", () => {
    const queue = new MatrixInboundTurnQueue([
      turn({ id: "control-1", priority: "control", roomId: "!idle:example.com" }),
      turn({ id: "control-2", priority: "control", roomId: "!busy:example.com" }),
      turn({ id: "priority-1", priority: "priority", roomId: "!idle:example.com" }),
    ]);
    const canDispatch = (queued: MatrixInboundTurn) => queued.roomId === "!idle:example.com";

    expect(queue.drainDispatchable(canDispatch).map((queued) => queued.id)).toEqual(["control-1"]);
    expect(queue.snapshot().map((queued) => queued.id)).toEqual(["control-2", "priority-1"]);
  });
});

function turn(overrides: Partial<MatrixInboundTurn> = {}): MatrixInboundTurn {
  return {
    eventId: "$event",
    id: "turn",
    priority: "default",
    receivedAt: 1,
    roomId: "!room:example.com",
    sender: "@user:example.com",
    text: "hello",
    ...overrides,
  };
}
