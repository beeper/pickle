import { secretToken } from "./config";
import type { AppserviceRegistration, OpenClawBridgeConfig } from "./types";

export interface CreateRegistrationOptions {
  asToken?: string;
  hsToken?: string;
}

export function createAppserviceRegistration(
  config: OpenClawBridgeConfig,
  options: CreateRegistrationOptions = {}
): AppserviceRegistration {
  const domain = escapeRegex(config.homeserverDomain ?? matrixDomainFromHomeserver(config.homeserver));
  const ghostPrefix = escapeRegex(openClawAgentGhostPrefix(config));
  const userPrefix = escapeRegex(openClawUserGhostPrefix(config));
  const senderLocalpart = openClawSenderLocalpart(config);
  const sender = escapeRegex(senderLocalpart);
  return {
    as_token: options.asToken ?? config.asToken ?? secretToken(),
    hs_token: options.hsToken ?? config.hsToken ?? secretToken(),
    id: config.appserviceId,
    namespaces: {
      aliases: [{ exclusive: true, regex: `^#${escapeRegex(config.appserviceId)}_.+:.*$` }],
      rooms: [],
      users: [
        { exclusive: true, regex: `^@${ghostPrefix}.+:${domain}$` },
        { exclusive: true, regex: `^@${userPrefix}.+:${domain}$` },
        { exclusive: true, regex: `^@${sender}:${domain}$` },
      ],
    },
    receive_ephemeral: true,
    rate_limited: false,
    sender_localpart: senderLocalpart,
    url: "websocket",
  };
}

function matrixDomainFromHomeserver(homeserver: string | undefined): string {
  if (!homeserver) return "localhost";
  try {
    return new URL(homeserver).hostname;
  } catch {
    return homeserver.replace(/^https?:\/\//, "").split("/")[0] || "localhost";
  }
}

export function openClawAgentGhostLocalpart(config: OpenClawBridgeConfig, agentId: string): string {
  return `${openClawAgentGhostPrefix(config)}${encodeLocalpartSegment(agentId)}`;
}

export function openClawUserGhostLocalpart(config: OpenClawBridgeConfig, userId: string): string {
  return `${openClawUserGhostPrefix(config)}${encodeLocalpartSegment(userId)}`;
}

export function openClawAliasLocalpart(config: OpenClawBridgeConfig, roomKey: string): string {
  return `${config.appserviceId}_${encodeLocalpartSegment(roomKey)}`;
}

export function openClawRoomCreationPreset(config: OpenClawBridgeConfig): Record<string, unknown> {
  return {
    creation_content: {
      "m.federate": false,
    },
    preset: "private_chat",
  };
}

export function openClawBridgeId(config: OpenClawBridgeConfig): string {
  return config.bridgeId ?? config.appserviceId;
}

export function openClawAgentGhostPrefix(config: OpenClawBridgeConfig): string {
  return `${openClawBridgeId(config)}_agent_`;
}

export function openClawUserGhostPrefix(config: OpenClawBridgeConfig): string {
  return `${openClawBridgeId(config)}_user_`;
}

export function openClawSenderLocalpart(config: OpenClawBridgeConfig): string {
  return `${openClawBridgeId(config)}bot`;
}

function encodeLocalpartSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9=_./-]+/g, "_").replace(/^_+|_+$/g, "") || "default";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
