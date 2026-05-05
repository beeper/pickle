import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMatrixLogin } from "@beeper/pickle/login";
import { createMatrixClient, onInvite, onMessage, onReaction } from "@beeper/pickle/node";
import { createFileMatrixStore } from "@beeper/pickle-state-file";
import { FileState } from "../../shared/file-state.mjs";
import { dummybridgeChaosTurnStream, dummybridgeTextStream, helpText, parseCommand } from "./dummy-runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await loadEnvFile(process.env.MATRIX_ENV_FILE || join(root, ".env"));

const homeserver = env("MATRIX_HOMESERVER_URL", env("MATRIX_HOMESERVER"));
if (!homeserver) throw new Error("Missing MATRIX_HOMESERVER_URL");

const stateDir = env("MATRIX_STATE_DIR", join(root, ".matrix-state"));
const state = new FileState(join(stateDir, "state.json"));
await state.connect();
const session = await resolveSession(homeserver, state);

const client = createMatrixClient({
  account: {
    accessToken: session.accessToken,
    deviceId: session.deviceId,
    homeserver,
    userId: session.userId,
  },
  beeper: env("MATRIX_BEEPER_STREAMS", "auto") === "1" ? true : undefined,
  recoveryKey: env("MATRIX_RECOVERY_KEY"),
  store: createFileMatrixStore(join(stateDir, "matrix")),
  verifyRecoveryOnStart: env("MATRIX_VERIFY_RECOVERY_ON_START") === "1",
});

const whoami = await client.boot();
const crypto = await client.crypto.status();
const allowedUserIds = parseList(env("MATRIX_ALLOWED_USER_IDS", ""));
console.log(`bot_user_id=${whoami.userId}`);
console.log(`bot_device_id=${whoami.deviceId}`);
console.log(`crypto_state=${crypto.state}`);
if (allowedUserIds.size) {
  console.log(`allowed_user_ids=${Array.from(allowedUserIds).join(",")}`);
}

const inFlight = new Set();
const inviteSub = await onInvite(client, undefined, async (invite) => {
  console.log(`invite room=${invite.roomId} inviter=${invite.inviter ?? ""}`);
  if (!isAllowed(invite.inviter, allowedUserIds)) {
    console.log(`invite_ignored room=${invite.roomId} inviter=${invite.inviter ?? ""}`);
    return;
  }
  await client.rooms.join({ roomIdOrAlias: invite.roomId }).catch((error) => {
    console.error(`join_failed room=${invite.roomId}`, error);
  });
  await client.messages.send({
    roomId: invite.roomId,
    text: [
      "DummyBridge bot joined.",
      "",
      helpText(),
    ].join("\n"),
  }).catch((error) => console.error(`welcome_failed room=${invite.roomId}`, error));
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
    const streamOptions = {
      mode: env("MATRIX_STREAM_MODE", "auto"),
      roomId: message.roomId,
      text: "DummyBridge is thinking...",
      threadRoot: env("MATRIX_REPLY_IN_THREADS", "1") === "1" ? message.eventId : undefined,
      updateIntervalMs: Number(env("MATRIX_STREAM_UPDATE_MS", "500")),
    };
    const sentEvents = [];
    if (command.name === "chaos") {
      for (let turn = 0; turn < command.turns; turn += 1) {
        if (turn > 0) await sleep(sampleInt(command.seed + turn, command.staggerMinMs, command.staggerMaxMs));
        const sent = await client.streams.send({
          ...streamOptions,
          stream: dummybridgeChaosTurnStream(message.text, turn),
        });
        sentEvents.push(sent.eventId);
        await debugSentEvent(client, message.roomId, sent);
      }
    } else {
      const sent = await client.streams.send({
        ...streamOptions,
        stream: dummybridgeTextStream(message.text),
      });
      sentEvents.push(sent.eventId);
      await debugSentEvent(client, message.roomId, sent);
    }
    await client.reactions.send({ eventId: message.eventId, key: "✅", roomId: message.roomId }).catch(() => {});
    await state.appendToList("dummybridge-bot:handled", {
      at: new Date().toISOString(),
      inputEventId: message.eventId,
      outputEventId: sentEvents[0],
      outputEventIds: sentEvents,
      roomId: message.roomId,
      sender: message.sender.userId,
    }, { maxLength: 200 });
  } catch (error) {
    console.error(`message_failed id=${message.eventId}`, error);
    await client.messages.send({
      roomId: message.roomId,
      text: `DummyBridge error: ${error?.message ?? String(error)}`,
      threadRoot: env("MATRIX_REPLY_IN_THREADS", "1") === "1" ? message.eventId : undefined,
    }).catch(() => {});
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

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

async function shutdown() {
  console.log("dummybridge_bot=stopping");
  await Promise.allSettled([inviteSub.stop(), messageSub.stop(), reactionSub.stop()]);
  await Promise.allSettled([inviteSub.done, messageSub.done, reactionSub.done]);
  await client.close();
  await state.disconnect();
  process.exit(0);
}

async function resolveSession(homeserverUrl, fileState) {
  if (process.env.MATRIX_ACCESS_TOKEN) {
    const userId = process.env.MATRIX_USER_ID;
    const deviceId = process.env.MATRIX_DEVICE_ID;
    if (userId && deviceId) {
      return {
        accessToken: process.env.MATRIX_ACCESS_TOKEN,
        deviceId,
        userId,
      };
    }
    const accountClient = createMatrixClient({
      homeserver: homeserverUrl,
      store: createFileMatrixStore(join(stateDir, "whoami")),
      token: process.env.MATRIX_ACCESS_TOKEN,
    });
    const whoami = await accountClient.whoami();
    await accountClient.close();
    return {
      accessToken: process.env.MATRIX_ACCESS_TOKEN,
      deviceId: whoami.deviceId,
      userId: whoami.userId,
    };
  }
  if (!process.env.MATRIX_USERNAME || !process.env.MATRIX_PASSWORD) {
    throw new Error("Missing MATRIX_ACCESS_TOKEN or MATRIX_USERNAME/MATRIX_PASSWORD");
  }
  const cacheKey = "dummybridge-bot:login-session";
  const cached = await fileState.get(cacheKey);
  if (cached?.homeserver === homeserverUrl && cached.username === process.env.MATRIX_USERNAME) {
    return cached;
  }
  const login = await createMatrixLogin({
    homeserver: homeserverUrl,
    initialDeviceDisplayName: "pickle dummybridge bot",
  }).password({
    password: process.env.MATRIX_PASSWORD,
    username: process.env.MATRIX_USERNAME,
  });
  const session = { ...login, username: process.env.MATRIX_USERNAME };
  await fileState.set(cacheKey, session);
  return session;
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

function isAllowed(userId, allowedUserIds) {
  return !allowedUserIds.size || allowedUserIds.has(userId);
}

function parseList(value) {
  return new Set(String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
}

async function debugSentEvent(matrixClient, roomId, sent) {
  if (env("MATRIX_DEBUG_SENT_EVENTS", "0") !== "1") return;
  const fetched = await matrixClient.messages.get({ eventId: sent.eventId, roomId }).catch((error) => {
    console.error(`debug_fetch_failed output=${sent.eventId}`, error);
    return null;
  });
  const content = fetched?.message?.content;
  const aiValue = content?.["com.beeper.ai"];
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

function sampleInt(seed, min, max) {
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return Math.floor((x - Math.floor(x)) * (high - low + 1)) + low;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function loadEnvFile(path) {
  if (!path) return;
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = parseEnv(raw);
  }
}

function parseEnv(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  const comment = trimmed.search(/\s#/);
  return comment === -1 ? trimmed : trimmed.slice(0, comment).trim();
}
