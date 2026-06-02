export interface OpenClawAgentContact {
  agentId: string;
  displayName: string;
  ghostUserId: string;
  avatarMxc?: string;
  avatarUrl?: string;
  description?: string;
}

export interface OpenClawBeeperChannelInfo {
  agent?: OpenClawAgentContact;
  binding?: OpenClawSessionBinding;
  portalKey?: { id: string; receiver?: string };
  roomId: string;
}

export interface OpenClawSessionBinding {
  id: string;
  roomId: string;
  spaceId?: string;
  sessionKey?: string;
  agentId: string;
  ghostUserId: string;
  humanGhostUserId?: string;
  cwd?: string;
  label?: string;
  createdAt: number;
  updatedAt: number;
  lastRunId?: string;
  lastMatrixEventId?: string;
  lastStreamRunId?: string;
  lastStreamTargetEventId?: string;
}

export interface OpenClawBridgeConfig {
  asToken?: string;
  appserviceId: string;
  beeperEnv?: "production" | "staging" | "dev" | "local";
  bridgeId?: string;
  dataDir: string;
  homeserver?: string;
  hsToken?: string;
  homeserverDomain?: string;
  matrixDeviceId?: string;
  matrixUserId?: string;
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
