import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import type { SecretInput } from "openclaw/plugin-sdk/secret-input-runtime";
import { hasConfiguredSecretInput } from "openclaw/plugin-sdk/secret-input-runtime";

type BeeperAuthPresenceParams =
  | {
      cfg: OpenClawConfig;
      env?: NodeJS.ProcessEnv;
    }
  | OpenClawConfig;

type BeeperAuthAccount = {
  asToken?: SecretInput;
  bridge?: {
    homeserver?: string;
    matrixDeviceId?: string;
    matrixUserId?: string;
  };
  enabled?: boolean;
  hsToken?: SecretInput;
};

type BeeperAuthChannel = {
  accounts?: Record<string, BeeperAuthAccount | undefined>;
};

export function hasAnyBeeperAuth(
  params: BeeperAuthPresenceParams,
): boolean {
  const cfg = params && typeof params === "object" && "cfg" in params ? params.cfg : params;
  const channel = cfg.channels?.beeper as BeeperAuthChannel | undefined;
  if (!channel) return false;
  return listBeeperAuthAccounts(channel).some((account) => hasBeeperAuthAccount(account, cfg));
}

export const hasAnyBeeperConfiguredState = hasAnyBeeperAuth;

function listBeeperAuthAccounts(channel: BeeperAuthChannel): readonly BeeperAuthAccount[] {
  return Object.values(channel.accounts ?? {}).filter((account): account is BeeperAuthAccount => Boolean(account));
}

function hasBeeperAuthAccount(account: BeeperAuthAccount, cfg: OpenClawConfig): boolean {
  const bridge = account.bridge;
  return Boolean(
    account.enabled !== false &&
    hasConfiguredSecretInput(account.asToken, cfg.secrets?.defaults) &&
    hasConfiguredSecretInput(account.hsToken, cfg.secrets?.defaults) &&
    bridge?.homeserver &&
    bridge.matrixDeviceId &&
    bridge.matrixUserId
  );
}
