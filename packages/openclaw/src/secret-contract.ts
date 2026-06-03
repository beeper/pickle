import {
  collectSecretInputAssignment,
  getChannelSurface,
  type ResolverContext,
  type SecretDefaults,
  type SecretTargetRegistryEntry,
} from "openclaw/plugin-sdk/channel-secret-basic-runtime";

export const secretTargetRegistryEntries: SecretTargetRegistryEntry[] = [
  {
    id: "channels.beeper.accounts.*.asToken",
    targetType: "channels.beeper.accounts.*.asToken",
    configFile: "openclaw.json",
    pathPattern: "channels.beeper.accounts.*.asToken",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  },
  {
    id: "channels.beeper.accounts.*.hsToken",
    targetType: "channels.beeper.accounts.*.hsToken",
    configFile: "openclaw.json",
    pathPattern: "channels.beeper.accounts.*.hsToken",
    secretShape: "secret_input",
    expectedResolvedValue: "string",
    includeInPlan: true,
    includeInConfigure: true,
    includeInAudit: true,
  },
];

export function collectRuntimeConfigAssignments(params: {
  config: { channels?: Record<string, unknown> };
  defaults?: SecretDefaults;
  context: ResolverContext;
}): void {
  const resolved = getChannelSurface(params.config, "beeper");
  if (!resolved) return;
  const { channel, surface } = resolved;
  const accounts = recordValue(channel.accounts);
  if (!accounts) return;
  for (const [accountId, value] of Object.entries(accounts)) {
    const account = recordValue(value);
    if (!account) continue;
    const accountEnabled = surface.channelEnabled && account.enabled !== false;
    for (const field of ["asToken", "hsToken"] as const) {
      const assignment = {
        value: account[field],
        path: `channels.beeper.accounts.${accountId}.${field}`,
        expected: "string" as const,
        defaults: params.defaults,
        context: params.context,
        active: accountEnabled,
        apply: (nextValue: unknown) => {
          account[field] = nextValue;
        },
      };
      if (!accountEnabled) {
        Object.assign(assignment, { inactiveReason: `Beeper account "${accountId}" is disabled.` });
      }
      collectSecretInputAssignment({
        ...assignment,
      });
    }
  }
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

export const channelSecrets = {
  secretTargetRegistryEntries,
  collectRuntimeConfigAssignments,
};
