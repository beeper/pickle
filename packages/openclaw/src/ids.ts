export const DEFAULT_BEEPER_BRIDGE_TYPE = "openclaw";
const BEEPER_BRIDGE_PREFIX = "sh-openclaw-";
const BEEPER_BRIDGE_MAX_LENGTH = 32;

export function openClawBeeperBridgeId(deviceId: string): string {
  const normalized = deviceId.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Cannot build Beeper bridge id without a device id");
  return `${BEEPER_BRIDGE_PREFIX}${normalized.slice(0, BEEPER_BRIDGE_MAX_LENGTH - BEEPER_BRIDGE_PREFIX.length)}`;
}
