import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBeeperBridgeFromPassword, createBeeperBridgeFromToken } from "@beeper/pickle-bridge/node";
import type { Portal } from "@beeper/pickle-bridge/types";
import { DummyConnector, LOGIN_ID, PORTAL_ID, makeGhostMxid } from "./connector";
import { loadEnv, optionalEnv, requiredEnv } from "./env";

const root = dirname(fileURLToPath(import.meta.url));
const sourceRoot = root.endsWith("/dist/src") ? resolve(root, "../..") : resolve(root, "..");

await loadEnv(resolve(sourceRoot, ".env"));

const serverName = optionalEnv("MATRIX_SERVER_NAME", "beeper.local") ?? "beeper.local";
const senderLocalpart = optionalEnv("DUMMYBRIDGE_SENDER_LOCALPART", "dummybridgebot") ?? "dummybridgebot";

const bridgeOptions = {
  bridge: optionalEnv("DUMMYBRIDGE_BRIDGE_NAME", "dummybridge") ?? "dummybridge",
  connector: new DummyConnector({ senderLocalpart, serverName }),
  homeserverDomain: serverName,
};
const bridge = process.env.BEEPER_USERNAME && process.env.BEEPER_PASSWORD
  ? await createBeeperBridgeFromPassword({
    ...bridgeOptions,
    password: requiredEnv("BEEPER_PASSWORD"),
    username: requiredEnv("BEEPER_USERNAME"),
  })
  : await createBeeperBridgeFromToken({
    ...bridgeOptions,
    token: requiredEnv("BEEPER_ACCESS_TOKEN"),
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
    process.exit(0);
  });
}
