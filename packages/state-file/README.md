# @beeper/pickle-state-file

Filesystem `MatrixStore` for `@beeper/pickle`. One file per key under a directory.

```sh
npm install @beeper/pickle-state-file
```

```ts
import { createMatrixClient } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";

const client = createMatrixClient({
  homeserver,
  token,
  store: createFileMatrixStore(".matrix-state/alice"),
});
```

Good for single-process Node bots. For higher write rates or queries, use [`@beeper/pickle-state-sqlite`](../state-sqlite).
