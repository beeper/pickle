import type {
  GoRuntime,
  MatrixMediaAttachment,
  MatrixCore,
  MatrixCoreHost,
  MatrixStore,
} from "better-matrix-js";

export interface MatrixChatThreadRef {
  eventId?: string;
  roomId: string;
}

export interface MatrixAdapterConfig {
  commandPrefix?: string;
  core?: MatrixCore;
  createCore?: () => Promise<MatrixCore>;
  deviceId?: string;
  go?: GoRuntime;
  host?: MatrixCoreHost;
  homeserver?: string;
  initialSync?: "persisted" | "latest" | "catchUp";
  pickleKey?: string;
  polling?: {
    enabled?: boolean;
    retryDelayMs?: number;
    timeoutMs?: number;
  };
  recoveryCode?: string;
  recoveryKey?: string;
  verifyRecoveryOnStart?: boolean;
  inviteAutoJoin?: {
    inviterAllowlist?: string[];
  };
  roomAllowlist?: string[];
  since?: string;
  storePrefix?: string;
  store?: MatrixStore;
  token: string;
  typingTimeoutMs?: number;
  userId?: string;
  wasmBytes?: BufferSource;
  wasmModule?: WebAssembly.Module;
  wasmUrl?: string | URL;
}

export interface MatrixRawMessage {
  attachments?: MatrixMediaAttachment[];
  body?: string;
  content?: Record<string, unknown>;
  eventId: string;
  formattedBody?: string;
  isEncrypted?: boolean;
  isEdited?: boolean;
  isMe?: boolean;
  msgtype?: string;
  originServerTs?: number;
  raw?: unknown;
  roomId: string;
  sender?: string;
  threadRootEventId?: string;
  type?: string;
}
