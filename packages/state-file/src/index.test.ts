import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testMatrixStoreConformance } from "../../pickle/test/store-conformance";
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

  it("treats an empty index as an empty store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-store-empty-index-"));
    try {
      await writeFile(join(dir, "index.json"), "");
      const store = createFileMatrixStore(dir);

      expect(await store.get("crypto/account")).toBeNull();
      expect(await store.list("crypto/")).toEqual([]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
