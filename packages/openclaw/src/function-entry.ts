import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createBeeperCliTool, registerBeeperCli } from "./beeper-cli/tool";

export const openClawBeeperFunctionPlugin = definePluginEntry({
  id: "beeper-cli",
  name: "Beeper CLI",
  description: "Optional Beeper CLI function and command surface for OpenClaw agents.",
  register(api) {
    api.registerTool(
      ((ctx: { sandboxed?: boolean }) => {
        if (ctx.sandboxed) return null;
        return createBeeperCliTool();
      }) as never,
      { optional: true },
    );
    api.registerCli(
      async ({ program }: { program: unknown }) => {
        registerBeeperCli(program);
      },
      {
        commands: ["beeper"],
        descriptors: [
          {
            name: "beeper",
            description: "Run the bundled Beeper CLI from OpenClaw.",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});

export default openClawBeeperFunctionPlugin;
