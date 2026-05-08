export function piEventNoticeText(event: unknown): string | undefined {
  const record = recordValue(event);
  const type = stringValue(record?.type);
  if (!record || !type) return undefined;

  if (type === "session_start") {
    return `Session started${reasonSuffix(record.reason)}.`;
  }

  if (type === "queue_update") {
    const followUp = Array.isArray(record.followUp) ? record.followUp.length : 0;
    const steering = Array.isArray(record.steering) ? record.steering.length : 0;
    if (!followUp && !steering) return "Queue cleared.";
    return `Queue updated: ${followUp} follow-up${followUp === 1 ? "" : "s"} and ${steering} steering message${steering === 1 ? "" : "s"}.`;
  }

  if (type === "session_info_changed") {
    const name = piEventSessionTitle(record);
    return name ? `Session renamed to ${name}.` : "Session information changed.";
  }

  if (type === "thinking_level_changed") {
    const level = stringValue(record.level);
    return level ? `Thinking level set to ${sentenceCase(level)}.` : "Thinking level changed.";
  }

  if (type === "compaction_start") {
    return `Compaction started${reasonSuffix(record.reason)}.`;
  }

  if (type === "compaction_end") {
    if (record.aborted === true) return `Compaction canceled${reasonSuffix(record.reason)}.`;
    if (record.willRetry === true) return `Compaction will retry${errorSuffix(record.errorMessage)}.`;
    return `Compaction completed${errorSuffix(record.errorMessage)}.`;
  }

  if (type === "auto_retry_start") {
    const attempt = numberValue(record.attempt);
    const maxAttempts = numberValue(record.maxAttempts);
    const label = attempt && maxAttempts ? ` ${attempt} of ${maxAttempts}` : "";
    return `Retry${label} started${errorSuffix(record.errorMessage)}.`;
  }

  if (type === "auto_retry_end") {
    const attempt = numberValue(record.attempt);
    const label = attempt ? ` ${attempt}` : "";
    return record.success === true
      ? `Retry${label} succeeded.`
      : `Retry${label} failed${errorSuffix(record.finalError)}.`;
  }

  return undefined;
}

export function piEventSessionTitle(event: unknown): string | undefined {
  const record = recordValue(event);
  if (!record || stringValue(record.type) !== "session_info_changed") return undefined;
  return stringValue(record.name);
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

function sentenceCase(value: string): string {
  if (!value) return value;
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}
