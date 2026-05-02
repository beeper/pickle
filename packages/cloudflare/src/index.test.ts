import { describe, expect, it, vi } from "vitest";
import {
  createDurableObjectMatrixStore,
  MatrixSyncDurableObject,
  type DurableObjectStorageLike,
} from "./index";

class FakeDurableObjectStorage implements DurableObjectStorageLike {
  readonly values = new Map<string, unknown>();
  alarm: number | null = null;

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async deleteAlarm(): Promise<void> {
    this.alarm = null;
  }

  async get<T = unknown>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async list<T = unknown>(options: { prefix?: string } = {}): Promise<Map<string, T>> {
    return new Map(
      [...this.values.entries()].filter(([key]) => key.startsWith(options.prefix ?? ""))
    ) as Map<string, T>;
  }

  async put(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm = Number(scheduledTime);
  }
}

describe("createDurableObjectMatrixStore", () => {
  it("round-trips bytes through Durable Object storage", async () => {
    const storage = new FakeDurableObjectStorage();
    const store = createDurableObjectMatrixStore(storage, { prefix: "matrix/" });

    const original = new Uint8Array([1, 2, 3]);
    await store.set("a", original);
    original[0] = 9;

    expect([...(await store.get("a"))!]).toEqual([1, 2, 3]);
    expect(await store.list("")).toEqual(["a"]);
  });
});

describe("MatrixSyncDurableObject", () => {
  it("syncs from Matrix, posts the webhook payload, stores next_batch, and re-arms", async () => {
    const storage = new FakeDurableObjectStorage();
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://matrix.example.com/")) {
        expect(init?.headers).toEqual({ authorization: "Bearer token" });
        return Response.json({ next_batch: "batch-1", rooms: { join: {} } });
      }
      expect(url).toBe("https://worker.example.com/matrix-webhook");
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({
        authorization: "Bearer webhook-secret",
        "content-type": "application/json",
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        response: { next_batch: "batch-1", rooms: { join: {} } },
      });
      return Response.json({ ok: true });
    });

    const object = new MatrixSyncDurableObject(
      { storage },
      {
        MATRIX_SYNC_ACCESS_TOKEN: "token",
        MATRIX_SYNC_HOMESERVER_URL: "https://matrix.example.com",
        MATRIX_SYNC_WEBHOOK_SECRET: "webhook-secret",
        MATRIX_SYNC_WEBHOOK_URL: "https://worker.example.com/matrix-webhook",
      },
      { fetch, nextAlarmMs: 25, syncTimeoutMs: 1000 }
    );

    const response = await object.fetch(new Request("https://worker.example.com/sync/start", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(await storage.get("matrix-sync:since")).toBe("batch-1");
    expect(storage.alarm).toBeGreaterThan(Date.now());
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("passes the previous since token and keeps it until the webhook succeeds", async () => {
    const storage = new FakeDurableObjectStorage();
    await storage.put("matrix-sync:since", "old");
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://matrix.example.com/")) {
        expect(url).toBe("https://matrix.example.com/_matrix/client/v3/sync?timeout=30000&since=old");
        return Response.json({ next_batch: "new" });
      }
      expect(JSON.parse(String(init?.body))).toEqual({
        response: { next_batch: "new" },
        since: "old",
      });
      return new Response("nope", { status: 503 });
    });
    const object = new MatrixSyncDurableObject(
      { storage },
      {
        MATRIX_ACCESS_TOKEN: "token",
        MATRIX_HOMESERVER_URL: "https://matrix.example.com",
        MATRIX_SYNC_WEBHOOK_URL: "https://worker.example.com/matrix-webhook",
      },
      { fetch, retryMs: 10 }
    );

    await object.fetch(new Request("https://worker.example.com/sync/wake", { method: "POST" }));

    expect(await storage.get("matrix-sync:since")).toBe("old");
    expect(await storage.get("matrix-sync:last-error")).toBe("Matrix sync webhook failed: HTTP 503");
    expect(await storage.get("matrix-sync:retry-ms")).toBe(1000);
    expect(storage.alarm).toBeGreaterThan(0);
  });

  it("stops by disabling sync and clearing the alarm", async () => {
    const storage = new FakeDurableObjectStorage();
    await storage.put("matrix-sync:enabled", true);
    await storage.setAlarm(Date.now() + 1000);
    const object = new MatrixSyncDurableObject({ storage }, {}, { fetch: vi.fn() });

    const response = await object.fetch(new Request("https://worker.example.com/sync/stop", {
      method: "POST",
    }));

    expect(response.status).toBe(200);
    expect(await storage.get("matrix-sync:enabled")).toBe(false);
    expect(storage.alarm).toBeNull();
  });
});
