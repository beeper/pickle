# @beeper/pickle-state-sqlite

SQLite `MatrixStore` for `@beeper/pickle`. Uses Node's built-in `node:sqlite` — no native deps.

```sh
npm install @beeper/pickle-state-sqlite
```

```ts
import { createMatrixClient } from "@beeper/pickle/node";
import { createSQLiteMatrixStore } from "@beeper/pickle-state-sqlite";

const client = createMatrixClient({
  homeserver,
  token,
  store: await createSQLiteMatrixStore(".matrix-state/alice.db"),
});
```

Recommended for production Node bots. Requires Node 22+.
