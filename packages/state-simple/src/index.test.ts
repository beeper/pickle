import { describe, expect, it } from "vitest";
import { testMatrixStoreConformance } from "../../core/test/store-conformance";
import { createMatrixStore } from "./index";

describe("createMatrixStore", () => {
  testMatrixStoreConformance("SimpleMatrixStore", () => {
    const values = new Map<string, Uint8Array>();
    return createMatrixStore({
      async delete(key) {
        values.delete(key);
      },
      async get(key) {
        return values.get(key) ?? null;
      },
      async set(key, value) {
        values.set(key, value);
      },
    });
  });

  it("adapts simple get/set stores and maintains an index for list()", async () => {
    const values = new Map<string, Uint8Array>();
    const store = createMatrixStore({
      async delete(key) {
        values.delete(key);
      },
      async get(key) {
        return values.get(key) ?? null;
      },
      async set(key, value) {
        values.set(key, value);
      },
    });

    await store.set("crypto/account", new Uint8Array([1]));
    await store.set("sync/next", new Uint8Array([2]));

    expect(await store.list("crypto/")).toEqual(["crypto/account"]);
    await store.delete("crypto/account");
    expect(await store.list("crypto/")).toEqual([]);
  });
});
