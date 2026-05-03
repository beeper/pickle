import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/beeper-login.ts", "src/helpers.ts", "src/login.ts", "src/node.ts", "src/types.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: false,
});
