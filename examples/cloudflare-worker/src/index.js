import "@beeper/pickle/wasm_exec.js";
import wasmModule from "@beeper/pickle/pickle.wasm";
import { createMatrixClient } from "@beeper/pickle";
import {
  createDurableObjectMatrixStore,
  MatrixSyncDurableObject,
} from "@beeper/pickle-cloudflare";

export class MatrixClientObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.clientPromise = null;
    this.initPromise = null;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === "/matrix/webhook") {
      return this.handleWebhook(request);
    }

    const client = await this.loadClient();
    return Response.json({ ok: Boolean(client) });
  }

  async handleWebhook(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json();
    const client = await this.loadClient();
    await client.sync.applyResponse({
      response: body.response ?? body.sync ?? body,
      since: typeof body.since === "string" ? body.since : undefined,
    });
    return Response.json({ ok: true });
  }

  async loadClient() {
    this.clientPromise ??= Promise.resolve(createMatrixClient({
      homeserver: this.env.MATRIX_HOMESERVER_URL ?? "https://matrix.example.org",
      token: this.env.MATRIX_ACCESS_TOKEN ?? "missing-token",
      recoveryKey: this.env.MATRIX_RECOVERY_KEY,
      store: createDurableObjectMatrixStore(this.state.storage, {
        prefix: "matrix/default/",
      }),
      wasmModule,
    }));
    const client = await this.clientPromise;
    if (this.env.MATRIX_ACCESS_TOKEN && this.env.MATRIX_HOMESERVER_URL) {
      this.initPromise ??= client.boot();
      await this.initPromise;
    }
    return client;
  }
}

export class MatrixSyncObject extends MatrixSyncDurableObject {}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const objectName = url.searchParams.get("account") ?? "default";
    const binding = url.pathname.startsWith("/matrix/sync")
      ? env.MATRIX_SYNC
      : env.MATRIX_CLIENT;
    return binding.get(binding.idFromName(objectName)).fetch(request);
  },
};
