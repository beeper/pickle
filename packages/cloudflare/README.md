# @better-matrix-js/cloudflare

Cloudflare Workers helpers for [`better-matrix-js`](https://github.com/batuhan/better-matrix-js): KV / Durable Object stores and a ready-made sync Durable Object.

```sh
npm install better-matrix-js @better-matrix-js/cloudflare
```

## State

Pick whichever fits your binding. Both implement the `MatrixStore` interface that `better-matrix-js` expects as `store`.

```ts
import {
  createCloudflareKVMatrixStore,
  createDurableObjectMatrixStore,
} from "@better-matrix-js/cloudflare";

// Cloudflare KV
const store = createCloudflareKVMatrixStore(env.MATRIX_KV, { prefix: "matrix/" });

// Durable Object storage (recommended for E2EE — strong consistency)
const store = createDurableObjectMatrixStore(state.storage, { prefix: "matrix/" });
```


## Sync Durable Object

`MatrixSyncDurableObject` long-polls `/_matrix/client/v3/sync`, posts `{ response, since }` to your webhook, persists the `next_batch` cursor, and uses Durable Object alarms to keep going through hibernation and transient errors.

```ts
// worker.ts
import { MatrixSyncDurableObject } from "@better-matrix-js/cloudflare";

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

Set `MATRIX_SYNC_ACCESS_TOKEN` as a secret. Then start, stop, and inspect via HTTP:

```sh
curl -X POST https://your-worker.example.com/start
curl -X POST https://your-worker.example.com/stop
curl       https://your-worker.example.com/status
```

Your webhook receives `{ response, since }`. Apply it to a `MatrixClient` running in another Durable Object:

```ts
await client.sync.applyResponse({ response: body.response, since: body.since });
```

## Config

Pass options directly when subclassing, or use env vars:

| Option | Env var | Default |
| --- | --- | --- |
| `homeserverUrl` | `MATRIX_SYNC_HOMESERVER_URL` | — |
| `accessToken` | `MATRIX_SYNC_ACCESS_TOKEN` | — |
| `webhookUrl` | `MATRIX_SYNC_WEBHOOK_URL` | — |
| `webhookSecret` | `MATRIX_SYNC_WEBHOOK_SECRET` | — |
| `syncTimeoutMs` | `MATRIX_SYNC_TIMEOUT_MS` | `30000` |
| `retryMs` / `maxRetryMs` | `MATRIX_SYNC_RETRY_MS` / `MATRIX_SYNC_MAX_RETRY_MS` | `1000` / `60000` |

See [`examples/cloudflare-worker`](https://github.com/batuhan/better-matrix-js/tree/main/examples/cloudflare-worker) for a complete setup with both the core and sync objects.

## License

MPL-2.0
