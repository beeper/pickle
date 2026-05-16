export type OpenClawBindingOwner = "bridge" | "terminal" | "mac-app" | "imported";
export type OpenClawBindingKind = "session" | "agent";

export interface OpenClawAgentContact {
  agentId: string;
  displayName: string;
  ghostUserId: string;
  avatarMxc?: string;
  description?: string;
}

export interface OpenClawSessionBinding {
  id: string;
  kind: OpenClawBindingKind;
  owner: OpenClawBindingOwner;
  roomId: string;
  spaceId?: string;
  sessionKey: string;
  agentId: string;
  ghostUserId: string;
  cwd?: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
  lastMatrixEventId?: string;
  lastStreamTargetEventId?: string;
}

export interface OpenClawBridgeConfig {
  accessToken?: string;
  allowedRoomIds?: string[];
  allowedUserIds?: string[];
  appserviceId: string;
  dataDir: string;
  ghostLocalpartPrefix: string;
  gatewayUrl?: string;
  homeserver?: string;
  hsToken?: string;
  nonFederatedRooms: boolean;
  registrationUrl: string;
  senderLocalpart: string;
  serviceBotLocalpart: string;
  storePath: string;
  userLocalpartPrefix: string;
}

export interface OpenClawBridgeRegistryData {
  agents: OpenClawAgentContact[];
  bindings: OpenClawSessionBinding[];
  dedupe: Record<string, number>;
  schemaVersion: 1;
}

export interface AppserviceRegistration {
  as_token: string;
  hs_token: string;
  id: string;
  namespaces: {
    aliases: Array<{ exclusive: boolean; regex: string }>;
    rooms: Array<{ exclusive: boolean; regex: string }>;
    users: Array<{ exclusive: boolean; regex: string }>;
  };
  receive_ephemeral: boolean;
  rate_limited: boolean;
  sender_localpart: string;
  url: string;
}
