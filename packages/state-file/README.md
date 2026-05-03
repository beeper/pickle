# @better-matrix-js/state-file

Filesystem `MatrixStore` for `better-matrix-js`. One file per key under a directory.

```sh
npm install @better-matrix-js/state-file
```

```ts
import { createMatrixClient } from "better-matrix-js/node";
import { createFileMatrixStore } from "@better-matrix-js/state-file";

const client = createMatrixClient({
  homeserver,
  token,
  store: createFileMatrixStore(".matrix-state/alice"),
});
```

Good for single-process Node bots. For higher write rates or queries, use [`@better-matrix-js/state-sqlite`](../state-sqlite).
