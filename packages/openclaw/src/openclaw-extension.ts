import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { BeeperChannelConfigSchema, beeperChannelPlugin } from "./setup";

const startBeeperGatewayAccount = beeperChannelPlugin.gateway.startAccount;

export interface OpenClawPluginApi {
  runtime?: unknown;
  registerChannel?: (registration: { plugin: unknown }) => void;
  channels?: {
    register?: (plugin: unknown) => void;
  };
}

const sdkEntry = defineChannelPluginEntry({
  id: "beeper",
  name: "Beeper",
  description: "Bridge OpenClaw sessions and agents into Beeper.",
  plugin: beeperChannelPlugin,
  configSchema: BeeperChannelConfigSchema as never,
  setRuntime: setBeeperChannelRuntime,
} as never) as {
  configSchema: unknown;
  description: string;
  id: string;
  name: string;
  register: (api: unknown) => void;
  setChannelRuntime?: (runtime: unknown) => void;
};

export const openClawBeeperPlugin: {
  channelPlugin: typeof beeperChannelPlugin;
  configSchema: unknown;
  description: string;
  id: string;
  loadChannelPlugin: () => typeof beeperChannelPlugin;
  name: string;
  plugin: typeof beeperChannelPlugin;
  register: (api: OpenClawPluginApi) => void;
  setChannelRuntime?: (runtime: unknown) => void;
} = {
  id: sdkEntry.id,
  name: sdkEntry.name,
  description: sdkEntry.description,
  configSchema: sdkEntry.configSchema,
  register: (api: OpenClawPluginApi) => sdkEntry.register(api),
  ...(sdkEntry.setChannelRuntime ? { setChannelRuntime: sdkEntry.setChannelRuntime } : {}),
  channelPlugin: beeperChannelPlugin,
  plugin: beeperChannelPlugin,
  loadChannelPlugin: () => beeperChannelPlugin,
} as const;

export default openClawBeeperPlugin;

function setBeeperChannelRuntime(runtime: unknown): void {
  beeperChannelPlugin.gateway.startAccount = (ctx: Parameters<typeof startBeeperGatewayAccount>[0]) =>
    startBeeperGatewayAccount({
      ...(ctx as Record<string, unknown>),
      hostRuntime: runtime,
    } as Parameters<typeof startBeeperGatewayAccount>[0]);
}
