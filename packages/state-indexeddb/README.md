# @beeper/pickle-state-indexeddb

IndexedDB `MatrixStore` for `pickle`. For browsers.

```sh
npm install @beeper/pickle-state-indexeddb
```

```ts
import { createMatrixClient } from "pickle";
import { createIndexedDBMatrixStore } from "@beeper/pickle-state-indexeddb";

const client = createMatrixClient({
  homeserver,
  token,
  wasmUrl: "/pickle.wasm",
  store: createIndexedDBMatrixStore({ databaseName: "matrix-alice" }),
});
```

Sync state and E2EE crypto state survive page reloads.
