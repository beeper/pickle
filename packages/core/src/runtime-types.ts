import type {
  MatrixInviteEvent,
  MatrixMessageEvent,
  MatrixRawEvent,
  MatrixReactionEvent,
} from "./generated-runtime-types";
import type { MatrixCoreOperations } from "./generated-runtime-operations";

export type {
  MatrixApplySyncResponseOptions,
  MatrixBanUserOptions,
  MatrixBeeperStreamOptions,
  MatrixCoreInitOptions,
  MatrixCryptoStatus,
  MatrixCreateBeeperStreamOptions,
  MatrixCreateBeeperStreamResult,
  MatrixCreateRoomOptions,
  MatrixCreateRoomResult,
  MatrixDeleteMessageOptions,
  MatrixDownloadEncryptedMediaOptions,
  MatrixDownloadMediaOptions,
  MatrixDownloadMediaResult,
  MatrixEditMessageOptions,
  MatrixEncryptedFile,
  MatrixEncryptedFileKey,
  MatrixFetchMessageOptions,
  MatrixFetchMessageResult,
  MatrixFetchMessagesOptions,
  MatrixFetchMessagesResult,
  MatrixFetchRoomMembersOptions,
  MatrixFetchRoomOptions,
  MatrixFetchRoomStateEventOptions,
  MatrixFetchRoomStateOptions,
  MatrixFetchRoomStateResult,
  MatrixGetUserOptions,
  MatrixInviteEvent,
  MatrixInviteUserOptions,
  MatrixJoinRoomOptions,
  MatrixJoinRoomResult,
  MatrixJoinedRoomsResult,
  MatrixKickUserOptions,
  MatrixLeaveRoomOptions,
  MatrixListRoomThreadsOptions,
  MatrixListRoomThreadsResult,
  MatrixMarkReadOptions,
  MatrixMediaAttachment,
  MatrixMediaInfo,
  MatrixMentions,
  MatrixMessageEvent,
  MatrixOpenDMOptions,
  MatrixOpenDMResult,
  MatrixOwnAvatarURLResult,
  MatrixOwnDisplayNameResult,
  MatrixRawEvent,
  MatrixRawMessage,
  MatrixReactionEvent,
  MatrixReactionOptions,
  MatrixRegisterBeeperStreamOptions,
  MatrixRoomInfo,
  MatrixRoomMember,
  MatrixRoomMembersResult,
  MatrixRoomStateEvent,
  MatrixRoomStateInput,
  MatrixRoomThreadSummary,
  MatrixSendEphemeralEventOptions,
  MatrixSendMediaMessageOptions,
  MatrixSendMessageOptions,
  MatrixSendRoomStateEventOptions,
  MatrixSetOwnAvatarURLOptions,
  MatrixSetOwnDisplayNameOptions,
  MatrixSyncOnceOptions,
  MatrixSyncStartOptions,
  MatrixTypingOptions,
  MatrixUnbanUserOptions,
  MatrixUploadEncryptedMediaResult,
  MatrixUploadMediaOptions,
  MatrixUploadMediaResult,
  MatrixUserInfo,
  MatrixWhoami,
} from "./generated-runtime-types";

export type MatrixCoreEvent =
  | { event: MatrixMessageEvent; type: "message" }
  | { event: MatrixReactionEvent; type: "reaction" }
  | { event: MatrixInviteEvent; type: "invite" }
  | {
      event: {
        content?: Record<string, unknown>;
        eventId: string;
        raw: unknown;
        roomId: string;
        sender?: string;
      };
      type: "beeper_stream_update";
    }
  | {
      error?: string;
      keyBackupVersion?: string;
      keyId?: string;
      status:
        | "enabled"
        | "key_backup_unavailable"
        | "recovery_cache_unavailable"
        | "recovery_key_cached"
        | "recovery_key_loaded"
        | "recovery_restored"
        | "recovery_unverified";
      type: "crypto_status";
    }
  | {
      error: string;
      event?: Pick<MatrixRawEvent, "eventId" | "roomId" | "sender">;
      type: "decryption_error";
    }
  | { error: string; type: "error" }
  | {
      durationMs?: number;
      error?: string;
      failures?: number;
      nextRetryMs?: number;
      status: "initialized" | "init_step" | "syncing" | "synced" | "retrying" | "stopped";
      step?: string;
      type: "sync_status";
    };

export type { MatrixCoreOperations } from "./generated-runtime-operations";

export interface MatrixCore extends MatrixCoreOperations {
  callBytesJson?<T>(operation: string, payload: unknown, bytes: Uint8Array): Promise<T>;
  callBytesResult?(operation: string, payload?: unknown): Promise<Uint8Array>;
  onEvent(listener: (event: MatrixCoreEvent) => void): () => void;
  supportsByteCalls?(): boolean;
}

export interface MatrixCoreHost {
  fetch?: typeof fetch;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) => void;
  randomBytes?: (length: number) => Uint8Array;
  state?: MatrixStore;
}

export interface MatrixStore {
  delete(key: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  list(prefix: string): Promise<string[]>;
  set(key: string, value: Uint8Array): Promise<void>;
}
