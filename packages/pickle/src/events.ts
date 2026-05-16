import { stripUndefined } from "./object";
import type {
  MatrixCoreEvent,
  MatrixMessageEvent as RuntimeMessageEvent,
  MatrixReactionEvent as RuntimeReactionEvent,
} from "./runtime-types";
import type {
  MatrixAttachment,
  MatrixClientEvent,
  MatrixCryptoStatus,
  MatrixCryptoStatusEvent,
  MatrixBeeperStreamEvent,
  MatrixGenericEvent,
  MatrixMessageEvent,
  MatrixReactionEvent,
  MatrixSyncStatusEvent,
} from "./types";

export function toClientEvent(event: MatrixCoreEvent): MatrixClientEvent | null {
  if (event.type === "message") return toMessageEvent(event.event);
  if (event.type === "reaction") return toReactionEvent(event.event);
  if (event.type === "invite") return { kind: "invite", ...event.event };
  if (event.type === "raw_event") return toGenericEvent(event.event, "raw", event.since, event.nextBatch);
  if (event.type === "account_data") return toGenericEvent(event.event, "accountData");
  if (event.type === "to_device") return toGenericEvent(event.event, "toDevice");
  if (event.type === "receipt") return toGenericEvent(event.event, "receipt");
  if (event.type === "typing") return toGenericEvent(event.event, "typing");
  if (event.type === "presence") return toGenericEvent(event.event, "presence");
  if (event.type === "device_list") return toGenericEvent(event.event, "deviceList");
  if (event.type === "ephemeral") return toGenericEvent(event.event, "ephemeral");
  if (event.type === "membership") return toGenericEvent(event.event, "membership");
  if (event.type === "redaction") return toGenericEvent(event.event, "redaction");
  if (event.type === "room_state") return toGenericEvent(event.event, "roomState");
  if (event.type === "beeper_stream_update") return toBeeperStreamEvent(event.event);
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

function toGenericEvent(
  event: import("./runtime-types").MatrixSyncEvent,
  kind: MatrixGenericEvent["kind"],
  since?: string,
  nextBatch?: string
): MatrixGenericEvent {
  return stripUndefined({
    class: event.class === "raw" ? "unknown" : event.class,
    content: event.content,
    decrypted: event.decrypted,
    encrypted: event.encrypted,
    eventId: event.eventId,
    kind,
    nextBatch: event.nextBatch ?? nextBatch,
    raw: event.raw,
    roomId: event.roomId,
    section: event.section,
    sender: event.sender ? { isMe: false, userId: event.sender } : undefined,
    since,
    stateKey: event.stateKey,
    timestamp: event.originServerTs,
    type: event.type,
  }) as MatrixGenericEvent;
}

function toBeeperStreamEvent(
  event: Extract<MatrixCoreEvent, { type: "beeper_stream_update" }>["event"]
): MatrixBeeperStreamEvent {
  return stripUndefined({
    class: "toDevice" as const,
    content: event.content ?? {},
    eventId: event.eventId,
    kind: "stream" as const,
    raw: event.raw,
    roomId: event.roomId,
    sender: event.sender ? { isMe: false, userId: event.sender } : undefined,
    type: "com.beeper.stream.update" as const,
  }) as MatrixBeeperStreamEvent;
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
    mentions: event.mentions,
    raw: event.raw,
    relation: event.relation,
    replaces: event.replaces,
    replyTo: event.replyTo,
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
    skipped: "skipped",
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
  const state = toCryptoState(event.status);
  return stripUndefined({
    error: event.error,
    keyBackupVersion: event.keyBackupVersion,
    keyId: event.keyId,
    kind: "crypto" as const,
    state,
  }) as MatrixCryptoStatusEvent;
}

export function toCryptoStatusSnapshot(
  status: import("./runtime-types").MatrixCryptoStatus
): MatrixCryptoStatus {
  return stripUndefined({
    deviceId: status.deviceId,
    hasRecoveryKey: status.hasRecoveryKey,
    keyBackupVersion: status.keyBackupVersion,
    pendingDecryptionCount: status.pendingDecryptionCount,
    state: toCryptoState(status.state),
    storeBacked: status.storeBacked,
    userId: status.userId,
  }) as MatrixCryptoStatus;
}

function toCryptoState(
  state: import("./runtime-types").MatrixCryptoStatus["state"]
): MatrixCryptoStatus["state"] {
  const states = {
    disabled: "disabled",
    enabled: "enabled",
    key_backup_updated: "keyBackupUpdated",
    key_backup_unavailable: "keyBackupUnavailable",
    recovery_cache_unavailable: "recoveryCacheUnavailable",
    recovery_key_cached: "recoveryKeyCached",
    recovery_key_loaded: "recoveryKeyLoaded",
    recovery_restored: "recoveryRestored",
    recovery_unverified: "recoveryUnverified",
  } as const;
  return states[state];
}
