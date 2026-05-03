import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "pickle/node": new URL("../pickle/src/node.ts", import.meta.url).pathname,
      "pickle": new URL("../pickle/src/index.ts", import.meta.url).pathname,
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
