import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSQLiteMatrixStore } from "./index";

describe("SQLiteMatrixStore", () => {
  it("round-trips bytes and lists by prefix", async () => {
    const dir = await mkdtemp(join(tmpdir(), "matrix-sqlite-store-"));
    try {
      const store = await createSQLiteMatrixStore(join(dir, "matrix.db"));
      const original = new Uint8Array([4, 5, 6]);

      await store.set("state/rooms", original);
      original[0] = 9;

      expect([...(await store.get("state/rooms"))!]).toEqual([4, 5, 6]);
      expect(await store.list("state/")).toEqual(["state/rooms"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
