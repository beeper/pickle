import { describe, expect, it } from "vitest";
import { createMemoryMatrixStore } from "./index";

describe("MemoryMatrixStore", () => {
  it("copies bytes on set/get", async () => {
    const store = createMemoryMatrixStore();
    const original = new Uint8Array([1, 2, 3]);
    await store.set("a", original);
    original[0] = 9;

    const value = await store.get("a");
    expect([...value!]).toEqual([1, 2, 3]);
  });
});
