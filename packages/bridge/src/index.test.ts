import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MatrixClient } from "@beeper/pickle";
import type { BridgeConnector, NetworkAPI } from "./types";

const mocks = vi.hoisted(() => ({
  createMatrixClient: vi.fn(),
}));

vi.mock("@beeper/pickle", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@beeper/pickle")>()),
  createMatrixClient: mocks.createMatrixClient,
}));

describe("bridge factories", () => {
  beforeEach(() => {
    mocks.createMatrixClient.mockReset();
    mocks.createMatrixClient.mockReturnValue(fakeClient());
  });

  it("forwards wasmModule and wasmUrl options to Pickle", async () => {
    const { createBridge } = await import("./index");
    const connector = fakeConnector();
    const wasmModule = {} as WebAssembly.Module;

    createBridge({
      connector,
      matrix: {
        homeserver: "https://matrix.example",
        store: fakeStore(),
        token: "token",
        wasmModule,
        wasmUrl: "https://cdn.example/pickle.wasm",
      },
    });

    expect(mocks.createMatrixClient).toHaveBeenCalledWith(expect.objectContaining({
      wasmModule,
      wasmUrl: "https://cdn.example/pickle.wasm",
    }));
  });
});

function fakeConnector(): BridgeConnector {
  return {
    createLogin: () => ({ cancel: () => {}, start: async () => ({ instructions: "", stepId: "complete", type: "complete" }) }),
    getBridgeInfoVersion: () => ({ capabilities: 1, info: 1 }),
    getCapabilities: () => ({}),
    getConfig: () => ({}),
    getDBMetaTypes: () => ({}),
    getLoginFlows: () => [],
    getName: () => ({ displayName: "Test", networkId: "test" }),
    init: () => {},
    loadUserLogin: () => fakeNetwork(),
    start: () => {},
  };
}

function fakeNetwork(): NetworkAPI {
  return {
    connect: () => {},
    disconnect: () => {},
  };
}

function fakeClient(): MatrixClient {
  return {
    accountData: {} as MatrixClient["accountData"],
    appservice: {} as MatrixClient["appservice"],
    beeper: {} as MatrixClient["beeper"],
    boot: async () => ({ deviceId: "DEVICE", userId: "@bridge:example" }),
    close: async () => {},
    crypto: {} as MatrixClient["crypto"],
    logout: async () => {},
    media: {} as MatrixClient["media"],
    messages: {} as MatrixClient["messages"],
    raw: {} as MatrixClient["raw"],
    reactions: {} as MatrixClient["reactions"],
    receipts: {} as MatrixClient["receipts"],
    rooms: {} as MatrixClient["rooms"],
    streams: {} as MatrixClient["streams"],
    subscribe: async () => ({ catchUp: async () => {}, done: Promise.resolve(), stop: async () => {} }),
    sync: {} as MatrixClient["sync"],
    toDevice: {} as MatrixClient["toDevice"],
    typing: {} as MatrixClient["typing"],
    users: {} as MatrixClient["users"],
    whoami: async () => ({ deviceId: "DEVICE", userId: "@bridge:example" }),
  };
}

function fakeStore() {
  return {
    delete: async () => {},
    get: async () => null,
    list: async () => [],
    set: async () => {},
  };
}
