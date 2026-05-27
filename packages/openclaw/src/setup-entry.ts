import { defineSetupPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { beeperChannelPlugin } from "./setup";

export const openClawBeeperSetupEntry = defineSetupPluginEntry(beeperChannelPlugin);

export default openClawBeeperSetupEntry;
