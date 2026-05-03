import "@beeper/pickle/wasm_exec.js";
import wasmModule from "@beeper/pickle/matrix-core.wasm";
import { createMatrixClient } from "@beeper/pickle";
import {
  createDurableObjectMatrixStore,
  MatrixSyncDurableObject,
} from "@beeper/pickle-cloudflare";

export class MatrixClientObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.corePromise = null;
    this.initPromise = null;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === "/matrix/webhook") {
      return this.handleWebhook(request);
    }

    const core = await this.loadCore();
    return Response.json({ ok: Boolean(core) });
  }

  async handleWebhook(request) {
    if (request.method !== "POST") {
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    }

    const body = await request.json();
    const core = await this.loadCore();
    await core.sync.applyResponse({
      response: body.response ?? body.sync ?? body,
      since: typeof body.since === "string" ? body.since : undefined,
    });
    return Response.json({ ok: true });
  }

  async loadCore() {
    this.corePromise ??= Promise.resolve(createMatrixClient({
      homeserver: this.env.MATRIX_HOMESERVER_URL ?? "https://matrix.example.org",
      token: this.env.MATRIX_ACCESS_TOKEN ?? "missing-token",
      recoveryKey: this.env.MATRIX_RECOVERY_KEY,
      store: createDurableObjectMatrixStore(this.state.storage, {
        prefix: "matrix/default/",
      }),
      wasmModule,
    }));
    const core = await this.corePromise;
    if (this.env.MATRIX_ACCESS_TOKEN && this.env.MATRIX_HOMESERVER_URL) {
      this.initPromise ??= core.boot();
      await this.initPromise;
    }
    return core;
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
