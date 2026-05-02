import { EventEmitter } from "node:events";
import type { MatrixRoomInfo } from "better-matrix-js";
import type { MatrixEvent } from "./event";

export enum RoomEvent {
  AccountData = "Room.accountData",
  LocalEchoUpdated = "Room.localEchoUpdated",
  MyMembership = "Room.myMembership",
  Name = "Room.name",
  Receipt = "Room.receipt",
  Redaction = "Room.redaction",
  Tags = "Room.tags",
  Timeline = "Room.timeline",
  TimelineReset = "Room.timelineReset",
}

export class Room extends EventEmitter {
  readonly roomId: string;
  name: string | undefined;
  summary: MatrixRoomInfo | undefined;
  timeline: MatrixEvent[] = [];

  constructor(roomId: string, summary?: MatrixRoomInfo) {
    super();
    this.roomId = roomId;
    this.applySummary(summary);
  }

  applySummary(summary?: MatrixRoomInfo): void {
    if (!summary) return;
    this.summary = summary;
    this.name = summary.name;
  }

  addLiveEvents(events: MatrixEvent[]): void {
    this.timeline.push(...events);
  }

  getLiveTimeline(): { getEvents: () => MatrixEvent[] } {
    return { getEvents: () => this.timeline };
  }

  getMyMembership(): string {
    return "join";
  }

  hasEncryptionStateEvent(): boolean {
    return Boolean(this.summary?.encrypted);
  }
}
