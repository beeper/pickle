import assert from "node:assert/strict";
import test from "node:test";
import { loadAccounts } from "../src/accounts.mjs";
import { MatrixREST } from "../src/matrix-rest.mjs";
import {
  closeAll,
  cryptoStatus,
  makeCore,
  messageEvent,
  reactionEvent,
  retry,
  sync,
  syncUntil,
} from "../src/harness.mjs";

test("core: encrypted rooms, messages, edits, reactions, media, history, webhook sync ingestion", async () => {
  const [botAccount, peerAccount, thirdAccount, lateAccount] = await loadAccounts(4);
  const bot = await makeCore(botAccount, "core-bot");
  const peer = await makeCore(peerAccount, "core-peer");
  const third = await makeCore(thirdAccount, "core-third");
  const late = await makeCore(lateAccount, "core-late");
  const botRest = new MatrixREST(botAccount);
  const peerRest = new MatrixREST(peerAccount);
  const thirdRest = new MatrixREST(thirdAccount);
  const lateRest = new MatrixREST(lateAccount);

  try {
    assert.ok(cryptoStatus(bot.events, "enabled"), "bot crypto should initialize");
    assert.ok(cryptoStatus(peer.events, "enabled"), "peer crypto should initialize");
    assert.ok(cryptoStatus(late.events, "enabled"), "late member crypto should initialize");

    await Promise.all([sync(bot, 2), sync(peer, 2), sync(third, 2), sync(late, 2)]);

    const profile = await bot.core.getUser({ userId: peer.userId });
    assert.equal(profile.userId, peer.userId);

    const dm = await bot.core.openDM({ userId: peer.userId });
    await peer.core.joinRoom({ roomIdOrAlias: dm.roomId });
    await Promise.all([sync(bot, 8), sync(peer, 8)]);

    const dmInfo = await bot.core.fetchRoom({ roomId: dm.roomId });
    assert.equal(dmInfo.encrypted, true);
    assert.equal(dmInfo.isDM, true);

    const group = await bot.core.createRoom({
      initialState: [{
        content: { algorithm: "m.megolm.v1.aes-sha2" },
        stateKey: "",
        type: "m.room.encryption",
      }],
      invite: [peer.userId, third.userId],
      name: `better-matrix-js e2e ${Date.now()}`,
      preset: "private_chat",
      topic: "private automated SDK coverage",
    });
    await Promise.all([
      peer.core.joinRoom({ roomIdOrAlias: group.roomId }),
      third.core.joinRoom({ roomIdOrAlias: group.roomId }),
    ]);
    await Promise.all([sync(bot, 8), sync(peer, 8), sync(third, 8)]);

    const groupInfo = await bot.core.fetchRoom({ roomId: group.roomId });
    assert.equal(groupInfo.encrypted, true);
    assert.notEqual(groupInfo.isDM, true);
    assert.ok(groupInfo.memberCount >= 3);

    const plainRoom = await botRest.createRoom({
      invite: [peer.userId],
      name: `better-matrix-js plain ${Date.now()}`,
      topic: "unencrypted SDK coverage",
    });
    await peer.core.joinRoom({ roomIdOrAlias: plainRoom.room_id });
    await Promise.all([sync(bot, 4), sync(peer, 4)]);
    const plainInfo = await bot.core.fetchRoom({ roomId: plainRoom.room_id });
    assert.equal(plainInfo.encrypted, false);
    const plainBody = `unencrypted ${Date.now()}`;
    const plainSent = await retry("send unencrypted message", () =>
      bot.core.postMessage({ body: plainBody, roomId: plainRoom.room_id })
    );
    const plainSeen = await syncUntil("peer receives unencrypted message", peer, (events) =>
      messageEvent(events, plainRoom.room_id, (event) => event.eventId === plainSent.eventId)
    );
    assert.equal(plainSeen.body, plainBody);
    assert.notEqual(plainSeen.isEncrypted, true);
    const imagePayload = Buffer.from("fake png payload", "utf8");
    const plainImage = await retry("send unencrypted image media", () => bot.core.postMediaMessage({
      bytesBase64: imagePayload.toString("base64"),
      contentType: "image/png",
      filename: "matrix-e2e.png",
      height: 12,
      msgtype: "m.image",
      roomId: plainRoom.room_id,
      width: 16,
    }));
    const plainImageSeen = await syncUntil("peer receives unencrypted media", peer, (events) =>
      messageEvent(events, plainRoom.room_id, (event) => event.eventId === plainImage.eventId)
    );
    const plainAttachment = plainImageSeen.attachments?.[0];
    assert.equal(plainAttachment?.contentUri?.startsWith("mxc://"), true);
    assert.equal(plainAttachment?.encryptedFile, undefined);
    assert.equal(plainAttachment?.info?.contentType, "image/png");
    assert.equal(plainAttachment?.info?.height, 12);
    assert.equal(plainAttachment?.info?.width, 16);
    const plainDownloaded = await peer.core.downloadMedia({ contentUri: plainAttachment.contentUri });
    assert.equal(Buffer.from(plainDownloaded.bytesBase64, "base64").toString("utf8"), imagePayload.toString("utf8"));

    const historyPrefix = `history ${Date.now()}`;
    const historySent = [];
    for (let index = 0; index < 18; index += 1) {
      historySent.push(await retry(`send group history ${index}`, () =>
        bot.core.postMessage({ body: `${historyPrefix} ${String(index).padStart(2, "0")}`, roomId: group.roomId })
      ));
    }
    await syncUntil("peer receives latest group history message", peer, (events) =>
      messageEvent(events, group.roomId, (event) => event.eventId === historySent.at(-1).eventId)
    );
    const historyPage1 = await peer.core.fetchMessages({ limit: 8, roomId: group.roomId });
    assert.equal(historyPage1.messages.length, 8);
    const historyPage2 = await peer.core.fetchMessages({
      cursor: historyPage1.nextCursor,
      limit: 8,
      roomId: group.roomId,
    });
    assert.equal(historyPage2.messages.length, 8);
    const pagedHistoryIds = new Set([...historyPage1.messages, ...historyPage2.messages].map((message) => message.eventId));
    assert.equal(pagedHistoryIds.size, 16);
    assert.ok([...historyPage1.messages, ...historyPage2.messages].some((message) => message.body.startsWith(historyPrefix)));

    const lateRoom = await bot.core.createRoom({
      initialState: [
        {
          content: { algorithm: "m.megolm.v1.aes-sha2" },
          stateKey: "",
          type: "m.room.encryption",
        },
        {
          content: { history_visibility: "shared" },
          stateKey: "",
          type: "m.room.history_visibility",
        },
      ],
      invite: [peer.userId],
      name: `better-matrix-js late join ${Date.now()}`,
      preset: "private_chat",
      topic: "late membership coverage",
    });
    await peer.core.joinRoom({ roomIdOrAlias: lateRoom.roomId });
    await Promise.all([sync(bot, 8), sync(peer, 8)]);
    const beforeLateJoin = [];
    for (let index = 0; index < 8; index += 1) {
      beforeLateJoin.push(await retry(`send pre-join encrypted history ${index}`, () =>
        bot.core.postMessage({ body: `pre-late ${Date.now()} ${index}`, roomId: lateRoom.roomId })
      ));
    }
    await syncUntil("peer receives pre-join encrypted history", peer, (events) =>
      messageEvent(events, lateRoom.roomId, (event) => event.eventId === beforeLateJoin.at(-1).eventId)
    );
    await botRest.invite(lateRoom.roomId, late.userId);
    await late.core.joinRoom({ roomIdOrAlias: lateRoom.roomId });
    await Promise.all([sync(bot, 8), sync(late, 8)]);
    const latePreJoinHistory = await late.core.fetchMessages({ limit: 20, roomId: lateRoom.roomId });
    const preJoinBodies = new Set(beforeLateJoin.map((message) => message.eventId));
    assert.equal(
      latePreJoinHistory.messages.some((message) => preJoinBodies.has(message.eventId)),
      false,
      "late encrypted member should not get decryptable pre-join messages"
    );
    const afterLateJoinBody = `post-late ${Date.now()}`;
    const afterLateJoin = await retry("send post-join encrypted message", () =>
      bot.core.postMessage({ body: afterLateJoinBody, roomId: lateRoom.roomId })
    );
    const lateSeen = await syncUntil("late member decrypts post-join message", late, (events) =>
      messageEvent(events, lateRoom.roomId, (event) => event.eventId === afterLateJoin.eventId)
    );
    assert.equal(lateSeen.body, afterLateJoinBody);
    assert.equal(lateSeen.isEncrypted, true);

    const lateDevice = await makeCore(peerAccount, "core-peer-late-device");
    try {
      await Promise.all([sync(bot, 3), sync(lateDevice, 3)]);
      const lateDeviceBody = `late-device ${Date.now()}`;
      const lateDeviceMessage = await retry("send message after fresh device discovery", () =>
        bot.core.postMessage({ body: lateDeviceBody, roomId: dm.roomId })
      );
      const lateDeviceSeen = await syncUntil("fresh recovered device decrypts existing room message", lateDevice, (events) =>
        messageEvent(events, dm.roomId, (event) => event.eventId === lateDeviceMessage.eventId)
      );
      assert.equal(lateDeviceSeen.body, lateDeviceBody);
      assert.equal(lateDeviceSeen.isEncrypted, true);
    } finally {
      await closeAll(lateDevice);
    }

    const body = `plain ${Date.now()}`;
    const sent = await retry("send plain message", () =>
      bot.core.postMessage({ body, roomId: dm.roomId })
    );
    const received = await syncUntil("peer receives encrypted bot message", peer, (events) =>
      messageEvent(events, dm.roomId, (event) => event.body === body)
    );
    assert.equal(received.isEncrypted, true);

    const formatted = `formatted ${Date.now()}`;
    const formattedSent = await retry("send formatted message", () => peer.core.postMessage({
      body: formatted,
      formattedBody: `<strong>${formatted}</strong>`,
      mentions: { userIds: [bot.userId] },
      roomId: dm.roomId,
    }));
    const formattedSeen = await syncUntil("bot receives formatted mention", bot, (events) =>
      messageEvent(events, dm.roomId, (event) => event.eventId === formattedSent.eventId)
    );
    assert.equal(formattedSeen.formattedBody.includes("<strong>"), true);
    assert.equal(formattedSeen.isEncrypted, true);

    const editedBody = `${body} edited`;
    await retry("edit message", () => bot.core.editMessage({
      body: editedBody,
      messageId: sent.eventId,
      roomId: dm.roomId,
    }));
    const editedSeen = await syncUntil("peer receives edit", peer, (events) =>
      messageEvent(events, dm.roomId, (event) => event.eventId === sent.eventId && event.body === editedBody)
    );
    assert.equal(editedSeen.isEdited, true);
    const fetchedEdited = await peer.core.fetchMessage({ messageId: sent.eventId, roomId: dm.roomId });
    assert.equal(fetchedEdited.message.body, editedBody);
    assert.equal(fetchedEdited.message.isEdited, true);

    await retry("add reaction", () =>
      peer.core.addReaction({ emoji: "✅", messageId: sent.eventId, roomId: dm.roomId })
    );
    await syncUntil("bot receives reaction", bot, (events) =>
      reactionEvent(events, dm.roomId, sent.eventId, "✅", true)
    );
    await peer.core.removeReaction({ emoji: "✅", messageId: sent.eventId, roomId: dm.roomId });
    await syncUntil("bot receives reaction removal", bot, (events) =>
      reactionEvent(events, dm.roomId, sent.eventId, "✅", false)
    );

    await bot.core.setTyping({ roomId: dm.roomId, timeoutMs: 5000, typing: true });
    await bot.core.setTyping({ roomId: dm.roomId, timeoutMs: 0, typing: false });

    const mediaPayload = Buffer.from(`media ${Date.now()}`, "utf8");
    const media = await retry("send media", () => bot.core.postMediaMessage({
      bytesBase64: mediaPayload.toString("base64"),
      contentType: "text/plain",
      filename: "better-matrix-js-e2e.txt",
      roomId: dm.roomId,
    }));
    const mediaSeen = await syncUntil("peer receives encrypted media", peer, (events) =>
      messageEvent(events, dm.roomId, (event) => event.eventId === media.eventId)
    );
    const attachment = mediaSeen.attachments?.[0];
    assert.ok(attachment);
    assert.ok(attachment.encryptedFile, "media in encrypted room should use encrypted file metadata");
    const downloaded = await peer.core.downloadEncryptedMedia({ file: attachment.encryptedFile });
    assert.equal(Buffer.from(downloaded.bytesBase64, "base64").toString("utf8"), mediaPayload.toString("utf8"));

    const threadRoot = await retry("send thread root", () => bot.core.postMessage({
      body: `thread root ${Date.now()}`,
      roomId: group.roomId,
    }));
    await syncUntil("peer receives thread root", peer, (events) =>
      messageEvent(events, group.roomId, (event) => event.eventId === threadRoot.eventId)
    );
    const threadReply = await retry("send thread reply", () => peer.core.postMessage({
      body: `thread reply ${Date.now()}`,
      roomId: group.roomId,
      threadRootEventId: threadRoot.eventId,
    }));
    await syncUntil("bot receives thread reply", bot, (events) =>
      messageEvent(events, group.roomId, (event) => event.eventId === threadReply.eventId)
    );
    const threadMessages = await bot.core.fetchMessages({
      limit: 10,
      roomId: group.roomId,
      threadRootEventId: threadRoot.eventId,
    });
    assert.ok(threadMessages.messages.some((message) => message.eventId === threadReply.eventId));
    const threads = await bot.core.listRoomThreads({ limit: 10, roomId: group.roomId });
    assert.ok(threads.threads.some((thread) => thread.root.eventId === threadRoot.eventId));

    const history = await bot.core.fetchMessages({ limit: 20, roomId: dm.roomId });
    assert.ok(history.messages.some((message) =>
      message.eventId === sent.eventId && message.body === editedBody && message.isEdited === true
    ));

    const rawSync = await new MatrixREST(botAccount).sync({ timeout: 0 });
    await bot.core.applySyncResponse({ response: rawSync });

    const joined = await bot.core.fetchJoinedRooms();
    assert.ok(joined.roomIds.includes(dm.roomId));
    assert.ok(joined.roomIds.includes(group.roomId));

    await bot.core.deleteMessage({ messageId: sent.eventId, reason: "e2e cleanup", roomId: dm.roomId });
    await sync(peer, 2);
    const deleted = await peer.core.fetchMessage({ messageId: sent.eventId, roomId: dm.roomId });
    assert.equal(deleted.message, null);
    await bot.core.markRead({ eventId: formattedSent.eventId, roomId: dm.roomId });
    await third.core.leaveRoom({ reason: "e2e complete", roomId: group.roomId });
    await late.core.leaveRoom({ reason: "e2e complete", roomId: lateRoom.roomId });
  } finally {
    await closeAll(bot, peer, third, late);
  }
});
