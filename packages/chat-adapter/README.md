# @better-matrix-js/chat-adapter

Matrix adapter for Chat SDK, backed by `better-matrix-js`.

```sh
npm install chat better-matrix-js @better-matrix-js/chat-adapter
```

```ts
import {
  FileMatrixStore,
  loadMatrixCoreFromNodePackage,
} from "better-matrix-js/node";
import { createMatrixAdapter } from "@better-matrix-js/chat-adapter";

const core = await loadMatrixCoreFromNodePackage({
  host: {
    store: new FileMatrixStore(".matrix-store/my-account"),
  },
});

const adapter = createMatrixAdapter({
  accessToken,
  core,
  homeserverUrl: "https://matrix.example.org",
  recoveryCode,
});
```

## Sync responses

For serverless bots, run Matrix `/sync` elsewhere and pass the sync response to
`adapter.handleSyncResponse()`:

```json
{ "response": { "next_batch": "..." }, "since": "previous_batch" }
```

If your transport receives encrypted payloads, decrypt and authenticate them at
the edge before calling `handleSyncResponse()`. Matrix event E2EE is handled by
the mautrix/go core after the sync response is applied, so use durable core
storage for crypto state.
