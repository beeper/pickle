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
  const ghostPrefix = escapeRegex(config.ghostLocalpartPrefix);
  const userPrefix = escapeRegex(config.userLocalpartPrefix);
  const sender = escapeRegex(config.senderLocalpart);
  return {
    as_token: options.asToken ?? config.accessToken ?? secretToken(),
    hs_token: options.hsToken ?? config.hsToken ?? secretToken(),
    id: config.appserviceId,
    namespaces: {
      aliases: [{ exclusive: true, regex: `^#${escapeRegex(config.appserviceId)}_.+:.*$` }],
      rooms: [],
      users: [
        { exclusive: true, regex: `^@${sender}:.*$` },
        { exclusive: true, regex: `^@${ghostPrefix}.+:.*$` },
        { exclusive: true, regex: `^@${userPrefix}.+:.*$` },
      ],
    },
    receive_ephemeral: true,
    rate_limited: false,
    sender_localpart: config.senderLocalpart,
    url: config.registrationUrl,
  };
}

export function openClawAgentGhostLocalpart(config: OpenClawBridgeConfig, agentId: string): string {
  return `${config.ghostLocalpartPrefix}${encodeLocalpartSegment(agentId)}`;
}

export function openClawUserGhostLocalpart(config: OpenClawBridgeConfig, userId: string): string {
  return `${config.userLocalpartPrefix}${encodeLocalpartSegment(userId)}`;
}

export function openClawAliasLocalpart(config: OpenClawBridgeConfig, roomKey: string): string {
  return `${config.appserviceId}_${encodeLocalpartSegment(roomKey)}`;
}

export function openClawRoomCreationPreset(config: OpenClawBridgeConfig): Record<string, unknown> {
  return {
    creation_content: {
      "m.federate": !config.nonFederatedRooms,
    },
    preset: "private_chat",
  };
}

function encodeLocalpartSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9=_./-]+/g, "_").replace(/^_+|_+$/g, "") || "default";
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
