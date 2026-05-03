import {
  MatrixSyncDurableObject,
  createDurableObjectMatrixStore,
  decryptMatrixSyncWebhookEnvelope,
  encryptMatrixSyncWebhookPayload,
} from "../../packages/cloudflare/dist/index.js";

export class MatrixStoreSmokeObject {
  constructor(state) {
    this.state = state;
  }

  async fetch() {
    const store = createDurableObjectMatrixStore(this.state.storage, {
      prefix: "smoke/",
    });
    const key = "runtime";
    const value = new Uint8Array([1, 3, 3, 7]);
    await store.set(key, value);
    const stored = await store.get(key);
    const keys = await store.list("");
    await store.delete(key);
    const deleted = await store.get(key);
    return Response.json({
      deleted: deleted === null,
      keys,
      stored: stored ? [...stored] : null,
    });
  }
}

export class MatrixSyncSmokeObject extends MatrixSyncDurableObject {}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/crypto") {
      const payload = { response: { next_batch: "cloudflare-smoke" }, since: "before" };
      const envelope = await encryptMatrixSyncWebhookPayload(payload, env.SMOKE_WEBHOOK_SECRET);
      return Response.json({
        envelope,
        payload: await decryptMatrixSyncWebhookEnvelope(envelope, env.SMOKE_WEBHOOK_SECRET),
      });
    }

    if (url.pathname === "/store") {
      const id = env.MATRIX_STORE_SMOKE.idFromName("default");
      return env.MATRIX_STORE_SMOKE.get(id).fetch(request);
    }

    if (url.pathname.startsWith("/sync")) {
      const id = env.MATRIX_SYNC.idFromName("default");
      return env.MATRIX_SYNC.get(id).fetch(request);
    }

    return Response.json({ ok: true });
  },
};
