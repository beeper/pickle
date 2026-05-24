import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  dts: true,
  entry: ["src/approval.ts", "src/appservice.ts", "src/backfill.ts", "src/beeper-stream.ts", "src/beeper-setup.ts", "src/bridge-agent.ts", "src/cli.ts", "src/config.ts", "src/connector.ts", "src/index.ts", "src/openclaw-event-map.ts", "src/openclaw-extension.ts", "src/openclaw-runtime.ts", "src/plugin-entry.ts", "src/protocol-coverage.ts", "src/registry.ts", "src/registration.ts", "src/rooms.ts", "src/serial.ts", "src/setup.ts", "src/setup-entry.ts", "src/stream-map.ts", "src/types.ts"],
  format: ["esm"],
});
