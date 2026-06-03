import { defineBundledChannelSetupEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export const openClawBeeperSetupEntry = defineBundledChannelSetupEntry({
  importMetaUrl: import.meta.url,
  plugin: { specifier: "./setup.js", exportName: "beeperChannelPlugin" },
  runtime: { specifier: "./setup.js", exportName: "setBeeperOpenClawPluginRuntime" },
  secrets: { specifier: "./secret-contract.js", exportName: "channelSecrets" },
});

export default openClawBeeperSetupEntry;
