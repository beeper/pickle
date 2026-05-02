import { afterEach, describe, expect, it, vi } from "vitest";
import { startMatrixPolling } from "./polling";
import type { MatrixCore } from "./runtime-types";

function makePollingCore(syncOnce: MatrixCore["syncOnce"]): MatrixCore {
  return {
    addReaction: vi.fn(),
    applySyncResponse: vi.fn(),
    close: vi.fn(),
    deleteMessage: vi.fn(),
    downloadEncryptedMedia: vi.fn(),
    downloadMedia: vi.fn(),
    editMessage: vi.fn(),
    fetchJoinedRooms: vi.fn(),
    fetchMessage: vi.fn(),
    fetchMessages: vi.fn(),
    fetchRoom: vi.fn(),
    init: vi.fn(),
    inviteUser: vi.fn(),
    joinRoom: vi.fn(),
    leaveRoom: vi.fn(),
    listRoomThreads: vi.fn(),
    markRead: vi.fn(),
    onEvent: vi.fn(),
    openDM: vi.fn(),
    postMediaMessage: vi.fn(),
    postMessage: vi.fn(),
    removeReaction: vi.fn(),
    registerBeeperStream: vi.fn(),
    setTyping: vi.fn(),
    syncOnce,
    uploadEncryptedMedia: vi.fn(),
    uploadMedia: vi.fn(),
    whoami: vi.fn(),
  } as unknown as MatrixCore;
}

describe("startMatrixPolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes the configured long-poll timeout to every sync", async () => {
    vi.useFakeTimers();
    const resolvers: Array<() => void> = [];
    const syncOnce = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvers.push(resolve);
        })
    );
    const handle = startMatrixPolling(makePollingCore(syncOnce), { timeoutMs: 12_345 });

    await vi.waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));
    expect(syncOnce).toHaveBeenLastCalledWith({ timeoutMs: 12_345 });

    resolvers[0]?.();
    await vi.waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(2));
    expect(syncOnce).toHaveBeenLastCalledWith({ timeoutMs: 12_345 });

    const stopped = handle.stop();
    resolvers[1]?.();
    await stopped;
    expect(syncOnce).toHaveBeenCalledTimes(2);
  });

  it("backs off after errors and aborts retry sleep on stop", async () => {
    vi.useFakeTimers();
    const syncOnce = vi.fn(async () => {
      throw new Error("temporary sync failure");
    });
    const handle = startMatrixPolling(makePollingCore(syncOnce), {
      retryDelayMs: 1_000,
      timeoutMs: 1,
    });

    await vi.waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(999);
    expect(syncOnce).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(2));

    await expect(handle.stop()).resolves.toBeUndefined();
  });

});
