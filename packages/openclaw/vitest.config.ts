import { defineProject } from "vitest/config";

export default defineProject({
  resolve: {
    alias: [
      { find: "@beeper/pickle-bridge/beeper", replacement: new URL("../bridge/src/beeper.ts", import.meta.url).pathname },
      { find: "@beeper/pickle-bridge/beeper-stream", replacement: new URL("../bridge/src/beeper-stream.ts", import.meta.url).pathname },
      { find: "@beeper/pickle-bridge/events", replacement: new URL("../bridge/src/events.ts", import.meta.url).pathname },
      { find: "@beeper/pickle-bridge/media-message", replacement: new URL("../bridge/src/media-message.ts", import.meta.url).pathname },
      { find: /^@beeper\/pickle-bridge$/, replacement: new URL("../bridge/src/index.ts", import.meta.url).pathname },
      { find: /^@beeper\/pickle-ag-ui$/, replacement: new URL("../ag-ui/src/index.ts", import.meta.url).pathname },
      { find: /^@beeper\/pickle-state-file$/, replacement: new URL("../state-file/src/index.ts", import.meta.url).pathname },
      { find: "@beeper/pickle/streams/beeper-message", replacement: new URL("../pickle/src/streams/beeper-message.ts", import.meta.url).pathname },
      { find: "@beeper/pickle/beeper/auth", replacement: new URL("../pickle/src/beeper/auth.ts", import.meta.url).pathname },
      { find: "@beeper/pickle/auth", replacement: new URL("../pickle/src/auth.ts", import.meta.url).pathname },
      { find: "@beeper/pickle/node", replacement: new URL("../pickle/src/node.ts", import.meta.url).pathname },
      { find: /^@beeper\/pickle$/, replacement: new URL("../pickle/src/index.ts", import.meta.url).pathname },
    ],
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
