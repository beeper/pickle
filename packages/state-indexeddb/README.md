# @better-matrix-js/state-indexeddb

IndexedDB `MatrixStore` for `better-matrix-js`. For browsers.

```sh
npm install @better-matrix-js/state-indexeddb
```

```ts
import { createMatrixClient } from "better-matrix-js";
import { createIndexedDBMatrixStore } from "@better-matrix-js/state-indexeddb";

const client = createMatrixClient({
  homeserver,
  token,
  wasmUrl: "/matrix-core.wasm",
  store: createIndexedDBMatrixStore({ databaseName: "matrix-alice" }),
});
```

Sync state and E2EE crypto state survive page reloads.
