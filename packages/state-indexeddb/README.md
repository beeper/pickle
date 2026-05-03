# @beeper/easymatrix-state-indexeddb

IndexedDB `MatrixStore` for `easymatrix`. For browsers.

```sh
npm install @beeper/easymatrix-state-indexeddb
```

```ts
import { createMatrixClient } from "easymatrix";
import { createIndexedDBMatrixStore } from "@beeper/easymatrix-state-indexeddb";

const client = createMatrixClient({
  homeserver,
  token,
  wasmUrl: "/matrix-core.wasm",
  store: createIndexedDBMatrixStore({ databaseName: "matrix-alice" }),
});
```

Sync state and E2EE crypto state survive page reloads.
