#!/usr/bin/env node
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMatrixLogin } from "@beeper/pickle/login";
import { createMatrixClient, onInvite, onMessage, onReaction } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import { nanoid } from "nanoid";
import { env, loadEnvFile } from "./env";
import { helpText, parseCommand } from "./parser";
import { JsonState } from "./state";
import { streamCommand } from "./stream";

interface Session {
  accessToken: string;
  deviceId: string;
  homeserver?: string;
  userId: string;
  username?: string;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await loadEnvFile(env("MATRIX_ENV_FILE", join(root, ".env")));

const homeserver = env("MATRIX_HOMESERVER_URL", env("MATRIX_HOMESERVER"));
if (!homeserver) throw new Error("Missing MATRIX_HOMESERVER_URL");

const stateDir = env("MATRIX_STATE_DIR", join(root, ".matrix-state")) as string;
const state = new JsonState(join(stateDir, "state.json"));
const session = await resolveSession(homeserver, state);

const client = createMatrixClient({
  account: {
    accessToken: session.accessToken,
    deviceId: session.deviceId,
    homeserver,
    userId: session.userId,
  },
  store: createFileMatrixStore(join(stateDir, "matrix")),
  verifyRecoveryOnStart: env("MATRIX_VERIFY_RECOVERY_ON_START") === "1",
  ...(env("MATRIX_BEEPER_STREAMS", "auto") === "1" ? { beeper: true } : {}),
  ...(env("MATRIX_RECOVERY_KEY") ? { recoveryKey: env("MATRIX_RECOVERY_KEY") as string } : {}),
});

const whoami = await client.boot();
const crypto = await client.crypto.status();
const allowedUserIds = parseList(env("MATRIX_ALLOWED_USER_IDS", ""));
console.log(`bot_user_id=${whoami.userId}`);
console.log(`bot_device_id=${whoami.deviceId}`);
console.log(`crypto_state=${crypto.state}`);
if (allowedUserIds.size) console.log(`allowed_user_ids=${Array.from(allowedUserIds).join(",")}`);

const inFlight = new Set<string>();
const inviteSub = await onInvite(client, undefined, async (invite) => {
  console.log(`invite room=${invite.roomId} inviter=${invite.inviter ?? ""}`);
  if (!isAllowed(invite.inviter, allowedUserIds)) {
    console.log(`invite_ignored room=${invite.roomId} inviter=${invite.inviter ?? ""}`);
    return;
  }
  await client.rooms.join({ roomIdOrAlias: invite.roomId }).catch((error: unknown) => console.error(`join_failed room=${invite.roomId}`, error));
  await client.messages.send({ roomId: invite.roomId, text: ["DummyBridge bot joined.", "", helpText()].join("\n") }).catch((error: unknown) => console.error(`welcome_failed room=${invite.roomId}`, error));
});

const messageSub = await onMessage(client, undefined, async (message) => {
  if (message.sender.isMe || !message.text.trim()) return;
  if (!isAllowed(message.sender.userId, allowedUserIds)) {
    console.log(`message_ignored room=${message.roomId} sender=${message.sender.userId} id=${message.eventId}`);
    return;
  }
  if (inFlight.has(message.eventId)) return;
  inFlight.add(message.eventId);
  try {
    console.log(`message room=${message.roomId} sender=${message.sender.userId} id=${message.eventId}`);
    await client.typing.set({ roomId: message.roomId, timeoutMs: 15000, typing: true });
    await client.reactions.send({ eventId: message.eventId, key: "👀", roomId: message.roomId }).catch(() => {});
    const command = parseCommand(message.text);
    if (!command || command.name === "help") {
      await client.messages.send(withThreadRoot({ roomId: message.roomId, text: helpText() }, message.eventId));
      return;
    }
    const sent = await client.streams.send({
      mode: streamMode(),
      roomId: message.roomId,
      stream: streamCommand(command),
      text: "DummyBridge is thinking...",
      updateIntervalMs: Number(env("MATRIX_STREAM_UPDATE_MS", "500")),
      ...threadRootOption(message.eventId),
    });
    await debugSentEvent(message.roomId, sent);
    await client.reactions.send({ eventId: message.eventId, key: "✅", roomId: message.roomId }).catch(() => {});
    await state.appendToList("dummybridge-bot:handled", {
      at: new Date().toISOString(),
      inputEventId: message.eventId,
      outputEventId: sent.eventId,
      outputEventIds: [sent.eventId],
      roomId: message.roomId,
      runId: nanoid(),
      sender: message.sender.userId,
    }, { maxLength: 200 });
  } catch (error) {
    console.error(`message_failed id=${message.eventId}`, error);
    await client.messages.send(withThreadRoot({
      roomId: message.roomId,
      text: `DummyBridge error: ${error instanceof Error ? error.message : String(error)}\n\n${helpText()}`,
    }, message.eventId)).catch(() => {});
  } finally {
    await client.typing.set({ roomId: message.roomId, timeoutMs: 0, typing: false }).catch(() => {});
    inFlight.delete(message.eventId);
  }
});

const reactionSub = await onReaction(client, undefined, async (reaction) => {
  if (reaction.sender.isMe) return;
  console.log(`reaction room=${reaction.roomId} sender=${reaction.sender.userId} key=${reaction.key} target=${reaction.relatesTo}`);
});

if (env("MATRIX_CATCH_UP_ON_START") === "1") {
  await inviteSub.catchUp?.();
  await messageSub.catchUp?.();
}

console.log("dummybridge_bot=ready; invite this account to any room");

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

async function shutdown(): Promise<void> {
  console.log("dummybridge_bot=stopping");
  await Promise.allSettled([inviteSub.stop(), messageSub.stop(), reactionSub.stop()]);
  await Promise.allSettled([inviteSub.done, messageSub.done, reactionSub.done]);
  await client.close();
  process.exit(0);
}

async function resolveSession(homeserverUrl: string, fileState: JsonState): Promise<Session> {
  if (process.env.MATRIX_ACCESS_TOKEN) {
    const userId = process.env.MATRIX_USER_ID;
    const deviceId = process.env.MATRIX_DEVICE_ID;
    if (userId && deviceId) return { accessToken: process.env.MATRIX_ACCESS_TOKEN, deviceId, userId };
    const accountClient = createMatrixClient({ homeserver: homeserverUrl, store: createFileMatrixStore(join(stateDir, "whoami")), token: process.env.MATRIX_ACCESS_TOKEN });
    const account = await accountClient.whoami();
    await accountClient.close();
    return { accessToken: process.env.MATRIX_ACCESS_TOKEN, deviceId: account.deviceId, userId: account.userId };
  }
  if (!process.env.MATRIX_USERNAME || !process.env.MATRIX_PASSWORD) throw new Error("Missing MATRIX_ACCESS_TOKEN or MATRIX_USERNAME/MATRIX_PASSWORD");
  const cacheKey = "dummybridge-bot:login-session";
  const cached = await fileState.get<Session & { homeserver?: string; username?: string }>(cacheKey);
  if (cached?.homeserver === homeserverUrl && cached.username === process.env.MATRIX_USERNAME) return cached;
  const login = await createMatrixLogin({ homeserver: homeserverUrl, initialDeviceDisplayName: "pickle dummybridge bot" }).password({
    password: process.env.MATRIX_PASSWORD,
    username: process.env.MATRIX_USERNAME,
  });
  const sessionValue = { ...login, homeserver: homeserverUrl, username: process.env.MATRIX_USERNAME };
  await fileState.set(cacheKey, sessionValue);
  return sessionValue;
}

function threadRoot(eventId: string): string | undefined {
  return env("MATRIX_REPLY_IN_THREADS", "1") === "1" ? eventId : undefined;
}

function threadRootOption(eventId: string): { threadRoot: string } | Record<string, never> {
  const root = threadRoot(eventId);
  return root ? { threadRoot: root } : {};
}

function withThreadRoot<T extends Record<string, unknown>>(options: T, eventId: string): T & ({ threadRoot: string } | Record<string, never>) {
  return { ...options, ...threadRootOption(eventId) };
}

function streamMode(): "auto" | "beeper" | "edits" {
  const value = env("MATRIX_STREAM_MODE", "auto");
  return value === "beeper" || value === "edits" ? value : "auto";
}

function isAllowed(userId: string | undefined, allowedUserIds: Set<string>): boolean {
  return !allowedUserIds.size || Boolean(userId && allowedUserIds.has(userId));
}

function parseList(value: string | undefined): Set<string> {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

async function debugSentEvent(roomId: string, sent: { eventId: string }): Promise<void> {
  if (env("MATRIX_DEBUG_SENT_EVENTS", "0") !== "1") return;
  const fetched = await client.messages.get({ eventId: sent.eventId, roomId }).catch((error: unknown) => {
    console.error(`debug_fetch_failed output=${sent.eventId}`, error);
    return null;
  });
  const content = fetched?.message?.content;
  const aiValue = content?.["com.beeper.ai"] as Record<string, unknown> | undefined;
  console.log("debug_sent_event", JSON.stringify({
    eventId: sent.eventId,
    hasAI: Boolean(aiValue),
    aiRole: aiValue?.role,
    aiType: Array.isArray(aiValue) ? "array" : typeof aiValue,
    aiValue,
    aiPartsType: Array.isArray(aiValue?.parts) ? "array" : typeof aiValue?.parts,
    contentKeys: content ? Object.keys(content).sort() : [],
    msgtype: content?.msgtype,
  }));
}
