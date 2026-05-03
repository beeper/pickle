# @beeper/pickle-state-simple

Wrap any get/set/delete backend (Redis, Postgres, S3, …) as a `MatrixStore`.

```sh
npm install @beeper/pickle-state-simple
```

```ts
import { createMatrixStore } from "@beeper/pickle-state-simple";

const store = createMatrixStore({
  get: (key) => redis.getBuffer(key),
  set: (key, value) => redis.set(key, value),
  delete: (key) => redis.del(key).then(() => undefined),
  keys: () => redis.keys("*"), // optional; if omitted, an index entry is maintained
});
```

Use this when no built-in adapter fits. The wrapper handles the `MatrixStore` contract; you handle the backend.
