import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@beeper/pickle/auth": new URL("../pickle/src/auth.ts", import.meta.url).pathname,
      "@beeper/pickle/node": new URL("../pickle/src/node.ts", import.meta.url).pathname,
      "@beeper/pickle": new URL("../pickle/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    coverage: {
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    environment: "node",
  },
});
