const BEEPER_DOMAINS = new Set([
  "beeper.com",
  "beeper-staging.com",
  "beeper-dev.com",
  "beeper.localtest.me",
]);

export function isBeeperHomeserver(homeserverUrl: string): boolean {
  try {
    const hostname = new URL(homeserverUrl).hostname;
    return BEEPER_DOMAINS.has(hostname) || [...BEEPER_DOMAINS].some((domain) => hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
