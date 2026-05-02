import { stripUndefined } from "./object";
import type {
  MatrixCoreEvent,
  MatrixMessageEvent as RuntimeMessageEvent,
  MatrixReactionEvent as RuntimeReactionEvent,
} from "./runtime-types";
import type {
  MatrixAttachment,
  MatrixClientEvent,
  MatrixCryptoStatusEvent,
  MatrixMessageEvent,
  MatrixReactionEvent,
  MatrixSyncStatusEvent,
} from "./types";

export function toClientEvent(event: MatrixCoreEvent): MatrixClientEvent | null {
  if (event.type === "message") return toMessageEvent(event.event);
  if (event.type === "reaction") return toReactionEvent(event.event);
  if (event.type === "invite") return { kind: "invite", ...event.event };
  if (event.type === "sync_status") return toSyncEvent(event);
  if (event.type === "crypto_status") return toCryptoEvent(event);
  if (event.type === "decryption_error") {
    return stripUndefined({
      error: event.error,
      event: event.event
        ? { eventId: event.event.eventId, roomId: event.event.roomId, senderId: event.event.sender }
        : undefined,
      kind: "decryptionError" as const,
    }) as MatrixClientEvent;
  }
  if (event.type === "error") return { error: event.error, kind: "error" };
  return null;
}

export function toMessageEvent(event: RuntimeMessageEvent): MatrixMessageEvent {
  return stripUndefined({
    attachments: (event.attachments ?? []).map(toAttachment),
    class: "message" as const,
    content: event.content,
    edited: event.isEdited ?? false,
    encrypted: event.isEncrypted ?? false,
    eventId: event.eventId,
    html: event.formattedBody,
    kind: "message" as const,
    messageType: event.msgtype,
    raw: event.raw,
    roomId: event.roomId,
    sender: { isMe: event.isMe ?? false, userId: event.sender },
    text: event.body,
    threadRoot: event.threadRootEventId,
    timestamp: event.originServerTs,
    type: event.type,
  }) as MatrixMessageEvent;
}

function toReactionEvent(event: RuntimeReactionEvent): MatrixReactionEvent {
  return stripUndefined({
    added: event.added ?? true,
    class: "message" as const,
    content: event.content,
    eventId: event.eventId,
    key: event.key,
    kind: "reaction" as const,
    raw: event.raw,
    relatesTo: event.relatesToEventId,
    roomId: event.roomId,
    sender: { isMe: event.isMe ?? false, userId: event.sender },
    timestamp: event.originServerTs,
    type: event.type,
  }) as MatrixReactionEvent;
}

function toAttachment(
  attachment: NonNullable<RuntimeMessageEvent["attachments"]>[number]
): MatrixAttachment {
  return stripUndefined({
    contentType: attachment.info?.contentType,
    contentUri: attachment.contentUri,
    duration: attachment.info?.duration,
    encryptedFile: attachment.encryptedFile,
    filename: attachment.filename,
    height: attachment.info?.height,
    kind: attachment.msgtype.slice(2) as MatrixAttachment["kind"],
    size: attachment.info?.size,
    width: attachment.info?.width,
  });
}

function toSyncEvent(event: Extract<MatrixCoreEvent, { type: "sync_status" }>): MatrixSyncStatusEvent {
  const states = {
    init_step: "initStep",
    initialized: "initialized",
    retrying: "retrying",
    stopped: "stopped",
    synced: "synced",
    syncing: "syncing",
  } as const;
  return stripUndefined({
    durationMs: event.durationMs,
    error: event.error,
    failures: event.failures,
    kind: "sync" as const,
    nextRetryMs: event.nextRetryMs,
    state: states[event.status],
    step: event.step,
  }) as MatrixSyncStatusEvent;
}

function toCryptoEvent(
  event: Extract<MatrixCoreEvent, { type: "crypto_status" }>
): MatrixCryptoStatusEvent {
  const states = {
    enabled: "enabled",
    key_backup_unavailable: "keyBackupUnavailable",
    recovery_cache_unavailable: "recoveryCacheUnavailable",
    recovery_key_cached: "recoveryKeyCached",
    recovery_key_loaded: "recoveryKeyLoaded",
    recovery_restored: "recoveryRestored",
    recovery_unverified: "recoveryUnverified",
  } as const;
  return stripUndefined({
    error: event.error,
    keyBackupVersion: event.keyBackupVersion,
    keyId: event.keyId,
    kind: "crypto" as const,
    state: states[event.status],
  }) as MatrixCryptoStatusEvent;
}
