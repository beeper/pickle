import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loginWithPassword } from "@beeper/pickle/auth";
import { createBeeperBridge } from "@beeper/pickle-bridge/node";
import type { CreateNodeBeeperBridgeOptions, Portal } from "@beeper/pickle-bridge/types";
import { DUMMY_CHAT_IDS, DummyConnector, LOGIN_ID, PORTAL_ID } from "./connector";
import { loadEnv, optionalEnv, requiredEnv } from "./env";

const root = dirname(fileURLToPath(import.meta.url));
const sourceRoot = root.endsWith("/dist/src") ? resolve(root, "../..") : resolve(root, "..");

await loadEnv(resolve(sourceRoot, ".env"));

const account = await loginWithPassword({
  password: requiredEnv("BEEPER_PASSWORD"),
  username: requiredEnv("BEEPER_USERNAME"),
});
const bridgeName = optionalEnv("DUMMYBRIDGE_BRIDGE_NAME", "sh-dummybridge2") ?? "sh-dummybridge";

const bridgeOptions: CreateNodeBeeperBridgeOptions = {
  account,
  bridge: bridgeName,
  bridgeType: "dummybridge-js",
  connector: new DummyConnector(),
};
const baseDomain = optionalEnv("BEEPER_BASE_DOMAIN");
if (baseDomain !== undefined) bridgeOptions.baseDomain = baseDomain;
const bridgeAddress = optionalEnv("DUMMYBRIDGE_URL");
if (bridgeAddress !== undefined) bridgeOptions.address = bridgeAddress;
const bridge = await createBeeperBridge(bridgeOptions);

await bridge.start();
const login = {
  id: LOGIN_ID,
  remoteName: "Dummy Account",
  userId: account.userId,
};
await bridge.loadUserLogin(login);

const existingManagementRoomId = optionalEnv("DUMMYBRIDGE_MANAGEMENT_ROOM_ID");
if (existingManagementRoomId) {
  bridge.registerManagementRoom({ mxid: existingManagementRoomId });
  console.log(`registered existing management room ${existingManagementRoomId}`);
} else if (optionalEnv("DUMMYBRIDGE_CREATE_MANAGEMENT_ROOM") === "1") {
  const inviteUser = optionalEnv("DUMMYBRIDGE_INVITE_USER");
  const room = await bridge.createManagementRoom({
    invite: inviteUser ? [inviteUser] : [],
    name: "Pickle DummyBridge Commands",
    topic: "Send dummy help for commands.",
  });
  console.log(`created management room ${room.mxid}`);
}

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
  portal = await bridge.createPortal(login, {
    id: PORTAL_ID,
    invite: inviteUser ? [inviteUser] : [],
    name: "Pickle DummyBridge",
    sender: "alice",
    topic: "A TypeScript bridge built with Pickle.",
  });
  console.log(`created portal ${portal.mxid}`);
}

if (portal?.mxid && optionalEnv("DUMMYBRIDGE_BACKFILL_ON_START") === "1") {
  await bridge.backfillPortal(login, portal);
  console.log(`backfilled ${portal.mxid}`);
}

if (optionalEnv("DUMMYBRIDGE_CREATE_DUMMY_CHATS", "1") === "1") {
  const count = Math.max(1, Math.min(Number(optionalEnv("DUMMYBRIDGE_DUMMY_CHAT_COUNT", "2")) || 2, DUMMY_CHAT_IDS.length));
  for (const portalId of DUMMY_CHAT_IDS.slice(0, count)) {
    try {
      const room = await bridge.createPortal(login, {
        id: portalId,
        invite: [account.userId],
        name: `Pickle ${titleCase(portalId)}`,
        sender: "alice",
        topic: "A dummy chat created by the TypeScript Pickle bridge.",
      });
      await bridge.backfillPortal(login, room);
      console.log(`created and backfilled dummy chat ${room.mxid}`);
    } catch (error) {
      console.error(`failed to create/backfill dummy chat ${portalId}`, error);
    }
  }
}

console.log("dummybridge running");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await bridge.stop();
    process.exit(0);
  });
}

function titleCase(value: string): string {
  return value.replace(/^dummy-chat-/, "").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
