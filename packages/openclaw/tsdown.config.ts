import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/approval.ts", "src/config.ts", "src/index.ts", "src/openclaw-event-map.ts", "src/openclaw-runtime.ts", "src/registry.ts", "src/registration.ts", "src/rooms.ts", "src/stream-map.ts", "src/types.ts"],
  format: ["esm"],
});
