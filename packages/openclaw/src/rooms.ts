import type { OpenClawAgentContact, OpenClawBridgeConfig } from "./types";
import { openClawAgentGhostLocalpart, openClawSenderLocalpart } from "./registration";

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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mxcAvatarURL(value: string | undefined): string | undefined {
  return value?.startsWith("mxc://") ? value : undefined;
}
