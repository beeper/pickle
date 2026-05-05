import seedrandom from "seedrandom";

export class SeededRng {
  #rng: seedrandom.PRNG;

  constructor(seed: number) {
    this.#rng = seedrandom(String(Math.trunc(seed) || 1));
  }

  next(): number {
    return this.#rng.quick();
  }

  intn(max: number): number {
    if (max <= 0) return 0;
    return Math.floor(this.next() * max);
  }

  int63(): number {
    return Math.floor(this.#rng.double() * Number.MAX_SAFE_INTEGER);
  }
}

export function rngForOptions(seedSet: boolean, seed: number, fallback: number): SeededRng {
  return new SeededRng(seedSet ? seed : fallback);
}

export function sampleDelay(rng: SeededRng, minMs = 0, maxMs = 0): number {
  if (maxMs <= minMs) return minMs;
  return minMs + rng.intn(maxMs - minMs + 1);
}
