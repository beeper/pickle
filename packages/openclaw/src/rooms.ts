import type { MatrixClient } from "@beeper/pickle";
import type { OpenClawAgentContact, OpenClawBridgeConfig, OpenClawSessionBinding } from "./types";
import { openClawAgentGhostLocalpart, openClawRoomCreationPreset, openClawSenderLocalpart } from "./registration";

export function bindingIdForRoom(roomId: string): string {
  return Buffer.from(roomId).toString("base64url");
}

export function matrixDomainFromHomeserver(homeserver: string | undefined): string {
  if (!homeserver) return "localhost";
  try {
    return new URL(homeserver).hostname;
  } catch {
    return homeserver.replace(/^https?:\/\//, "").split("/")[0] || "localhost";
  }
}

function matrixDomainFromConfig(config: OpenClawBridgeConfig): string {
  return config.homeserverDomain ?? matrixDomainFromHomeserver(config.homeserver);
}

export function agentGhostUserId(config: OpenClawBridgeConfig, agentId: string, domain = matrixDomainFromConfig(config)): string {
  return `@${openClawAgentGhostLocalpart(config, agentId)}:${domain}`;
}

export function serviceBotUserId(config: OpenClawBridgeConfig, domain = matrixDomainFromConfig(config)): string {
  return `@${openClawSenderLocalpart(config)}:${domain}`;
}

export function agentContactFromOpenClawAgent(
  config: OpenClawBridgeConfig,
  agent: Record<string, unknown>,
  domain = matrixDomainFromConfig(config)
): OpenClawAgentContact {
  const agentId = stringValue(agent.id) ?? stringValue(agent.agentId) ?? stringValue(agent.name) ?? "default";
  const displayName = stringValue(agent.displayName) ?? stringValue(agent.name) ?? agentId;
  const contact: OpenClawAgentContact = {
    agentId,
    displayName,
    ghostUserId: agentGhostUserId(config, agentId, domain),
  };
  const rawAvatarUrl = stringValue(agent.avatarUrl) ?? stringValue(agent.avatar_url) ?? stringValue(agent.avatar);
  const avatarMxc = stringValue(agent.avatarMxc) ?? mxcAvatarURL(rawAvatarUrl);
  const description = stringValue(agent.description);
  if (avatarMxc) contact.avatarMxc = avatarMxc;
  const avatarUrl = rawAvatarUrl ?? avatarMxc;
  if (avatarUrl) contact.avatarUrl = avatarUrl;
  if (description) contact.description = description;
  return contact;
}

export async function createSessionRoom(
  client: Pick<MatrixClient, "appservice">,
  config: OpenClawBridgeConfig,
  options: {
    agent: OpenClawAgentContact;
    cwd?: string;
    domain?: string;
    label?: string;
    sessionKey: string;
    spaceId?: string;
  }
): Promise<OpenClawSessionBinding> {
  const now = Date.now();
  const domain = options.domain ?? matrixDomainFromHomeserver(config.homeserver);
  const roomName = options.label ?? `${options.agent.displayName}: ${options.sessionKey}`;
  const topic = [
    `OpenClaw agent: ${options.agent.agentId}`,
    `session: ${options.sessionKey}`,
    options.cwd ? `cwd: ${options.cwd}` : undefined,
  ].filter(Boolean).join("\n");
  const result = await client.appservice.createRoom({
    ...openClawRoomCreationPreset(config),
    invite: [],
    isDirect: true,
    name: roomName,
    topic,
    userId: serviceBotUserId(config, domain),
    visibility: "private",
  });
  const binding: OpenClawSessionBinding = {
    agentId: options.agent.agentId,
    createdAt: now,
    ghostUserId: options.agent.ghostUserId,
    id: bindingIdForRoom(result.roomId),
    kind: "session",
    owner: "bridge",
    roomId: result.roomId,
    sessionKey: options.sessionKey,
    updatedAt: now,
  };
  if (options.cwd) binding.cwd = options.cwd;
  if (options.label) binding.label = options.label;
  if (options.spaceId) binding.spaceId = options.spaceId;
  return binding;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mxcAvatarURL(value: string | undefined): string | undefined {
  return value?.startsWith("mxc://") ? value : undefined;
}
