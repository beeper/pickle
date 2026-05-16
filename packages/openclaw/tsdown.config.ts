import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/index.ts", "src/openclaw-event-map.ts", "src/stream-map.ts", "src/types.ts"],
  format: ["esm"],
});
