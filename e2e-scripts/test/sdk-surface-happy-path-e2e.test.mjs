import assert from "node:assert/strict";
import test from "node:test";
import { BEEPER_DOMAIN } from "../src/config.mjs";
import { loadAccounts } from "../src/accounts.mjs";
import {
  closeAll,
  eventually,
  makeCore,
  messageEvent,
  retry,
  sync,
  syncUntil,
} from "../src/harness.mjs";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
  "base64"
);

test("sdk surface: rooms, account data, to-device, receipts, redactions, relations, media, raw, isolation", async () => {
  const [adminAccount, peerAccount, inviteeAccount, kickedAccount, bannedAccount, otherAccount] =
    await loadAccounts(6);
  const admin = await makeCore(adminAccount, "surface-admin");
  const peer = await makeCore(peerAccount, "surface-peer");
  const invitee = await makeCore(inviteeAccount, "surface-invitee");
  const kicked = await makeCore(kickedAccount, "surface-kicked");
  const banned = await makeCore(bannedAccount, "surface-banned");
  const other = await makeCore(otherAccount, "surface-other");

  try {
    await Promise.all([sync(admin, 2), sync(peer, 2), sync(invitee, 2), sync(kicked, 2), sync(banned, 2), sync(other, 2)]);

    const aliasLocalpart = `bmjs-surface-${Date.now()}`;
    const room = await admin.core.rooms.create({
      invite: [peer.userId],
      name: "surface room initial",
      preset: "private_chat",
      roomAliasName: aliasLocalpart,
      topic: "surface topic initial",
      visibility: "public",
    });
    await peer.core.rooms.join({ roomIdOrAlias: room.roomId });
    await Promise.all([sync(admin, 4), sync(peer, 4)]);

    const alias = `#${aliasLocalpart}:${BEEPER_DOMAIN}`;
    const resolved = await admin.core.rooms.resolveAlias({ alias });
    assert.equal(resolved.roomId, room.roomId);
    assert.ok(Array.isArray(resolved.servers));

    const avatar = await admin.core.media.upload({
      bytes: tinyPng,
      contentType: "image/png",
      filename: "avatar.png",
    });
    await admin.core.rooms.sendStateEvent({
      content: { name: "surface room renamed" },
      eventType: "m.room.name",
      roomId: room.roomId,
      stateKey: "",
    });
    const topicEvent = await admin.core.rooms.sendStateEvent({
      content: { topic: "surface topic renamed" },
      eventType: "m.room.topic",
      roomId: room.roomId,
      stateKey: "",
    });
    await admin.core.rooms.sendStateEvent({
      content: { url: avatar.contentUri },
      eventType: "m.room.avatar",
      roomId: room.roomId,
      stateKey: "",
    });

    const power = await admin.core.rooms.getPowerLevels({ roomId: room.roomId });
    await admin.core.rooms.sendStateEvent({
      content: {
        ...power.raw,
        users: { ...(power.users ?? {}), [peer.userId]: 50 },
      },
      eventType: "m.room.power_levels",
      roomId: room.roomId,
      stateKey: "",
    });
    const updatedPower = await admin.core.rooms.getPowerLevels({ roomId: room.roomId });
    assert.equal(updatedPower.users?.[peer.userId], 50);

    await eventually("room state reflects name/topic/avatar", async () => {
      const info = await admin.core.rooms.get({ roomId: room.roomId });
      assert.equal(info.name, "surface room renamed");
      assert.equal(info.topic, "surface topic renamed");
      const avatarState = await admin.core.rooms.getStateEvent({
        eventType: "m.room.avatar",
        roomId: room.roomId,
        stateKey: "",
      });
      assert.equal(avatarState.content.url, avatar.contentUri);
      const allState = await admin.core.rooms.getState({ roomId: room.roomId });
      assert.ok(allState.events.some((event) => event.type === "m.room.power_levels"));
      return true;
    });

    await admin.core.rooms.invite({ reason: "surface invite", roomId: room.roomId, userId: invitee.userId });
    await syncUntil("invitee sees invite", invitee, (events) =>
      events.some((event) => event.kind === "invite" && event.roomId === room.roomId)
    );
    await invitee.core.rooms.join({ roomIdOrAlias: room.roomId });
    await sync(admin, 3);
    await invitee.core.rooms.leave({ reason: "surface leave", roomId: room.roomId });

    await admin.core.rooms.invite({ roomId: room.roomId, userId: kicked.userId });
    await kicked.core.rooms.join({ roomIdOrAlias: room.roomId });
    await sync(admin, 3);
    await admin.core.rooms.kick({ reason: "surface kick", roomId: room.roomId, userId: kicked.userId });
    await eventually("kick is visible in members", async () => {
      const members = await admin.core.rooms.listMembers({ membership: "leave", roomId: room.roomId });
      assert.ok(members.members.some((member) => member.userId === kicked.userId));
      return true;
    });

    await admin.core.rooms.ban({ reason: "surface ban", redactEvents: false, roomId: room.roomId, userId: banned.userId });
    await eventually("ban is visible in members", async () => {
      const members = await admin.core.rooms.listMembers({ membership: "ban", roomId: room.roomId });
      assert.ok(members.members.some((member) => member.userId === banned.userId));
      return true;
    });
    await admin.core.rooms.unban({ reason: "surface unban", roomId: room.roomId, userId: banned.userId });

    const globalType = `com.beeper.bmjs.surface.global.${Date.now()}`;
    const roomType = `com.beeper.bmjs.surface.room.${Date.now()}`;
    await admin.core.accountData.set({ eventType: globalType, content: { ok: true, scope: "global" } });
    await admin.core.accountData.setRoom({ eventType: roomType, roomId: room.roomId, content: { ok: true, scope: "room" } });
    assert.deepEqual((await admin.core.accountData.get({ eventType: globalType })).content, { ok: true, scope: "global" });
    assert.deepEqual((await admin.core.accountData.getRoom({ eventType: roomType, roomId: room.roomId })).content, { ok: true, scope: "room" });
    await syncUntil("account data sync emits both scopes", admin, (events) =>
      events.some((event) => event.kind === "accountData" && event.type === globalType) &&
      events.some((event) => event.kind === "accountData" && event.type === roomType && event.roomId === room.roomId)
    );

    const toDeviceType = `com.beeper.bmjs.surface.to_device.${Date.now()}`;
    await admin.core.toDevice.send({
      eventType: toDeviceType,
      transactionId: `txn-${Date.now()}`,
      userId: peer.userId,
      deviceId: peer.account.deviceId,
      content: { hello: "device" },
    });
    await admin.core.toDevice.send({
      eventType: `${toDeviceType}.bulk`,
      messages: { [peer.userId]: { [peer.account.deviceId]: { hello: "bulk" } } },
    });
    await syncUntil("peer receives custom to-device events", peer, (events) =>
      events.some((event) => event.kind === "toDevice" && event.type === toDeviceType && event.content.hello === "device") &&
      events.some((event) => event.kind === "toDevice" && event.type === `${toDeviceType}.bulk` && event.content.hello === "bulk")
    );

    const receiptMessage = await retry("send receipt target", () =>
      admin.core.messages.send({ roomId: room.roomId, text: `receipt target ${Date.now()}` })
    );
    await syncUntil("peer sees receipt target", peer, (events) =>
      messageEvent(events, room.roomId, (event) => event.eventId === receiptMessage.eventId)
    );
    await peer.core.receipts.send({ eventId: receiptMessage.eventId, receiptType: "m.read", roomId: room.roomId });
    await peer.core.receipts.send({
      content: { extra: true },
      eventId: receiptMessage.eventId,
      receiptType: "m.read.private",
      roomId: room.roomId,
      threadId: "main",
    });
    await syncUntil("admin receives read receipt", admin, (events) =>
      events.some((event) => event.kind === "receipt" && event.roomId === room.roomId)
    );

    const customTimeline = await admin.core.raw.request({
      method: "PUT",
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/send/com.beeper.bmjs.surface.custom/surface-${Date.now()}`,
      body: { body: "surface custom event" },
    });
    assert.equal(customTimeline.status, 200);
    assert.ok(customTimeline.body.event_id);
    await sync(peer, 2);
    const redaction = await admin.core.raw.request({
      method: "PUT",
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/redact/${encodeURIComponent(customTimeline.body.event_id)}/surface-${Date.now()}`,
      body: { reason: "surface custom redaction" },
    });
    assert.equal(redaction.status, 200);
    await eventually("custom event is redacted", async () => {
      const fetched = await peer.core.raw.request({
        method: "GET",
        path: `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/event/${encodeURIComponent(customTimeline.body.event_id)}`,
      });
      assert.deepEqual(fetched.body.content, {});
      assert.ok(fetched.body.unsigned?.redacted_because);
      return true;
    });

    const roots = [];
    for (let rootIndex = 0; rootIndex < 3; rootIndex += 1) {
      roots.push(await retry(`send thread root ${rootIndex}`, () =>
        admin.core.messages.send({ roomId: room.roomId, text: `surface thread root ${rootIndex} ${Date.now()}` })
      ));
    }
    for (let index = 0; index < 12; index += 1) {
      await retry(`send thread reply ${index}`, () =>
        peer.core.messages.send({
          roomId: room.roomId,
          text: `surface thread reply ${index} ${Date.now()}`,
          threadRoot: roots[0].eventId,
        })
      );
    }
    await syncUntil("admin receives last thread reply", admin, (events) =>
      messageEvent(events, room.roomId, (event) => event.threadRootEventId === roots[0].eventId || event.threadRoot === roots[0].eventId)
    );
    const firstThreadPage = await admin.core.messages.list({ limit: 5, roomId: room.roomId, threadRoot: roots[0].eventId });
    assert.ok(firstThreadPage.messages.length >= 1);
    assert.ok(firstThreadPage.nextCursor);
    const secondThreadPage = await admin.core.messages.list({
      cursor: firstThreadPage.nextCursor,
      limit: 5,
      roomId: room.roomId,
      threadRoot: roots[0].eventId,
    });
    assert.ok(secondThreadPage.messages.length >= 1);
    const threadList = await eventually("thread list contains created roots", async () => {
      const result = await admin.core.rooms.threads.list({ limit: 10, roomId: room.roomId });
      assert.ok(result.threads.some((thread) => thread.root.eventId === roots[0].eventId));
      return result;
    });
    assert.ok(threadList.threads.length >= 1);

    const uploadedPlain = await admin.core.media.upload({
      bytes: tinyPng,
      contentType: "image/png",
      filename: "plain.png",
      height: 1,
      width: 1,
    });
    const downloadedPlain = await admin.core.media.download({ contentUri: uploadedPlain.contentUri });
    assert.deepEqual(Buffer.from(downloadedPlain.bytes), tinyPng);
    const thumbnail = await admin.core.media.downloadThumbnail({
      contentUri: uploadedPlain.contentUri,
      height: 32,
      method: "scale",
      width: 32,
    });
    assert.ok(thumbnail.bytes.byteLength > 0);
    const uploadedEncrypted = await admin.core.media.uploadEncrypted({
      bytes: tinyPng,
      contentType: "image/png",
      filename: "encrypted.png",
    });
    const downloadedEncrypted = await admin.core.media.downloadEncrypted({ file: uploadedEncrypted.file });
    assert.deepEqual(Buffer.from(downloadedEncrypted.bytes), tinyPng);

    const rawJoined = await admin.core.raw.request({
      method: "GET",
      path: "/_matrix/client/v3/joined_rooms",
      query: { surface: "1" },
      headers: { "x-bmjs-surface": "true" },
    });
    assert.equal(rawJoined.status, 200);
    assert.ok(Array.isArray(rawJoined.body.joined_rooms));
    const rawState = await admin.core.raw.request({
      method: "PUT",
      path: `/_matrix/client/v3/rooms/${encodeURIComponent(room.roomId)}/state/com.beeper.bmjs.surface.raw/${encodeURIComponent("state")}`,
      body: { ok: true },
    });
    assert.equal(rawState.status, 200);
    const rawStateRead = await admin.core.rooms.getStateEvent({
      eventType: "com.beeper.bmjs.surface.raw",
      roomId: room.roomId,
      stateKey: "state",
    });
    assert.equal(rawStateRead.content.ok, true);

    const isolationRoomA = await admin.core.rooms.create({
      invite: [peer.userId],
      name: `surface isolation A ${Date.now()}`,
      preset: "private_chat",
    });
    const isolationRoomB = await other.core.rooms.create({
      invite: [invitee.userId],
      name: `surface isolation B ${Date.now()}`,
      preset: "private_chat",
    });
    await Promise.all([
      peer.core.rooms.join({ roomIdOrAlias: isolationRoomA.roomId }),
      invitee.core.rooms.join({ roomIdOrAlias: isolationRoomB.roomId }),
    ]);
    await Promise.all([sync(admin, 3), sync(peer, 3), sync(other, 3), sync(invitee, 3)]);
    const isolationMessages = [];
    for (let index = 0; index < 8; index += 1) {
      isolationMessages.push(await admin.core.messages.send({
        roomId: isolationRoomA.roomId,
        text: `surface isolation A ${index} ${Date.now()}`,
      }));
      isolationMessages.push(await other.core.messages.send({
        roomId: isolationRoomB.roomId,
        text: `surface isolation B ${index} ${Date.now()}`,
      }));
      await Promise.all([sync(admin, 1, 250), sync(peer, 1, 250), sync(other, 1, 250), sync(invitee, 1, 250)]);
    }
    await syncUntil("peer receives only isolation room A messages", peer, (events) => {
      const seenA = isolationMessages.filter((message) =>
        message.roomId === isolationRoomA.roomId &&
        messageEvent(events, isolationRoomA.roomId, (event) => event.eventId === message.eventId)
      );
      const leakedB = isolationMessages.some((message) =>
        message.roomId === isolationRoomB.roomId &&
        messageEvent(events, isolationRoomB.roomId, (event) => event.eventId === message.eventId)
      );
      return seenA.length >= 8 && !leakedB;
    });
  } finally {
    await closeAll(admin, peer, invitee, kicked, banned, other);
  }
});
