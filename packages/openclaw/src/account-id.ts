export function normalizeBeeperAccountId(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("@")) return trimmed;
  if (trimmed.includes(":")) return `@${trimmed}`;
  return undefined;
}

export function requireBeeperAccountId(value: string | null | undefined): string {
  const accountId = normalizeBeeperAccountId(value);
  if (!accountId) throw new Error("Beeper account ID must be a full Matrix user ID like @batuhan:beeper.com.");
  return accountId;
}

export function beeperAccountIdFromMatrixUserId(userId: string | undefined): string | undefined {
  const accountId = normalizeBeeperAccountId(userId);
  if (!accountId || !accountId.includes(":")) return undefined;
  const localpart = accountId.startsWith("@") ? accountId.slice(1).split(":")[0] : accountId.split(":")[0];
  const serverName = accountId.split(":").slice(1).join(":");
  return localpart && serverName ? accountId : undefined;
}
