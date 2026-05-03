# @beeper/easymatrix-state-file

Filesystem `MatrixStore` for `easymatrix`. One file per key under a directory.

```sh
npm install @beeper/easymatrix-state-file
```

```ts
import { createMatrixClient } from "easymatrix/node";
import { createFileMatrixStore } from "@beeper/easymatrix-state-file";

const client = createMatrixClient({
  homeserver,
  token,
  store: createFileMatrixStore(".matrix-state/alice"),
});
```

Good for single-process Node bots. For higher write rates or queries, use [`@beeper/easymatrix-state-sqlite`](../state-sqlite).
