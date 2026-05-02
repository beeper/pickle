# @better-matrix-js/state-memory

In-memory state adapter for `better-matrix-js`.

```ts
import { createMemoryMatrixStore } from "@better-matrix-js/state-memory";

const state = createMemoryMatrixStore();
```

Use this for tests and local experiments. It does not persist Matrix sync or E2EE crypto state across restarts.
