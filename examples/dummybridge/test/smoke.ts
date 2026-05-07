import assert from "node:assert/strict";
import { RuntimeBridge } from "@beeper/pickle-bridge/bridge";
import type { MatrixClient, MatrixClientEvent, MatrixStore } from "@beeper/pickle";
import type { BridgeConnector, BridgeMatrixConfig, MatrixAppserviceInitOptions } from "@beeper/pickle-bridge/types";
import { DummyConnector, LOGIN_ID, PORTAL_ID } from "../src/connector";

interface SmokeCalls {
  appserviceInit: MatrixAppserviceInitOptions[];
  backfill: Array<{ events: unknown[]; roomId: string }>;
  createRoom: Array<{ name?: string; userId?: string }>;
  sendMessage: Array<{ content: { body?: string }; roomId: string; userId?: string }>;
  subscriptions: Array<{ filter: unknown; options: unknown }>;
}

const calls: SmokeCalls = {
  appserviceInit: [],
  backfill: [],
  createRoom: [],
  sendMessage: [],
  subscriptions: [],
};

const matrixClient = {
  appservice: {
    async batchSend(options: { events: unknown[]; roomId: string }) {
      calls.backfill.push(options);
      return { eventIds: options.events.map((_, index) => `$backfill-${index}`), raw: {} };
    },
    async createRoom(options: { name?: string; userId?: string }) {
      calls.createRoom.push(options);
      return { raw: {}, roomId: "!dummy:example" };
    },
    async createPortalRoom(options: { name?: string; userId?: string }) {
      calls.createRoom.push(options);
      return { raw: {}, roomId: "!dummy:example" };
    },
    async ensureJoined() {
      return { raw: {} };
    },
    async ensureRegistered() {
      return { raw: {} };
    },
    async init(options: MatrixAppserviceInitOptions) {
      calls.appserviceInit.push(options);
    },
    async sendMessage(options: { content: { body?: string }; roomId: string; userId?: string }) {
      calls.sendMessage.push(options);
      return { eventId: `$send-${calls.sendMessage.length}`, raw: {}, roomId: options.roomId };
    },
  },
  async boot() {
    return { deviceId: "DEVICE", userId: "@dummybridgebot:example" };
  },
  async close() {},
  raw: {
    async request() {
      throw new Error("smoke test should send remote messages through appservice ghosts");
    },
  },
  async subscribe(filter: unknown, _callback: unknown, options: unknown) {
    calls.subscriptions.push({ filter, options });
    return { stop() {} };
  },
} as unknown as MatrixClient;

const appservice: MatrixAppserviceInitOptions = {
  homeserver: "https://matrix.example",
  homeserverDomain: "example",
  registration: {
    asToken: "as-token",
    hsToken: "hs-token",
    id: "dummybridge",
    namespaces: {
      users: [{ exclusive: true, regex: "@dummybridgebot_.*:example" }],
    },
    senderLocalpart: "dummybridgebot",
    url: "http://localhost:29300",
  },
};

const bridge = new RuntimeBridge({
  appservice,
  connector: new DummyConnector() as BridgeConnector,
  matrix: {
    homeserver: "https://matrix.example",
    store: memoryStore(),
    token: "token",
    wasmModule: {} as WebAssembly.Module,
  } satisfies BridgeMatrixConfig,
}, matrixClient);

await bridge.start();
assert.equal(calls.appserviceInit.length, 1);

const login = { id: LOGIN_ID };
await bridge.loadUserLogin(login);

const portal = await bridge.createPortal(login, {
  id: PORTAL_ID,
  name: "Pickle DummyBridge",
  sender: "alice",
});

assert.equal(portal.mxid, "!dummy:example");
assert.equal(calls.createRoom[0]?.userId, bridge.ghostUserId("alice"));

const backfill = await bridge.backfillPortal(login, portal);

assert.deepEqual(backfill.eventIds, ["$backfill-0", "$backfill-1", "$backfill-2", "$backfill-3", "$backfill-4"]);
assert.equal(calls.backfill.length, 1);

await bridge.dispatchMatrixEvent({
  attachments: [],
  class: "message",
  content: { body: "hello bridge", msgtype: "m.text" },
  edited: false,
  encrypted: false,
  eventId: "$matrix",
  kind: "message",
  messageType: "m.text",
  raw: {},
  roomId: portal.mxid,
  sender: { isMe: false, userId: "@user:example" },
  text: "hello bridge",
  type: "m.room.message",
} satisfies MatrixClientEvent);
await bridge.flushRemoteEvents();

assert.equal(calls.sendMessage.length, 1);
assert.equal(calls.sendMessage[0]?.roomId, portal.mxid);
assert.equal(calls.sendMessage[0]?.userId, bridge.ghostUserId("alice"));
assert.equal(calls.sendMessage[0]?.content.body, "dummy echo: hello bridge");

await bridge.stop();
console.log("dummybridge smoke passed");

function memoryStore(): MatrixStore {
  const values = new Map<string, Uint8Array>();
  return {
    async delete(key: string) {
      values.delete(key);
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async list(prefix: string) {
      return [...values.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    async set(key: string, value: Uint8Array) {
      values.set(key, value);
    },
  };
}
