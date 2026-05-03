# @better-matrix-js/state-sqlite

SQLite `MatrixStore` for `better-matrix-js`. Uses Node's built-in `node:sqlite` — no native deps.

```sh
npm install @better-matrix-js/state-sqlite
```

```ts
import { createMatrixClient } from "better-matrix-js/node";
import { createSQLiteMatrixStore } from "@better-matrix-js/state-sqlite";

const client = createMatrixClient({
  homeserver,
  token,
  store: await createSQLiteMatrixStore(".matrix-state/alice.db"),
});
```

Recommended for production Node bots. Requires Node 22+.
