export type PicklePiBindingOwner = "appservice" | "terminal" | "imported";
export type PicklePiBindingMode = "headless" | "terminal-attached";

export interface PicklePiBinding {
  id: string;
  roomId: string;
  spaceId?: string;
  cwd: string;
  piSessionFile: string;
  owner: PicklePiBindingOwner;
  mode: PicklePiBindingMode;
  piGhostUserId: string;
  serviceBotUserId?: string;
  createdAt: number;
  updatedAt: number;
  activeLeafId?: string;
  sessionName?: string;
  lastPiEntryId?: string;
  lastMatrixEventId?: string;
  lastStreamTargetEventId?: string;
}

export interface ActiveRun {
  bindingId: string;
  turnId: string;
  targetEventId?: string;
  roomId: string;
  seq: number;
  textPartId?: string;
  reasoningPartId?: string;
  toolCallIdToApprovalId: Record<string, string>;
  finalTextBuffer: string;
  startedAt: number;
}

export interface MatrixInboundTurn {
  id: string;
  roomId: string;
  eventId: string;
  sender: string;
  text: string;
  images?: Array<{ mimeType: string; data: string }>;
  files?: Array<{ name: string; mimeType?: string; path: string; matrixMxc?: string }>;
  receivedAt: number;
  priority: "control" | "priority" | "default";
}

export interface ProjectSpaceRecord {
  cwd: string;
  projectKey: string;
  spaceId: string;
  createdAt: number;
  updatedAt: number;
}

export interface PicklePiRegistryData {
  bindings: PicklePiBinding[];
  dedupe: Record<string, number>;
  projectSpaces: ProjectSpaceRecord[];
  schemaVersion: 1;
}

export interface PicklePiConfig {
  accessToken?: string;
  allowedRoomIds?: string[];
  allowedUserIds?: string[];
  appserviceId: string;
  dataDir: string;
  ghostLocalpart: string;
  homeserver?: string;
  pickleKey?: string;
  recoveryKey?: string;
  serviceBotLocalpart: string;
  storePath: string;
}

export interface AppserviceRegistration {
  as_token: string;
  "de.sorunome.msc2409.push_ephemeral": boolean;
  hs_token: string;
  id: string;
  namespaces: {
    aliases: Array<{ exclusive: boolean; regex: string }>;
    rooms: Array<{ exclusive: boolean; regex: string }>;
    users: Array<{ exclusive: boolean; regex: string }>;
  };
  rate_limited: boolean;
  sender_localpart: string;
  url: string;
}
