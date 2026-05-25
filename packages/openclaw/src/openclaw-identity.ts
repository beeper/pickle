import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

export async function resolveOpenClawDeviceId(options: { dataDir?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const env = options.env ?? process.env;
  const fromEnv = firstNonEmpty(env.PICKLE_OPENCLAW_DEVICE_ID, env.OPENCLAW_DEVICE_ID);
  if (fromEnv) return fromEnv;
  const candidates = [
    resolve(homedir(), ".openclaw", "identity", "device.json"),
    ...(options.dataDir ? [resolve(options.dataDir, "openclaw-device.json")] : []),
    ...(options.dataDir ? [resolve(options.dataDir, "gateway-device.json")] : []),
  ];
  for (const path of candidates) {
    const deviceId = await readDeviceId(path);
    if (deviceId) return deviceId;
  }
  throw new Error("OpenClaw device id not found; pair or start OpenClaw before Beeper login setup.");
}

async function readDeviceId(path: string): Promise<string | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as { deviceId?: unknown; nodeId?: unknown };
    const value = typeof raw.deviceId === "string" ? raw.deviceId : typeof raw.nodeId === "string" ? raw.nodeId : undefined;
    return value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value): value is string => Boolean(value?.trim()))?.trim();
}
