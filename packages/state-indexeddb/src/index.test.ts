import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createIndexedDBMatrixStore } from "./index";

describe("IndexedDBMatrixStore", () => {
  it("round-trips bytes and lists by prefix", async () => {
    const store = createIndexedDBMatrixStore({
      databaseName: `matrix-store-${crypto.randomUUID()}`,
      indexedDB: new IDBFactory(),
    });
    const original = new Uint8Array([1, 2, 3]);

    await store.set("sync/next", new Uint8Array([4]));
    await store.set("crypto/account", original);
    original[0] = 9;

    expect([...(await store.get("crypto/account"))!]).toEqual([1, 2, 3]);
    expect(await store.list("crypto/")).toEqual(["crypto/account"]);

    await store.delete("crypto/account");
    expect(await store.get("crypto/account")).toBeNull();
    expect(await store.list("crypto/")).toEqual([]);
  });
});
