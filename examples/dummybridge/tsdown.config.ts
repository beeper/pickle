import { defineConfig } from "tsdown";

export default defineConfig({
  dts: false,
  entry: ["src/index.ts", "test/smoke.ts"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
});
