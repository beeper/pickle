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
  gatewayUrl?: string;
  homeserver?: string;
  serviceBotLocalpart: string;
  storePath: string;
}

export interface OpenClawBridgeRegistryData {
  agents: OpenClawAgentContact[];
  bindings: OpenClawSessionBinding[];
  dedupe: Record<string, number>;
  schemaVersion: 1;
}
