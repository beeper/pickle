import assert from "node:assert/strict";
import test from "node:test";
import { loadAccounts } from "../src/accounts.mjs";
import {
  closeAll,
  createCompatCore,
  cryptoStatus,
  makeCore,
  messageEvent,
  retry,
  sync,
  syncUntil,
  toRuntimeEvent,
} from "../src/harness.mjs";

async function openCoreFromStore(account, storeDir) {
  const events = [];
  const core = createCompatCore(account, storeDir);
  core.events.on((event) => events.push(toRuntimeEvent(event)));
  const initOptions = {};
  if (account.recoveryKey) {
    initOptions.recoveryKey = account.recoveryKey;
  }
  const whoami = await core.connect(initOptions);
  assert.equal(whoami.userId, account.userId);
  return { account, core, events, storeDir, userId: whoami.userId };
}

test("core: encrypted DM survives FileMatrixStore restart", async () => {
  const [botAccount, peerAccount] = await loadAccounts(2);
  let bot = await makeCore(botAccount, "restart-bot");
  const peer = await makeCore(peerAccount, "restart-peer");

  try {
    assert.ok(cryptoStatus(bot.events, "enabled"), "bot crypto should initialize");
    assert.ok(cryptoStatus(peer.events, "enabled"), "peer crypto should initialize");

    await Promise.all([sync(bot, 2), sync(peer, 2)]);

    const dm = await bot.core.openDM({ userId: peer.userId });
    await peer.core.joinRoom({ roomIdOrAlias: dm.roomId });
    await Promise.all([sync(bot, 8), sync(peer, 8)]);

    const firstBody = `before restart ${Date.now()}`;
    const firstSent = await retry("send encrypted message before restart", () =>
      peer.core.postMessage({ body: firstBody, roomId: dm.roomId })
    );
    const firstSeen = await syncUntil("bot decrypts message before restart", bot, (events) =>
      messageEvent(events, dm.roomId, (event) => event.eventId === firstSent.eventId)
    );
    assert.equal(firstSeen.body, firstBody);
    assert.equal(firstSeen.isEncrypted, true);

    const persistedStoreDir = bot.storeDir;
    const persistedAccount = bot.account;
    await closeAll(bot);
    bot = await openCoreFromStore(persistedAccount, persistedStoreDir);
    assert.ok(cryptoStatus(bot.events, "enabled"), "bot crypto should reinitialize after restart");

    await Promise.all([sync(bot, 4), sync(peer, 2)]);

    const fetchedFirst = await bot.core.fetchMessage({
      messageId: firstSent.eventId,
      roomId: dm.roomId,
    });
    assert.equal(fetchedFirst.message.body, firstBody);
    assert.equal(fetchedFirst.message.isEncrypted, true);

    const secondBody = `after restart ${Date.now()}`;
    const secondSent = await retry("send encrypted message after restart", () =>
      bot.core.postMessage({ body: secondBody, roomId: dm.roomId })
    );
    const secondSeen = await syncUntil("peer decrypts message after restart", peer, (events) =>
      messageEvent(events, dm.roomId, (event) => event.eventId === secondSent.eventId)
    );
    assert.equal(secondSeen.body, secondBody);
    assert.equal(secondSeen.isEncrypted, true);

    const fetchedHistory = await bot.core.fetchMessages({ limit: 10, roomId: dm.roomId });
    assert.ok(fetchedHistory.messages.some((message) => message.eventId === firstSent.eventId));
    assert.ok(fetchedHistory.messages.some((message) => message.eventId === secondSent.eventId));
  } finally {
    await closeAll(bot, peer);
  }
});
