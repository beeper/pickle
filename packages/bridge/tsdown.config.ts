import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/node.ts", "src/types.ts", "src/events.ts", "src/beeper.ts", "src/store.ts", "src/appservice-websocket.ts"],
  format: ["esm"],
  dts: {
    sourcemap: false,
  },
  clean: true,
  sourcemap: false,
  outExtensions: () => ({
    js: ".js",
    dts: ".d.ts",
  }),
  deps: {
    neverBundle: ["@beeper/pickle", "@beeper/pickle/auth", "@beeper/pickle/node", "@beeper/pickle-state-file", "ws"],
  },
  target: false,
});
