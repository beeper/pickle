import { createBeeperStreamPublisher, type BeeperStreamPublisher } from "./beeper-stream";
import { createPiEventMapper, type PiEventMapper } from "./pi-event-map";
import type { BeeperUIMessageChunk } from "./stream-map";
import type { BeeperStreamPublisherClient, CreateBeeperStreamPublisherOptions } from "./beeper-stream";

export interface CreatePiBeeperStreamBridgeOptions extends Omit<CreateBeeperStreamPublisherOptions, "client"> {
  client: BeeperStreamPublisherClient;
}

export class PiBeeperStreamBridge {
  readonly mapper: PiEventMapper;
  readonly publisher: BeeperStreamPublisher;
  #closed = false;

  constructor(options: CreatePiBeeperStreamBridgeOptions) {
    this.publisher = createBeeperStreamPublisher(options);
    this.mapper = createPiEventMapper(this.publisher.turnId);
  }

  async start(): Promise<void> {
    await this.publisher.start();
  }

  async handlePiEvent(event: unknown): Promise<void> {
    if (this.#closed) return;
    for (const chunk of this.mapper.map(event)) {
      await this.#handleChunk(chunk);
    }
  }

  async publish(chunk: BeeperUIMessageChunk): Promise<void> {
    await this.#handleChunk(chunk);
  }

  async #handleChunk(chunk: BeeperUIMessageChunk): Promise<void> {
    if (chunk.type === "start") {
      await this.publisher.start();
      return;
    }
    if (chunk.type === "finish") {
      this.#closed = true;
      await this.publisher.finalize({
        finishReason: typeof chunk.finishReason === "string" ? chunk.finishReason : "stop",
      });
      return;
    }
    if (chunk.type === "error") {
      this.#closed = true;
      await this.publisher.error(typeof chunk.errorText === "string" ? chunk.errorText : "Pi stream failed");
      return;
    }
    if (chunk.type === "abort") {
      this.#closed = true;
      await this.publisher.abort(typeof chunk.reason === "string" ? chunk.reason : undefined);
      return;
    }
    await this.publisher.publish(chunk);
  }
}

export function createPiBeeperStreamBridge(options: CreatePiBeeperStreamBridgeOptions): PiBeeperStreamBridge {
  return new PiBeeperStreamBridge(options);
}
