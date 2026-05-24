import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@beeper/pickle-ag-ui": new URL("../ag-ui/src/index.ts", import.meta.url).pathname,
      "@beeper/pickle/streams/beeper-message": new URL("../pickle/src/streams/beeper-message.ts", import.meta.url).pathname,
      "@beeper/pickle": new URL("../pickle/src/index.ts", import.meta.url).pathname,
    },
  },
  test: {
    coverage: {
      exclude: ["../pickle/**"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "json-summary"],
    },
    environment: "node",
  },
});
