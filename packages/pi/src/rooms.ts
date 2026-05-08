import { resolve } from "node:path";
import type { MatrixClient } from "@beeper/pickle";
import type { PicklePiBinding, PicklePiConfig } from "./types";
import { projectKeyForCwd, serviceBotUserId } from "./spaces";

export function bindingIdForRoom(roomId: string): string {
  return Buffer.from(roomId).toString("base64url");
}

export function sessionFileForBinding(config: PicklePiConfig, cwd: string, bindingId: string): string {
  return resolve(config.dataDir, "sessions", projectKeyForCwd(cwd), `${bindingId}.jsonl`);
}

export async function createSessionRoom(
  client: MatrixClient,
  config: PicklePiConfig,
  options: { cwd: string; domain?: string; sessionName?: string; spaceId?: string }
): Promise<PicklePiBinding> {
  const now = Date.now();
  const result = await client.appservice.createRoom({
    invite: config.allowedUserIds ?? [],
    isDirect: false,
    name: options.sessionName ?? `Pi session: ${options.cwd}`,
    topic: `cwd: ${options.cwd}`,
    userId: serviceBotUserId(config, options.domain),
    visibility: "private",
  });
  const id = bindingIdForRoom(result.roomId);
  const binding: PicklePiBinding = {
    createdAt: now,
    cwd: options.cwd,
    id,
    mode: "headless",
    owner: "appservice",
    piGhostUserId: piGhostUserId(config, options.domain),
    piSessionFile: sessionFileForBinding(config, options.cwd, id),
    roomId: result.roomId,
    serviceBotUserId: serviceBotUserId(config, options.domain),
    updatedAt: now,
  };
  if (options.sessionName) binding.sessionName = options.sessionName;
  if (options.spaceId) binding.spaceId = options.spaceId;
  return binding;
}

export function piGhostUserId(config: PicklePiConfig, domain = "localhost"): string {
  return `@${config.ghostLocalpart}:${domain}`;
}
