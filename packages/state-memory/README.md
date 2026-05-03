# @beeper/pickle-state-memory

In-memory `MatrixStore` for `@beeper/pickle`. Tests and local experiments only.

```sh
npm install @beeper/pickle-state-memory
```

```ts
import { createMemoryMatrixStore } from "@beeper/pickle-state-memory";

const store = createMemoryMatrixStore();
```

Does not persist anything across restarts. For real bots, use [`@beeper/pickle-state-sqlite`](../state-sqlite) or [`-file`](../state-file).
