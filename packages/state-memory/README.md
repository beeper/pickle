# @better-matrix-js/state-memory

In-memory `MatrixStore` for `better-matrix-js`. Tests and local experiments only.

```sh
npm install @better-matrix-js/state-memory
```

```ts
import { createMemoryMatrixStore } from "@better-matrix-js/state-memory";

const store = createMemoryMatrixStore();
```

Does not persist anything across restarts. For real bots, use [`@better-matrix-js/state-sqlite`](../state-sqlite) or [`-file`](../state-file).
