import { beeperChannelPlugin } from "./setup";

export interface OpenClawPluginApi {
  registerChannel?: (registration: { plugin: unknown }) => void;
  channels?: {
    register?: (plugin: unknown) => void;
  };
}

export const openClawBeeperPlugin = {
  id: "beeper",
  kind: "bundled-channel-entry",
  name: "Beeper",
  description: "Bridge OpenClaw sessions and agents into Beeper.",
  plugin: beeperChannelPlugin,
  loadChannelPlugin: () => beeperChannelPlugin,
  register(api: OpenClawPluginApi): void {
    api.registerChannel?.({ plugin: beeperChannelPlugin });
    api.channels?.register?.(beeperChannelPlugin);
  },
} as const;

export default openClawBeeperPlugin;
