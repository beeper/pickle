import { defineConfig } from "tsdown";

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: [/^@beeper\//],
  },
  dts: true,
  entry: ["src/approval.ts", "src/appservice.ts", "src/beeper-channel-runtime.ts", "src/beeper-cli/tool.ts", "src/beeper-setup.ts", "src/bridge-agent.ts", "src/cli.ts", "src/config.ts", "src/connector.ts", "src/function-entry.ts", "src/matrix-parser.ts", "src/openclaw-runtime.ts", "src/plugin-entry.ts", "src/protocol-coverage.ts", "src/registry.ts", "src/registration.ts", "src/rooms.ts", "src/secret-contract.ts", "src/serial.ts", "src/setup.ts", "src/setup-entry.ts", "src/types.ts"],
  format: ["esm"],
});
