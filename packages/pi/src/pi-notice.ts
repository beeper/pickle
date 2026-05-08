export function piEventNoticeText(event: unknown): string | undefined {
  const record = recordValue(event);
  const type = stringValue(record?.type);
  if (!record || !type) return undefined;

  if (type === "queue_update") {
    const followUp = Array.isArray(record.followUp) ? record.followUp.length : 0;
    const steering = Array.isArray(record.steering) ? record.steering.length : 0;
    if (!followUp && !steering) return "Pi queue cleared.";
    return `Pi queue updated: ${followUp} follow-up${followUp === 1 ? "" : "s"}, ${steering} steering message${steering === 1 ? "" : "s"}.`;
  }

  if (type === "session_info_changed") {
    const name = stringValue(record.name);
    return name ? `Pi session renamed to ${name}.` : "Pi session info changed.";
  }

  if (type === "thinking_level_changed") {
    const level = stringValue(record.level);
    return level ? `Pi thinking level changed to ${level}.` : "Pi thinking level changed.";
  }

  if (type === "compaction_start") {
    return `Pi compaction started${reasonSuffix(record.reason)}.`;
  }

  if (type === "compaction_end") {
    if (record.aborted === true) return `Pi compaction aborted${reasonSuffix(record.reason)}.`;
    if (record.willRetry === true) return `Pi compaction will retry${errorSuffix(record.errorMessage)}.`;
    return `Pi compaction completed${errorSuffix(record.errorMessage)}.`;
  }

  if (type === "auto_retry_start") {
    const attempt = numberValue(record.attempt);
    const maxAttempts = numberValue(record.maxAttempts);
    const label = attempt && maxAttempts ? ` ${attempt}/${maxAttempts}` : "";
    return `Pi retry${label} started${errorSuffix(record.errorMessage)}.`;
  }

  if (type === "auto_retry_end") {
    const attempt = numberValue(record.attempt);
    const label = attempt ? ` ${attempt}` : "";
    return record.success === true
      ? `Pi retry${label} succeeded.`
      : `Pi retry${label} failed${errorSuffix(record.finalError)}.`;
  }

  return undefined;
}

function reasonSuffix(reason: unknown): string {
  return typeof reason === "string" && reason ? ` (${reason})` : "";
}

function errorSuffix(error: unknown): string {
  return typeof error === "string" && error ? `: ${error}` : "";
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
