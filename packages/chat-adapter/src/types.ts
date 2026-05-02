import type {
  MatrixClient,
  MatrixStore,
} from "better-matrix-js";

export interface MatrixChatThreadRef {
  eventId?: string;
  roomId: string;
}

interface MatrixAdapterBaseConfig {
  commandPrefix?: string;
  deviceId?: string;
  homeserver?: string;
  initialSync?: "persisted" | "latest" | "catchUp";
  pickleKey?: string;
  sync?: {
    enabled?: boolean;
    retryDelayMs?: number;
    timeoutMs?: number;
  };
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

export type MatrixAdapterConfig =
  | (MatrixAdapterBaseConfig & {
      client: MatrixClient;
      createClient?: never;
      token?: string;
    })
  | (MatrixAdapterBaseConfig & {
      client?: never;
      createClient: () => MatrixClient | Promise<MatrixClient>;
      token?: string;
    })
  | (MatrixAdapterBaseConfig & {
      client?: never;
      createClient?: never;
      token: string;
    });
