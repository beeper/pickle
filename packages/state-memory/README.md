# @beeper/easymatrix-state-memory

In-memory `MatrixStore` for `easymatrix`. Tests and local experiments only.

```sh
npm install @beeper/easymatrix-state-memory
```

```ts
import { createMemoryMatrixStore } from "@beeper/easymatrix-state-memory";

const store = createMemoryMatrixStore();
```

Does not persist anything across restarts. For real bots, use [`@beeper/easymatrix-state-sqlite`](../state-sqlite) or [`-file`](../state-file).
