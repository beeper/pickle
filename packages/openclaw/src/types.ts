export type OpenClawBindingOwner = "bridge" | "terminal" | "mac-app" | "imported";
export type OpenClawBindingKind = "session" | "agent";
export type OpenClawImportSource = "dashboard" | "tui" | "channels" | "archived";

export interface OpenClawAgentContact {
  agentId: string;
  displayName: string;
  ghostUserId: string;
  avatarMxc?: string;
  description?: string;
}

export interface OpenClawUserContact {
  displayName: string;
  ghostUserId: string;
  source?: string;
  userId: string;
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
  accessToken?: string;
  allowedRoomIds?: string[];
  allowedUserIds?: string[];
  asToken?: string;
  appserviceId: string;
  approvalBehavior?: "native" | "disabled";
  backfillLimit?: number;
  baseDomain?: string;
  beeperEnv?: "production" | "staging" | "dev" | "local";
  bridgeId?: string;
  bridgeManagerPostState?: boolean;
  bridgeManagerToken?: string;
  contactVisibility?: "agents" | "agents-and-users" | "none";
  dataDir: string;
  ghostLocalpartPrefix: string;
  homeserver?: string;
  hsToken?: string;
  homeserverDomain?: string;
  importSources?: OpenClawImportSource[];
  matrixDeviceId?: string;
  matrixUserId?: string;
  nonFederatedRooms: boolean;
  registrationUrl: string;
  senderLocalpart: string;
  serviceBotLocalpart: string;
  storePath: string;
  streamFinalization?: "replace" | "append" | "native-only";
  userLocalpartPrefix: string;
}

export interface OpenClawBridgeRegistryData {
  agents: OpenClawAgentContact[];
  bindings: OpenClawSessionBinding[];
  dedupe: Record<string, number>;
  schemaVersion: 1;
  users: OpenClawUserContact[];
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
