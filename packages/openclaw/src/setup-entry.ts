import { beeperChannelPlugin } from "./setup";

export const openClawBeeperSetupEntry = {
  kind: "bundled-channel-setup-entry",
  loadSetupPlugin: () => beeperChannelPlugin,
} as const;

export default openClawBeeperSetupEntry;
