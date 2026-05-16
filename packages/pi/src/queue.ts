import type { MatrixInboundTurn } from "./types";

export type MatrixInboundTurnPriority = MatrixInboundTurn["priority"];
export type MatrixInboundTurnCanDispatch = (turn: MatrixInboundTurn) => boolean;

export const matrixInboundTurnPriorityOrder = ["control", "priority", "default"] as const satisfies readonly MatrixInboundTurnPriority[];

const alwaysDispatch: MatrixInboundTurnCanDispatch = () => true;

function emptyQueues(): Record<MatrixInboundTurnPriority, MatrixInboundTurn[]> {
  return {
    control: [],
    default: [],
    priority: [],
  };
}

export class MatrixInboundTurnQueue {
  #queues: Record<MatrixInboundTurnPriority, MatrixInboundTurn[]>;

  constructor(turns: Iterable<MatrixInboundTurn> = []) {
    this.#queues = emptyQueues();
    for (const turn of turns) {
      this.enqueue(turn);
    }
  }

  get size(): number {
    let size = 0;
    for (const priority of matrixInboundTurnPriorityOrder) {
      size += this.#queues[priority].length;
    }
    return size;
  }

  get length(): number {
    return this.size;
  }

  get isEmpty(): boolean {
    return this.size === 0;
  }

  enqueue(turn: MatrixInboundTurn): number {
    this.#queues[turn.priority].push(turn);
    return this.size;
  }

  peek(canDispatch: MatrixInboundTurnCanDispatch = alwaysDispatch): MatrixInboundTurn | undefined {
    const next = this.#next();
    if (!next || !canDispatch(next.turn)) return undefined;
    return next.turn;
  }

  dequeue(canDispatch: MatrixInboundTurnCanDispatch = alwaysDispatch): MatrixInboundTurn | undefined {
    const next = this.#next();
    if (!next || !canDispatch(next.turn)) return undefined;
    return this.#queues[next.priority].shift();
  }

  dispatchNext(canDispatch: MatrixInboundTurnCanDispatch): MatrixInboundTurn | undefined {
    return this.dequeue(canDispatch);
  }

  drainDispatchable(canDispatch: MatrixInboundTurnCanDispatch = alwaysDispatch): MatrixInboundTurn[] {
    const turns: MatrixInboundTurn[] = [];
    for (;;) {
      const turn = this.dequeue(canDispatch);
      if (!turn) return turns;
      turns.push(turn);
    }
  }

  cancelById(id: string): MatrixInboundTurn | undefined {
    return this.#remove((turn) => turn.id === id);
  }

  cancelByEventId(eventId: string): MatrixInboundTurn | undefined {
    return this.#remove((turn) => turn.eventId === eventId);
  }

  updateTextByEventId(eventId: string, text: string): MatrixInboundTurn | undefined {
    for (const priority of matrixInboundTurnPriorityOrder) {
      const queue = this.#queues[priority];
      const index = queue.findIndex((turn) => turn.eventId === eventId);
      const turn = queue[index];
      if (index === -1 || !turn) continue;

      const updated = { ...turn, text };
      queue[index] = updated;
      return updated;
    }
    return undefined;
  }

  snapshot(): MatrixInboundTurn[] {
    const turns: MatrixInboundTurn[] = [];
    for (const priority of matrixInboundTurnPriorityOrder) {
      turns.push(...this.#queues[priority]);
    }
    return turns;
  }

  clear(): void {
    this.#queues = emptyQueues();
  }

  #next(): { priority: MatrixInboundTurnPriority; turn: MatrixInboundTurn } | undefined {
    for (const priority of matrixInboundTurnPriorityOrder) {
      const turn = this.#queues[priority][0];
      if (turn) return { priority, turn };
    }
    return undefined;
  }

  #remove(predicate: (turn: MatrixInboundTurn) => boolean): MatrixInboundTurn | undefined {
    for (const priority of matrixInboundTurnPriorityOrder) {
      const queue = this.#queues[priority];
      const index = queue.findIndex(predicate);
      if (index === -1) continue;

      const [removed] = queue.splice(index, 1);
      return removed;
    }
    return undefined;
  }
}
