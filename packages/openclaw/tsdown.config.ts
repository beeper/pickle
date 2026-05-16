import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/config.ts", "src/index.ts", "src/openclaw-event-map.ts", "src/registration.ts", "src/stream-map.ts", "src/types.ts"],
  format: ["esm"],
});
