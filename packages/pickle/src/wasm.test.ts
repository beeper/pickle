import { describe, expect, it } from "vitest";
import { copyBytes } from "./bytes";

describe("copyBytes", () => {
  it("copies Uint8Array values", () => {
    const original = new Uint8Array([1, 2, 3]);
    const value = copyBytes(original);
    original[0] = 9;

    expect([...value]).toEqual([1, 2, 3]);
  });
});
