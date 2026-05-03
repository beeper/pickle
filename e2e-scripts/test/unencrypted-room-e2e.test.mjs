import assert from "node:assert/strict";
import test from "node:test";
import { loadAccounts } from "../src/accounts.mjs";
import { MatrixREST } from "../src/matrix-rest.mjs";
import { closeAll, makeCore, messageEvent, retry, sync, syncUntil } from "../src/harness.mjs";

const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/luzO7wAAAABJRU5ErkJggg==";

test("core: unencrypted room metadata, messages, and media stay plain", async () => {
  const [botAccount, peerAccount] = await loadAccounts(2);
  const bot = await makeCore(botAccount, "unencrypted-bot");
  const peer = await makeCore(peerAccount, "unencrypted-peer");
  const botRest = new MatrixREST(botAccount);
  const peerRest = new MatrixREST(peerAccount);

  try {
    await Promise.all([sync(bot, 2), sync(peer, 2)]);

    const name = `better-matrix-js unencrypted ${Date.now()}`;
    const topic = "unencrypted live e2e coverage";
    const room = await botRest.createRoom({
      invite: [peer.userId],
      name,
      topic,
    });
    await peerRest.join(room.room_id);
    await Promise.all([sync(bot, 6), sync(peer, 6)]);

    const roomInfo = await bot.core.fetchRoom({ roomId: room.room_id });
    assert.equal(roomInfo.encrypted, false);
    assert.equal(roomInfo.name, name);
    assert.equal(roomInfo.topic, topic);
    assert.ok(roomInfo.memberCount >= 2);

    const body = `unencrypted plain ${Date.now()}`;
    const sent = await retry("send unencrypted plain message", () =>
      bot.core.postMessage({ body, roomId: room.room_id })
    );
    const seen = await syncUntil("peer receives unencrypted plain message", peer, (events) =>
      messageEvent(events, room.room_id, (event) => event.eventId === sent.eventId)
    );
    assert.equal(seen.body, body);
    assert.notEqual(seen.isEncrypted, true);
    assert.equal(seen.content?.msgtype, "m.text");
    assert.equal(seen.content?.body, body);
    assert.equal(seen.content?.ciphertext, undefined);

    const textPayload = Buffer.from(`unencrypted file ${Date.now()}`, "utf8");
    const textMedia = await retry("send unencrypted file media", () =>
      bot.core.postMediaMessage({
        bytesBase64: textPayload.toString("base64"),
        contentType: "text/plain",
        filename: "unencrypted-e2e.txt",
        msgtype: "m.file",
        roomId: room.room_id,
        size: textPayload.byteLength,
      })
    );
    const textMediaSeen = await syncUntil("peer receives unencrypted file media", peer, (events) =>
      messageEvent(events, room.room_id, (event) => event.eventId === textMedia.eventId)
    );
    const textAttachment = textMediaSeen.attachments?.[0];
    assert.ok(textAttachment);
    assert.equal(textMediaSeen.msgtype, "m.file");
    assert.equal(textAttachment.msgtype, "m.file");
    assert.equal(textAttachment.filename, "unencrypted-e2e.txt");
    assert.equal(textAttachment.info?.contentType, "text/plain");
    assert.equal(textAttachment.info?.size, textPayload.byteLength);
    assert.ok(textAttachment.contentUri?.startsWith("mxc://"));
    assert.equal(textAttachment.encryptedFile, undefined);
    const textDownloaded = await peer.core.downloadMedia({ contentUri: textAttachment.contentUri });
    assert.equal(Buffer.from(textDownloaded.bytesBase64, "base64").toString("utf8"), textPayload.toString("utf8"));

    const imagePayload = Buffer.from(PNG_1X1_BASE64, "base64");
    const imageMedia = await retry("send unencrypted image media", () =>
      bot.core.postMediaMessage({
        bytesBase64: PNG_1X1_BASE64,
        contentType: "image/png",
        filename: "unencrypted-pixel.png",
        height: 1,
        msgtype: "m.image",
        roomId: room.room_id,
        size: imagePayload.byteLength,
        width: 1,
      })
    );
    const imageMediaSeen = await syncUntil("peer receives unencrypted image media", peer, (events) =>
      messageEvent(events, room.room_id, (event) => event.eventId === imageMedia.eventId)
    );
    const imageAttachment = imageMediaSeen.attachments?.[0];
    assert.ok(imageAttachment);
    assert.equal(imageMediaSeen.msgtype, "m.image");
    assert.equal(imageAttachment.msgtype, "m.image");
    assert.equal(imageAttachment.filename, "unencrypted-pixel.png");
    assert.equal(imageAttachment.info?.contentType, "image/png");
    assert.equal(imageAttachment.info?.height, 1);
    assert.equal(imageAttachment.info?.size, imagePayload.byteLength);
    assert.equal(imageAttachment.info?.width, 1);
    assert.ok(imageAttachment.contentUri?.startsWith("mxc://"));
    assert.equal(imageAttachment.encryptedFile, undefined);
    const imageDownloaded = await peer.core.downloadMedia({ contentUri: imageAttachment.contentUri });
    assert.deepEqual(Buffer.from(imageDownloaded.bytesBase64, "base64"), imagePayload);
  } finally {
    await closeAll(bot, peer);
  }
});
