import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/appservice.ts", "src/beeper-stream.ts", "src/cli.ts", "src/config.ts", "src/media-store.ts", "src/pi-event-map.ts", "src/pi-notice.ts", "src/rooms.ts", "src/spaces.ts", "src/stream-map.ts", "src/types.ts"],
  format: ["esm"],
});
