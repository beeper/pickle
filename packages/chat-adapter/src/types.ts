import type {
  GoRuntime,
  MatrixMediaAttachment,
  MatrixCore,
  MatrixCoreHost,
  MatrixCoreInitOptions,
  MatrixKeyValueStore,
} from "better-matrix-js";

export interface MatrixChatThreadRef {
  eventId?: string;
  roomId: string;
}

export interface MatrixAdapterConfig extends Omit<MatrixCoreInitOptions, "homeserverUrl"> {
  commandPrefix?: string;
  core?: MatrixCore;
  createCore?: () => Promise<MatrixCore>;
  go?: GoRuntime;
  host?: MatrixCoreHost;
  homeserverUrl?: string;
  polling?: {
    enabled?: boolean;
    retryDelayMs?: number;
    timeoutMs?: number;
  };
  verifyRecoveryOnStart?: boolean;
  inviteAutoJoin?: {
    inviterAllowlist?: string[];
  };
  roomAllowlist?: string[];
  statePrefix?: string;
  store?: MatrixKeyValueStore;
  typingTimeoutMs?: number;
  userName?: string;
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
