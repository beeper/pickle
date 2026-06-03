import { describe, expect, it, vi } from "vitest";
import type { MatrixStore } from "@beeper/pickle";
import { MatrixBridgeDataStore } from "./store";

describe("MatrixBridgeDataStore", () => {
  it("drops corrupt JSON values instead of failing startup loads", async () => {
    const store = fakeMatrixStore({
      "pickle-bridge:bridge-status:current": new TextEncoder().encode('{"state":"running"}{"state":"stale"}'),
    });
    const dataStore = new MatrixBridgeDataStore(store);

    await expect(dataStore.getBridgeStatus()).resolves.toBeNull();
    expect(store.delete).toHaveBeenCalledWith("pickle-bridge:bridge-status:current");
  });
});

function fakeMatrixStore(values: Record<string, Uint8Array>): MatrixStore & { delete: ReturnType<typeof vi.fn> } {
  const entries = new Map(Object.entries(values));
  return {
    delete: vi.fn(async (key: string) => {
      entries.delete(key);
    }),
    get: vi.fn(async (key: string) => entries.get(key) ?? null),
    list: vi.fn(async (prefix: string) => Array.from(entries.keys()).filter((key) => key.startsWith(prefix))),
    set: vi.fn(async (key: string, value: Uint8Array) => {
      entries.set(key, value);
    }),
  };
}
