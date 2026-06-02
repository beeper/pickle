import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export const openClawBeeperPlugin = defineBundledChannelEntry({
  id: "beeper",
  name: "Beeper",
  description: "Chat with your OpenClaw agents on Beeper.",
  importMetaUrl: import.meta.url,
  plugin: { specifier: "./setup.js", exportName: "beeperChannelPlugin" },
  runtime: { specifier: "./setup.js", exportName: "setBeeperOpenClawPluginRuntime" },
  secrets: { specifier: "./secret-contract.js", exportName: "channelSecrets" },
});

export default openClawBeeperPlugin;
