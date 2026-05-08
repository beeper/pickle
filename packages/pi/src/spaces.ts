import type { MatrixClient } from "@beeper/pickle";
import type { PicklePiConfig, ProjectSpaceRecord } from "./types";

export function projectKeyForCwd(cwd: string): string {
  return Buffer.from(cwd).toString("base64url");
}

export function projectSpaceName(cwd: string): string {
  const name = cwd.split("/").filter(Boolean).at(-1) ?? cwd;
  return `Pi: ${name}`;
}

export async function createProjectSpace(client: MatrixClient, config: PicklePiConfig, cwd: string): Promise<ProjectSpaceRecord> {
  const now = Date.now();
  const result = await client.appservice.createRoom({
    creationContent: { type: "m.space" },
    invite: config.allowedUserIds ?? [],
    isDirect: false,
    name: projectSpaceName(cwd),
    userId: serviceBotUserId(config),
    visibility: "private",
  });
  return { createdAt: now, cwd, projectKey: projectKeyForCwd(cwd), spaceId: result.roomId, updatedAt: now };
}

export async function attachRoomToSpace(client: MatrixClient, roomId: string, spaceId: string, via: string[]): Promise<void> {
  await client.rooms.sendStateEvent({
    content: { suggested: true, via },
    eventType: "m.space.child",
    roomId: spaceId,
    stateKey: roomId,
  });
  await client.rooms.sendStateEvent({
    content: { via },
    eventType: "m.space.parent",
    roomId,
    stateKey: spaceId,
  });
}

export function serviceBotUserId(config: PicklePiConfig, domain = "localhost"): string {
  return `@${config.serviceBotLocalpart}:${domain}`;
}
