import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@beeper/pickle/node": new URL("../core/src/node.ts", import.meta.url).pathname,
      "@beeper/pickle": new URL("../core/src/index.ts", import.meta.url).pathname,
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
