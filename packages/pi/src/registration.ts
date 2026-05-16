import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { secretToken } from "./config";
import type { AppserviceRegistration, PicklePiConfig } from "./types";

export interface RegistrationOptions {
  appserviceUrl?: string;
  domain?: string;
  hsToken?: string;
  asToken?: string;
}

export function generateRegistration(config: PicklePiConfig, options: RegistrationOptions = {}): AppserviceRegistration {
  const userPrefix = escapeRegex(config.ghostLocalpart);
  const bot = escapeRegex(config.serviceBotLocalpart);
  return {
    as_token: options.asToken ?? secretToken(),
    hs_token: options.hsToken ?? secretToken(),
    id: config.appserviceId,
    namespaces: {
      aliases: [{ exclusive: true, regex: `^#pickle-pi_.+${domainSuffix(options.domain)}$` }],
      rooms: [],
      users: [{ exclusive: true, regex: `^@(?:${bot}|${userPrefix}(?:_.+)?)${domainSuffix(options.domain)}$` }],
    },
    receive_ephemeral: true,
    rate_limited: false,
    sender_localpart: config.serviceBotLocalpart,
    url: options.appserviceUrl ?? "http://localhost:29331",
  };
}

export async function writeRegistration(path: string, registration: AppserviceRegistration): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(registration, null, 2)}\n`, { mode: 0o600 });
}

function domainSuffix(domain?: string): string {
  return domain ? `:${escapeRegex(domain)}` : ".*";
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
