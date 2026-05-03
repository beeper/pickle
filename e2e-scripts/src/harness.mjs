import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import assert from "node:assert/strict";
import { OUT_DIR, STORE_DIR, ensureOutDirs, sdkDist } from "./config.mjs";

const { createMatrixClient } = await import(sdkDist("packages/core/dist/node.js"));
const { createMatrixLogin } = await import(sdkDist("packages/core/dist/login.js"));
const { createFileMatrixStore } = await import(sdkDist("packages/state-file/dist/index.js"));

export async function makeCore(account, label) {
  await ensureOutDirs();
  const storeDir = join(STORE_DIR, label);
  if (process.env.MATRIX_E2E_RESET_STORES === "1") {
    await rm(storeDir, { force: true, recursive: true });
  }
  const sdkAccount = await accountForLabel(account, label);
  const events = [];
  const core = createCompatCore(sdkAccount, storeDir);
  core.events.on((event) => events.push(toRuntimeEvent(event)));
  const initOptions = {};
  if (account.recoveryKey) {
    initOptions.recoveryKey = account.recoveryKey;
  }
  const whoami = await core.connect(initOptions);
  assert.equal(whoami.userId, account.userId);
  return { account: sdkAccount, core, events, label, storeDir, userId: whoami.userId };
}

async function accountForLabel(account, label) {
  const cached = process.env.MATRIX_E2E_RESET_STORES === "1" ? null : await loadCachedSession(label, account);
  if (cached) {
    return cached;
  }
  if (process.env.MATRIX_E2E_FRESH_DEVICE === "1" && account.loginToken) {
    const fresh = await loginFreshDevice(account, label);
    await saveCachedSession(label, fresh);
    return fresh;
  }
  return account;
}

const SESSIONS_PATH = join(OUT_DIR, "sessions.json");

async function loadCachedSession(label, account) {
  try {
    const data = JSON.parse(await readFile(SESSIONS_PATH, "utf8"));
    const session = data[label];
    if (session?.username === account.username && session?.accessToken && session?.deviceId) {
      return { ...account, ...session };
    }
  } catch {
    // No reusable session yet.
  }
  return null;
}

async function saveCachedSession(label, account) {
  let data = {};
  try {
    data = JSON.parse(await readFile(SESSIONS_PATH, "utf8"));
  } catch {
    // Create below.
  }
  data[label] = {
    accessToken: account.accessToken,
    deviceId: account.deviceId,
    homeserverUrl: account.homeserverUrl,
    recoveryKey: account.recoveryKey,
    userId: account.userId,
    username: account.username,
  };
  await writeFile(SESSIONS_PATH, JSON.stringify(data, null, 2));
}

async function loginFreshDevice(account, label) {
  return retry(`fresh Matrix login ${label}`, async () => {
    const session = await createMatrixLogin({
      homeserver: account.homeserverUrl,
      initialDeviceDisplayName: `better-matrix-js private e2e ${label}`,
    }).token({
      token: account.loginToken,
      type: "org.matrix.login.jwt",
    });
    return {
      ...account,
      accessToken: session.accessToken,
      deviceId: session.deviceId,
      userId: session.userId,
    };
  }, 5, 5000);
}

export async function sync(account, count = 1, timeoutMs = 1000) {
  for (let index = 0; index < count; index += 1) {
    await retry("sync once", () => account.core.sync.once({ timeoutMs }), 3, 1000);
  }
}

export async function closeAll(...accounts) {
  await Promise.allSettled(accounts.map((account) => account?.core?.close()));
}

export async function eventually(label, fn, timeoutMs = 90000, intervalMs = 1000) {
  logProgress(`wait ${label}`);
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) {
        logProgress(`ok ${label}`);
        return value;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

export async function retry(label, fn, attempts = 4, delayMs = 1500) {
  logProgress(`try ${label}`);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await fn();
      logProgress(`ok ${label}`);
      return value;
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransient(error)) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  throw lastError;
}

function logProgress(message) {
  if (process.env.MATRIX_E2E_VERBOSE === "1") {
    console.error(`[e2e ${new Date().toISOString()}] ${message}`);
  }
}

export async function syncUntil(label, account, predicate, timeoutMs = 90000) {
  return eventually(
    label,
    async () => {
      await sync(account, 1, 1000);
      return predicate(account.events);
    },
    timeoutMs
  );
}

export function messageEvent(events, roomId, predicate) {
  return events.find(
    (event) => event.type === "message" && event.event.roomId === roomId && predicate(event.event)
  )?.event;
}

export function reactionEvent(events, roomId, messageId, key, added = true) {
  return events.find(
    (event) =>
      event.type === "reaction" &&
      event.event.roomId === roomId &&
      event.event.relatesToEventId === messageId &&
      event.event.key === key &&
      (event.event.added ?? true) === added
  )?.event;
}

export function cryptoStatus(events, status) {
  if (status === "enabled") {
    return events.find((event) =>
      event.type === "crypto_status" &&
      ["enabled", "recoveryKeyCached", "recoveryKeyLoaded", "recoveryRestored"].includes(event.status)
    );
  }
  return events.find((event) => event.type === "crypto_status" && event.status === status);
}

function isTransient(error) {
  const message = error?.message ?? String(error);
  return /\b(408|425|429|500|502|503|504)\b/.test(message) ||
    /timeout|temporar|ECONNRESET|ETIMEDOUT|failed to query keys/i.test(message);
}

export function createCompatCore(account, storeDir) {
  const client = createMatrixClient({
    homeserver: account.homeserverUrl,
    recoveryKey: account.recoveryKey,
    store: createFileMatrixStore(storeDir),
    token: account.accessToken,
  });
  const listeners = new Set();
  let subscription;
  const compat = Object.create(client);
  const overrides = {
    accountData: client.accountData,
    beeper: client.beeper,
    boot: (...args) => client.boot(...args),
    crypto: client.crypto,
    logout: (...args) => client.logout(...args),
    media: client.media,
    messages: client.messages,
    raw: client.raw,
    reactions: client.reactions,
    receipts: client.receipts,
    rooms: client.rooms,
    streams: client.streams,
    subscribe: (...args) => client.subscribe(...args),
    toDevice: client.toDevice,
    typing: client.typing,
    users: client.users,
    whoami: (...args) => client.whoami(...args),
    close: async () => {
      await subscription?.stop();
      await subscription?.done.catch(() => {});
      subscription = undefined;
    },
    connect: async (options = {}) => {
      await client.boot(options);
      const whoami = await client.whoami();
      const cryptoStatus = await client.crypto.status();
      if (cryptoStatus.state && cryptoStatus.state !== "disabled") {
        for (const listener of listeners) {
          listener({ kind: "crypto", state: cryptoStatus.state });
        }
      }
      subscription ??= await client.subscribe({}, (event) => {
        for (const listener of listeners) {
          listener(event);
        }
      });
      return whoami;
    },
    events: {
      on: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    sync: {
      applyResponse: (...args) => client.sync.applyResponse(...args),
      once: async ({ timeoutMs = 1000 } = {}) => {
        await new Promise((resolve) => setTimeout(resolve, timeoutMs));
      },
    },
    addReaction: ({ emoji, messageId, roomId }) =>
      client.reactions.send({ eventId: messageId, key: emoji, roomId }),
    applySyncResponse: (options) => client.sync.applyResponse(options),
    deleteMessage: ({ messageId, reason: _reason, roomId }) =>
      client.messages.redact({ eventId: messageId, roomId }),
    downloadEncryptedMedia: async ({ file }) => toBytesBase64Result(await client.media.downloadEncrypted({ file })),
    downloadMedia: async ({ contentUri }) => toBytesBase64Result(await client.media.download({ contentUri })),
    editMessage: ({ body, formattedBody, messageId, roomId }) =>
      client.messages.edit({ eventId: messageId, html: formattedBody, roomId, text: body }),
    fetchJoinedRooms: () => client.rooms.listJoined(),
    fetchMessage: async ({ messageId, roomId }) => {
      const result = await client.messages.get({ eventId: messageId, roomId });
      return { message: result.message ? toRuntimeMessage(result.message) : null };
    },
    fetchMessages: async ({ cursor, limit, roomId, threadRootEventId }) => {
      const result = await client.messages.list({ cursor, limit, roomId, threadRoot: threadRootEventId });
      return {
        messages: result.messages.map(toRuntimeMessage),
        nextCursor: result.nextCursor,
      };
    },
    fetchRoom: ({ roomId }) => client.rooms.get({ roomId }),
    createRoom: ({ initialState, invite, isDirect, name, preset, topic, visibility }) =>
      client.rooms.create({ initialState, invite, isDirect, name, preset, topic, visibility }),
    getUser: ({ userId }) => client.users.get({ userId }),
    leaveRoom: ({ reason, roomId }) => client.rooms.leave({ reason, roomId }),
    joinRoom: ({ roomIdOrAlias }) => client.rooms.join({ roomIdOrAlias }),
    listRoomThreads: ({ limit, roomId }) => client.rooms.threads.list({ limit, roomId }),
    markRead: ({ eventId, roomId }) => client.messages.markRead({ eventId, roomId }),
    openDM: ({ userId }) => client.rooms.openDM({ userId }),
    postMediaMessage: ({ bytesBase64, contentType, filename, height, msgtype, roomId, width }) =>
      client.messages.sendMedia({
        bytes: Buffer.from(bytesBase64, "base64"),
        contentType,
        filename,
        height,
        kind: msgtype?.startsWith("m.") ? msgtype.slice(2) : "file",
        roomId,
        width,
      }),
    postMessage: ({ body, formattedBody, mentions, roomId, threadRootEventId }) =>
      client.messages.send({ html: formattedBody, mentions, roomId, text: body, threadRoot: threadRootEventId }),
    removeReaction: ({ emoji, messageId, roomId }) =>
      client.reactions.redact({ eventId: messageId, key: emoji, roomId }),
    setTyping: ({ roomId, timeoutMs, typing }) => client.typing.set({ roomId, timeoutMs, typing }),
  };
  return Object.defineProperties(
    compat,
    Object.fromEntries(Object.entries(overrides).map(([key, value]) => [
      key,
      { configurable: true, enumerable: true, value, writable: true },
    ]))
  );
}

function toBytesBase64Result(result) {
  return {
    ...result,
    bytesBase64: Buffer.from(result.bytes).toString("base64"),
  };
}

export function toRuntimeEvent(event) {
  if (event.kind === "message") {
    return { event: toRuntimeMessage(event), type: "message" };
  }
  if (event.kind === "reaction") {
    return {
      event: {
        ...event,
        relatesToEventId: event.relatesTo,
      },
      type: "reaction",
    };
  }
  if (event.kind === "crypto") {
    return { status: event.state, type: "crypto_status" };
  }
  if (event.kind === "sync") {
    return { status: event.state, type: "sync_status" };
  }
  return event;
}

function toRuntimeMessage(message) {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({
      contentUri: attachment.contentUri,
      encryptedFile: attachment.encryptedFile,
      filename: attachment.filename,
      info: {
        contentType: attachment.contentType,
        duration: attachment.duration,
        height: attachment.height,
        size: attachment.size,
        width: attachment.width,
      },
      msgtype: `m.${attachment.kind}`,
    })) ?? [],
    body: message.text,
    formattedBody: message.html,
    isEdited: message.edited,
    isEncrypted: message.encrypted,
    msgtype: message.messageType,
    threadRootEventId: message.threadRoot,
  };
}
