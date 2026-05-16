import { createMatrixClient } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import type { MatrixClient } from "@beeper/pickle";
import type { PicklePiConfig } from "./types";

export function createPicklePiMatrixClient(config: PicklePiConfig): MatrixClient {
  if (!config.homeserver) throw new Error("PICKLE_PI_HOMESERVER or config.homeserver is required");
  if (!config.accessToken) throw new Error("PICKLE_PI_ACCESS_TOKEN or config.accessToken is required");
  return createMatrixClient({
    beeper: true,
    homeserver: config.homeserver,
    store: createFileMatrixStore(config.storePath),
    token: config.accessToken,
    ...(config.pickleKey ? { pickleKey: config.pickleKey } : {}),
    ...(config.recoveryKey ? { recoveryKey: config.recoveryKey } : {}),
  });
}
