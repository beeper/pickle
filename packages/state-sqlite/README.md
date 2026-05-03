# @beeper/easymatrix-state-sqlite

SQLite `MatrixStore` for `easymatrix`. Uses Node's built-in `node:sqlite` — no native deps.

```sh
npm install @beeper/easymatrix-state-sqlite
```

```ts
import { createMatrixClient } from "easymatrix/node";
import { createSQLiteMatrixStore } from "@beeper/easymatrix-state-sqlite";

const client = createMatrixClient({
  homeserver,
  token,
  store: await createSQLiteMatrixStore(".matrix-state/alice.db"),
});
```

Recommended for production Node bots. Requires Node 22+.
