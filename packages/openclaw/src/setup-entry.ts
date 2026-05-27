import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { beeperChannelPlugin } from "./setup";

export const openClawBeeperSetupEntry: {
  kind: "bundled-channel-setup-entry";
  loadSetupPlugin: () => typeof beeperChannelPlugin;
  plugin: typeof beeperChannelPlugin;
} = {
  ...defineSetupPluginEntry(beeperChannelPlugin),
  kind: "bundled-channel-setup-entry",
  loadSetupPlugin: () => beeperChannelPlugin,
} as const;

export default openClawBeeperSetupEntry;
