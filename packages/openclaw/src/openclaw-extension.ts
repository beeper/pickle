import { beeperChannelPlugin } from "./setup";

export interface OpenClawPluginApi {
  runtime?: unknown;
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
    const plugin = beeperChannelPluginForRuntime(api.runtime);
    api.registerChannel?.({ plugin });
    api.channels?.register?.(plugin);
  },
} as const;

export default openClawBeeperPlugin;

function beeperChannelPluginForRuntime(runtime: unknown): typeof beeperChannelPlugin {
  if (!runtime || typeof runtime !== "object") return beeperChannelPlugin;
  return {
    ...beeperChannelPlugin,
    gateway: {
      ...beeperChannelPlugin.gateway,
      startAccount: (ctx: Parameters<typeof beeperChannelPlugin.gateway.startAccount>[0]) =>
        beeperChannelPlugin.gateway.startAccount({
          ...ctx,
          hostRuntime: runtime,
        } as Parameters<typeof beeperChannelPlugin.gateway.startAccount>[0]),
    },
  };
}
