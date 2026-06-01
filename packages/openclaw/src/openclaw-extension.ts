import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk/channel-core";
import { BeeperPluginConfigSchemaForSdk, beeperChannelPlugin, setBeeperOpenClawPluginRuntime } from "./setup";

type OpenClawBeeperPluginEntry = {
  channelPlugin: typeof beeperChannelPlugin;
  configSchema: unknown;
  description: string;
  id: string;
  name: string;
  register: (api: OpenClawPluginApi) => void;
  setChannelRuntime?: (runtime: PluginRuntime) => void;
};

export const openClawBeeperPlugin: OpenClawBeeperPluginEntry = defineChannelPluginEntry({
  id: "beeper",
  name: "Beeper",
  description: "Bridge OpenClaw sessions and agents into Beeper.",
  plugin: beeperChannelPlugin,
  configSchema: BeeperPluginConfigSchemaForSdk,
  setRuntime: setOpenClawRuntime,
});

export default openClawBeeperPlugin;

function setOpenClawRuntime(runtime: unknown): void {
  setBeeperOpenClawPluginRuntime(runtime);
}
