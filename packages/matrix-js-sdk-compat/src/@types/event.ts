export const EventType = {
  Reaction: "m.reaction",
  RoomEncrypted: "m.room.encrypted",
  RoomMessage: "m.room.message",
  RoomMessageEncrypted: "m.room.encrypted",
  RoomRedaction: "m.room.redaction",
} as const;

export const MsgType = {
  Audio: "m.audio",
  Emote: "m.emote",
  File: "m.file",
  Image: "m.image",
  Notice: "m.notice",
  Text: "m.text",
  Video: "m.video",
} as const;
