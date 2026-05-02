import { EventEmitter } from "node:events";
import { EventType } from "../@types/event";

export enum MatrixEventEvent {
  Decrypted = "Event.decrypted",
  Replaced = "Event.replaced",
}

export class MatrixEvent extends EventEmitter {
  readonly event: Record<string, any>;

  constructor(event: Record<string, any>) {
    super();
    this.event = event;
  }

  getId(): string | undefined {
    return this.event.event_id;
  }

  getRoomId(): string | undefined {
    return this.event.room_id;
  }

  getSender(): string | undefined {
    return this.event.sender;
  }

  getType(): string {
    return this.event.type;
  }

  getContent<T extends Record<string, any> = Record<string, any>>(): T {
    return (this.event.content ?? {}) as T;
  }

  getTs(): number | undefined {
    return this.event.origin_server_ts;
  }

  isEncrypted(): boolean {
    return this.getType() === EventType.RoomEncrypted || Boolean(this.event.isEncrypted);
  }

  isRedacted(): boolean {
    return Boolean(this.event.unsigned?.redacted_because);
  }
}
