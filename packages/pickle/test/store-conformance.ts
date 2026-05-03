import { expect, it } from "vitest";
import type { MatrixStore } from "../src/types";

export function testMatrixStoreConformance(
  name: string,
  createStore: () => MatrixStore | Promise<MatrixStore>
): void {
  it(`${name} conforms to MatrixStore`, async () => {
    const store = await createStore();
    const original = new Uint8Array([1, 2, 3]);

    await store.set("crypto/account", original);
    await store.set("sync/next", new Uint8Array([4]));
    original[0] = 9;

    expect([...(await store.get("crypto/account"))!]).toEqual([1, 2, 3]);
    expect(await store.get("missing")).toBeNull();
    expect(await store.list("crypto/")).toEqual(["crypto/account"]);
    expect(await store.list("sync/")).toEqual(["sync/next"]);

    const fetched = (await store.get("crypto/account"))!;
    fetched[1] = 9;
    expect([...(await store.get("crypto/account"))!]).toEqual([1, 2, 3]);

    await store.delete("crypto/account");
    expect(await store.get("crypto/account")).toBeNull();
    expect(await store.list("crypto/")).toEqual([]);
    expect(await store.list("")).toEqual(["sync/next"]);
  });
}
