import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "easymatrix": new URL("../core/src/index.ts", import.meta.url).pathname,
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
