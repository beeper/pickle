import assert from "node:assert/strict";
import test from "node:test";
import { sdkDist } from "../src/config.mjs";
import { loadAccounts } from "../src/accounts.mjs";
import { MatrixREST } from "../src/matrix-rest.mjs";
import { closeAll, eventually, makeCore, messageEvent, sync, syncUntil } from "../src/harness.mjs";

const { Chat } = await import(sdkDist("packages/chat-adapter/node_modules/chat/dist/index.js"));
const { createMatrixAdapter } = await import(sdkDist("packages/chat-adapter/dist/index.js"));

function memoryState() {
  const values = new Map();
  const locks = new Map();
  const subscriptions = new Set();
  return {
    async acquireLock(threadId, ttlMs) {
      const existing = locks.get(threadId);
      if (existing?.expiresAt > Date.now()) {
        return null;
      }
      const lock = { expiresAt: Date.now() + ttlMs, threadId, token: String(Math.random()) };
      locks.set(threadId, lock);
      return lock;
    },
    async connect() {},
    async delete() {},
    async disconnect() {},
    async get() {
      return values.get(arguments[0]);
    },
    async isSubscribed(threadId) {
      return subscriptions.has(threadId);
    },
    async list() {
      return [];
    },
    async releaseLock(lock) {
      if (locks.get(lock.threadId)?.token === lock.token) {
        locks.delete(lock.threadId);
      }
    },
    async subscribe(threadId) {
      subscriptions.add(threadId);
    },
    async set(key, value) {
      values.set(key, value);
    },
    async setIfNotExists(key, value) {
      if (values.has(key)) {
        return false;
      }
      values.set(key, value);
      return true;
    },
    async unsubscribe(threadId) {
      subscriptions.delete(threadId);
    },
  };
}

async function* textStream(chunks) {
  for (const chunk of chunks) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    yield chunk;
  }
}

async function deliverSync(adapter, account) {
  return adapter.handleWebhook(
    new Request("https://example.invalid/matrix", {
      body: JSON.stringify({ response: await new MatrixREST(account).sync({ timeout: 0 }) }),
      method: "POST",
    })
  );
}

test("chat adapter: Chat SDK posting, streaming fallback, webhook sync, slash dispatch, metadata", async () => {
  const [botAccount, peerAccount, thirdAccount] = await loadAccounts(3);
  const bot = await makeCore(botAccount, "adapter-bot");
  const peer = await makeCore(peerAccount, "adapter-peer");
  const third = await makeCore(thirdAccount, "adapter-third");
  const peerRest = new MatrixREST(peerAccount);
  const thirdRest = new MatrixREST(thirdAccount);
  let slash;

  const adapter = createMatrixAdapter({
    commandPrefix: "/",
    client: bot.core,
    homeserver: bot.account.homeserverUrl,
    inviteAutoJoin: { inviterAllowlist: [peer.userId] },
    recoveryKey: bot.account.recoveryKey,
    sync: { enabled: false },
    token: bot.account.accessToken,
    userName: "matrix-e2e-bot",
  });
  const chat = new Chat({
    adapters: { matrix: adapter },
    fallbackStreamingPlaceholderText: "...",
    state: memoryState(),
    streamingUpdateIntervalMs: 50,
    userName: "matrix-e2e-bot",
  });
  chat.onSlashCommand("/status", async (event) => {
    slash = event;
  });

  try {
    await chat.initialize();

    const allowedInvite = await peerRest.createRoom({
      invite: [bot.userId],
      name: `adapter allowed invite ${Date.now()}`,
    });
    await deliverSync(adapter, bot.account);
    await eventually("adapter auto-joins allowed invite", async () => {
      await deliverSync(adapter, bot.account);
      const joined = await bot.core.fetchJoinedRooms();
      return joined.roomIds.includes(allowedInvite.room_id);
    });

    const deniedInvite = await thirdRest.createRoom({
      invite: [bot.userId],
      name: `adapter denied invite ${Date.now()}`,
    });
    await deliverSync(adapter, bot.account);
    const joinedAfterDenied = await bot.core.fetchJoinedRooms();
    assert.equal(joinedAfterDenied.roomIds.includes(deniedInvite.room_id), false);

    const threadId = await adapter.openDM(peer.userId);
    const roomId = adapter.decodeThreadId(threadId).roomId;
    await peer.core.joinRoom({ roomIdOrAlias: roomId });
    await Promise.all([sync(bot, 8), sync(peer, 8)]);

    const channelInfo = await adapter.fetchChannelInfo(adapter.channelIdFromThreadId(threadId));
    assert.equal(channelInfo.metadata.encrypted, true);
    assert.equal(channelInfo.isDM, true);

    const user = await adapter.getUser(peer.userId);
    assert.equal(user.userId, peer.userId);

    const posted = await adapter.postMessage(threadId, {
      attachments: [
        {
          data: Buffer.from("adapter attachment", "utf8"),
          mimeType: "text/plain",
          name: "adapter.txt",
          type: "file",
        },
      ],
      markdown: `hello <@(${peer.userId})>`,
    });
    assert.ok(posted.id);
    await syncUntil("peer receives adapter message", peer, (events) =>
      messageEvent(events, roomId, (event) => event.eventId === posted.id)
    );

    const thread = chat.createThread(adapter, threadId, undefined, false);
    const streamed = await thread.post(textStream(["stream ", "**from** ", "chat sdk"]));
    assert.ok(streamed.id);
    const streamedSeen = await syncUntil("peer receives streamed final edit", peer, (events) =>
      messageEvent(
        events,
        roomId,
        (event) => event.eventId === streamed.id && event.body.replaceAll("**", "").includes("stream from chat sdk")
      )
    );
    assert.equal(streamedSeen.isEdited, true);

    const fetched = await adapter.fetchMessage(threadId, streamed.id);
    assert.equal(fetched?.text.replaceAll("**", ""), "stream from chat sdk");
    assert.equal(fetched?.metadata.edited, true);
    const history = await adapter.fetchMessages(threadId, { limit: 20 });
    assert.ok(history.messages.some((message) => message.id === posted.id));

    await adapter.startTyping(threadId, "thinking");
    await adapter.addReaction(threadId, posted.id, "✅");
    await adapter.removeReaction(threadId, posted.id, "✅");
    const edited = await adapter.editMessage(threadId, posted.id, "edited through adapter");
    assert.equal(edited.id, posted.id);

    const syncPayload = await new MatrixREST(bot.account).sync({ timeout: 0 });
    const webhookResponse = await adapter.handleWebhook(
      new Request("https://example.invalid/matrix", {
        body: JSON.stringify({ response: syncPayload }),
        method: "POST",
      })
    );
    assert.equal(webhookResponse.status, 200);

    const command = await peer.core.postMessage({ body: "/status verbose", roomId });
    await syncUntil("bot receives slash command", bot, (events) =>
      messageEvent(events, roomId, (event) => event.eventId === command.eventId)
    );
    await adapter.handleWebhook(
      new Request("https://example.invalid/matrix", {
        body: JSON.stringify({ response: await new MatrixREST(bot.account).sync({ timeout: 0 }) }),
        method: "POST",
      })
    );
    assert.equal(slash?.command, "/status");
    assert.equal(slash?.text, "verbose");
  } finally {
    await chat.shutdown();
    await adapter.disconnect();
    await closeAll(bot, peer, third);
  }
});
