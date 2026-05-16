import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: {
      "@beeper/pickle-bridge": new URL("../bridge/src/index.ts", import.meta.url).pathname,
      "@beeper/pickle-state-file": new URL("../state-file/src/index.ts", import.meta.url).pathname,
      "@beeper/pickle/beeper/auth": new URL("../pickle/src/beeper/auth.ts", import.meta.url).pathname,
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
