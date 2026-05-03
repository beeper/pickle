# @beeper/pickle-cloudflare

> ⚠️ **Experimental — doesn't work yet.** This package is in active design. The APIs and Durable Object below compile and have unit tests, but no end-to-end Cloudflare deployment has been validated. Expect breaking changes and runtime issues. Don't ship it.

Cloudflare Workers helpers for [`@beeper/pickle`](https://github.com/beeper/pickle): KV / Durable Object stores and a long-poll sync Durable Object.

```sh
npm install @beeper/pickle @beeper/pickle-cloudflare
```

## State

```ts
import {
  createCloudflareKVMatrixStore,
  createDurableObjectMatrixStore,
} from "@beeper/pickle-cloudflare";

// Cloudflare KV
const store = createCloudflareKVMatrixStore(env.MATRIX_KV, { prefix: "matrix/" });

// Durable Object storage (recommended for E2EE — strong consistency)
const store = createDurableObjectMatrixStore(state.storage, { prefix: "matrix/" });
```

## Sync Durable Object

`MatrixSyncDurableObject` long-polls `/_matrix/client/v3/sync`, posts `{ response, since }` to your webhook, and persists the cursor across hibernation via DO alarms.

```ts
// worker.ts
import { MatrixSyncDurableObject } from "@beeper/pickle-cloudflare";

export class MatrixSync extends MatrixSyncDurableObject {}

export default {
  async fetch(request: Request, env: Env) {
    const id = env.MATRIX_SYNC.idFromName("default");
    return env.MATRIX_SYNC.get(id).fetch(request);
  },
};
```

```jsonc
// wrangler.jsonc
{
  "durable_objects": {
    "bindings": [{ "name": "MATRIX_SYNC", "class_name": "MatrixSync" }]
  },
  "migrations": [{ "tag": "v1", "new_classes": ["MatrixSync"] }],
  "vars": {
    "MATRIX_SYNC_HOMESERVER_URL": "https://matrix.example.org",
    "MATRIX_SYNC_WEBHOOK_URL": "https://your-worker.example.com/matrix/webhook"
  }
}
```

Set `MATRIX_SYNC_ACCESS_TOKEN` as a secret. Control via HTTP:

```sh
curl -X POST https://your-worker.example.com/start
curl -X POST https://your-worker.example.com/stop
curl       https://your-worker.example.com/status
```

Apply each webhook payload to the `MatrixClient` running in your account Durable Object:

```ts
await client.sync.applyResponse({ response: body.response, since: body.since });
```

If the sync DO and webhook receiver don't share a private boundary, encrypt the payload:

```ts
import {
  decryptMatrixSyncWebhookEnvelope,
  encryptMatrixSyncWebhookPayload,
} from "@beeper/pickle-cloudflare";

const envelope = await encryptMatrixSyncWebhookPayload({ response, since }, env.WEBHOOK_SECRET);
const payload = await decryptMatrixSyncWebhookEnvelope(envelope, env.WEBHOOK_SECRET);
```

## Cursor ownership

One `MatrixSyncDurableObject` per Matrix account. It owns the `/sync` cursor; the account DO owns the `MatrixClient`, crypto state, and bot logic. Every consumer treats already-seen `next_batch` cursors as no-ops.

## Config

| Option | Env var | Default |
| --- | --- | --- |
| `homeserverUrl` | `MATRIX_SYNC_HOMESERVER_URL` | — |
| `accessToken` | `MATRIX_SYNC_ACCESS_TOKEN` | — |
| `webhookUrl` | `MATRIX_SYNC_WEBHOOK_URL` | — |
| `webhookSecret` | `MATRIX_SYNC_WEBHOOK_SECRET` | — |
| `syncTimeoutMs` | `MATRIX_SYNC_TIMEOUT_MS` | `30000` |
| `retryMs` / `maxRetryMs` | `MATRIX_SYNC_RETRY_MS` / `MATRIX_SYNC_MAX_RETRY_MS` | `1000` / `60000` |

See [`examples/cloudflare-worker`](https://github.com/beeper/pickle/tree/main/examples/cloudflare-worker) for the full setup.

## License

MPL-2.0
