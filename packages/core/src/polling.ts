import type { MatrixCore } from "./types";

export interface MatrixPollingOptions {
  retryDelayMs?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface MatrixPollingHandle {
  stop(): Promise<void>;
}

const DEFAULT_SYNC_TIMEOUT_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });

export function startMatrixPolling(
  core: MatrixCore,
  options: MatrixPollingOptions = {}
): MatrixPollingHandle {
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  let active = true;
  let task: Promise<void> | null = null;

  task = (async () => {
    let failures = 0;
    while (active && !signal.aborted) {
      try {
        await core.syncOnce({ timeoutMs: options.timeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS });
        failures = 0;
      } catch (error) {
        if (signal.aborted) {
          return;
        }
        failures += 1;
        const retryDelay = Math.min(
          (options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS) * 2 ** (failures - 1),
          MAX_RETRY_DELAY_MS
        );
        await sleep(retryDelay, signal);
      }
    }
  })();

  return {
    async stop() {
      active = false;
      controller.abort();
      if (task) {
        try {
          await task;
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) {
            throw error;
          }
        }
      }
    },
  };
}
