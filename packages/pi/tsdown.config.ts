import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/appservice.ts", "src/cli.ts", "src/stream-map.ts"],
  format: ["esm"],
});
