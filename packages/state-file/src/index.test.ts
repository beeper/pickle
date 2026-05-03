import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testMatrixStoreConformance } from "../../core/test/store-conformance";
import { createFileMatrixStore } from "./index";

describe("FileMatrixStore", () => {
  testMatrixStoreConformance("FileMatrixStore", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-store-conformance-"));
    return createFileMatrixStore(dir);
  });

  it("round-trips bytes and lists by prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-store-"));
    try {
      const store = createFileMatrixStore(dir);
      const original = new Uint8Array([1, 2, 3]);

      await store.set("crypto/account", original);
      original[0] = 9;

      expect([...(await store.get("crypto/account"))!]).toEqual([1, 2, 3]);
      expect(await store.list("crypto/")).toEqual(["crypto/account"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
