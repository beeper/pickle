import type {
  MatrixAccount,
  MatrixClient,
  MatrixStore,
} from "pickle";

export interface MatrixChatThreadRef {
  eventId?: string;
  roomId: string;
}

interface MatrixAdapterBaseConfig {
  account?: MatrixAccount;
  beeper?: boolean;
  commandPrefix?: string;
  homeserver?: string;
  pickleKey?: string;
  sync?: {
    enabled?: boolean;
  };
  recoveryKey?: string;
  verifyRecoveryOnStart?: boolean;
  inviteAutoJoin?: {
    inviterAllowlist?: string[];
  };
  roomAllowlist?: string[];
  storePrefix?: string;
  store?: MatrixStore;
  token: string;
  typingTimeoutMs?: number;
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
