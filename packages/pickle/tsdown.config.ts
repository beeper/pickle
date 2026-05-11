import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/auth.ts",
    "src/beeper/auth.ts",
    "src/helpers.ts",
    "src/node.ts",
    "src/streams/index.ts",
    "src/streams/beeper-message.ts",
    "src/types.ts",
  ],
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
  target: false,
});
