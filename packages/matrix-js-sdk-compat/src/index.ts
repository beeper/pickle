import { EventType, MsgType } from "./@types/event";
import { MatrixClient, createClient } from "./client";
import { getHttpUriForMxc, mxcUrlToHttp } from "./content-repo";
import { ClientEvent } from "./events/client";
import { MatrixEvent, MatrixEventEvent } from "./models/event";
import { Room, RoomEvent } from "./models/room";
import { User } from "./models/user";
import { SyncState } from "./sync";

export * from "./@types/auth";
export * from "./@types/client";
export * from "./@types/event";
export * from "./client";
export * from "./content-repo";
export * from "./event-mapper";
export * from "./events/client";
export * from "./http-api/errors";
export * from "./models/event";
export * from "./models/room";
export * from "./models/user";
export * from "./sync";

const matrixcs = {
  ClientEvent,
  EventType,
  MatrixClient,
  MatrixEvent,
  MatrixEventEvent,
  MsgType,
  Room,
  RoomEvent,
  SyncState,
  User,
  createClient,
  getHttpUriForMxc,
  mxcUrlToHttp,
};

export default matrixcs;
