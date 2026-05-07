import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBeeperAppServiceInit, createBridge } from "@beeper/pickle-bridge/node";
import type { BeeperClientOptions, CreateAppServiceOptions } from "@beeper/pickle-bridge/node";
import type { Portal } from "@beeper/pickle-bridge/types";
import { DummyConnector, LOGIN_ID, PORTAL_ID, makeGhostMxid } from "./connector";
import { loadEnv, optionalEnv, requiredEnv } from "./env";
import { FileState, MatrixState } from "./store";

const root = dirname(fileURLToPath(import.meta.url));
const sourceRoot = root.endsWith("/dist/src") ? resolve(root, "../..") : resolve(root, "..");
const dataDir = resolve(sourceRoot, ".data");

await loadEnv(resolve(sourceRoot, ".env"));

const homeserver = requiredEnv("MATRIX_HOMESERVER");
const token = requiredEnv("MATRIX_ACCESS_TOKEN");
const serverName = requiredEnv("MATRIX_SERVER_NAME");
const senderLocalpart = optionalEnv("DUMMYBRIDGE_SENDER_LOCALPART", "dummybridgebot") ?? "dummybridgebot";

const appservice = process.env.BEEPER_ACCESS_TOKEN
  ? await createBeeperAppServiceInit(beeperAppServiceOptions({
    address: optionalEnv("DUMMYBRIDGE_URL"),
    baseDomain: optionalEnv("BEEPER_BASE_DOMAIN", "beeper.com"),
    bridge: optionalEnv("DUMMYBRIDGE_AS_ID", "dummybridge") ?? "dummybridge",
    homeserver,
    homeserverDomain: serverName,
    token: requiredEnv("BEEPER_ACCESS_TOKEN"),
  }))
  : localAppService({
    homeserver,
    id: optionalEnv("DUMMYBRIDGE_AS_ID", "dummybridge") ?? "dummybridge",
    senderLocalpart,
    serverName,
    url: optionalEnv("DUMMYBRIDGE_URL", "http://localhost:29300") ?? "http://localhost:29300",
  });

const state = new FileState(resolve(dataDir, "state.json"));
await state.connect();
await mkdir(dataDir, { recursive: true });

const bridge = createBridge({
  appservice,
  connector: new DummyConnector({ senderLocalpart, serverName }),
  matrix: {
    homeserver,
    store: new MatrixState(state, "dummybridge-matrix"),
    token,
    wasmPath: resolve(sourceRoot, "../../packages/pickle/dist/pickle.wasm"),
  },
});

await bridge.start();
const login = { id: LOGIN_ID };
await bridge.loadUserLogin(login);

const ghostMxid = makeGhostMxid("alice", serverName, senderLocalpart);
const existingRoomId = optionalEnv("DUMMYBRIDGE_PORTAL_ROOM_ID");
let portal: Portal | null = null;

if (existingRoomId) {
  portal = {
    id: PORTAL_ID,
    mxid: existingRoomId,
    portalKey: { id: PORTAL_ID, receiver: login.id },
    receiver: login.id,
  };
  bridge.registerPortal(portal);
  console.log(`registered existing portal ${existingRoomId}`);
} else if (optionalEnv("DUMMYBRIDGE_CREATE_ROOM") === "1") {
  const inviteUser = optionalEnv("DUMMYBRIDGE_INVITE_USER");
  portal = await bridge.createPortalRoom({
    invite: inviteUser ? [inviteUser] : [],
    name: "Pickle DummyBridge",
    portalKey: { id: PORTAL_ID, receiver: login.id },
    topic: "A TypeScript bridge built with Pickle.",
    userId: ghostMxid,
  });
  console.log(`created portal ${portal.mxid}`);
}

if (portal?.mxid && optionalEnv("DUMMYBRIDGE_BACKFILL_ON_START") === "1") {
  await bridge.backfill({
    events: [{
      content: {
        body: "DummyBridge backfilled hello",
        msgtype: "m.text",
      },
      sender: ghostMxid,
      timestamp: Date.now() - 60_000,
    }],
    roomId: portal.mxid,
  });
  console.log(`backfilled ${portal.mxid}`);
}

console.log("dummybridge running");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await bridge.stop();
    await state.disconnect();
    process.exit(0);
  });
}

function localAppService(options: {
  homeserver: string;
  id: string;
  senderLocalpart: string;
  serverName: string;
  url: string;
}) {
  return {
    homeserver: options.homeserver,
    homeserverDomain: options.serverName,
    registration: {
      asToken: requiredEnv("DUMMYBRIDGE_AS_TOKEN"),
      hsToken: requiredEnv("DUMMYBRIDGE_HS_TOKEN"),
      id: options.id,
      namespaces: {
        aliases: [],
        rooms: [],
        users: [{
          exclusive: true,
          regex: `@${options.senderLocalpart}_.*:${escapeRegex(options.serverName)}`,
        }],
      },
      rateLimited: false,
      senderLocalpart: options.senderLocalpart,
      url: options.url,
    },
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function beeperAppServiceOptions(input: {
  address: string | undefined;
  baseDomain: string | undefined;
  bridge: string;
  homeserver: string;
  homeserverDomain: string;
  token: string;
}): BeeperClientOptions & CreateAppServiceOptions {
  const output: BeeperClientOptions & CreateAppServiceOptions = {
    bridge: input.bridge,
    homeserver: input.homeserver,
    homeserverDomain: input.homeserverDomain,
    token: input.token,
  };
  if (input.address !== undefined) output.address = input.address;
  if (input.baseDomain !== undefined) output.baseDomain = input.baseDomain;
  return output;
}
