import type { MatrixBeeper, MatrixMessages, MatrixStreams } from "../client-types";
import type { MatrixClientOptions, SendMatrixStreamOptions, SentEvent } from "../types";
import { sendBeeperStream } from "./beeper";
import { sendEditStream } from "./edits";

export function createMatrixStreams(options: {
  beeper: MatrixBeeper;
  clientOptions: MatrixClientOptions;
  messages: MatrixMessages;
}): MatrixStreams {
  return {
    send: (opts) => sendStream(options, opts),
  };
}

async function sendStream(
  client: {
    beeper: MatrixBeeper;
    clientOptions: MatrixClientOptions;
    messages: MatrixMessages;
  },
  opts: SendMatrixStreamOptions
): Promise<SentEvent> {
  const mode = opts.mode ?? "auto";
  if (mode !== "edits" && (mode === "beeper" || supportsBeeperFeatures(client.clientOptions))) {
    return sendBeeperStream(client, opts);
  }
  return sendEditStream(client.messages, opts);
}

const BEEPER_DOMAINS = new Set([
  "beeper.com",
  "beeper-staging.com",
  "beeper-dev.com",
  "beeper.localtest.me",
]);

function isBeeperHomeserver(homeserverUrl: string): boolean {
  try {
    const hostname = new URL(homeserverUrl).hostname;
    return BEEPER_DOMAINS.has(hostname) || [...BEEPER_DOMAINS].some((domain) => hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function supportsBeeperFeatures(options: MatrixClientOptions): boolean {
  const homeserver = options.account?.homeserver ?? options.homeserver;
  return options.beeper ?? (homeserver ? isBeeperHomeserver(homeserver) : false);
}
