import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MatrixClient } from "@beeper/pickle";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HeadlessPiRuntimeOptions } from "./pi-runtime";
import { createHeadlessPiSession } from "./pi-runtime";
import { PicklePiAgent } from "./appservice";
import { PicklePiRegistry } from "./registry";
import type { PicklePiBinding, PicklePiConfig } from "./types";

vi.mock("./pi-runtime", () => ({
  createHeadlessPiSession: vi.fn(),
}));

const createHeadlessPiSessionMock = vi.mocked(createHeadlessPiSession);

beforeEach(() => {
  createHeadlessPiSessionMock.mockReset();
});

describe("PicklePiAgent streaming", () => {
  it("streams Pi assistant chunks into one Beeper stream and final edit", async () => {
    const client = createClient();
    const registry = await createRegistry();
    const binding = testBinding();
    registry.upsertBinding(binding);
    createHeadlessPiSessionMock.mockImplementation(async (options: HeadlessPiRuntimeOptions) => ({
      binding,
      session: {
        prompt: async () => {
          await options.onEvent({ message: { role: "assistant" }, type: "message_start" });
          await options.onEvent({
            assistantMessageEvent: { delta: "hello", type: "text_delta" },
            message: { role: "assistant" },
            type: "message_update",
          });
          await options.onEvent({ message: { role: "assistant" }, type: "message_end" });
        },
        subscribe: () => () => undefined,
      },
      unsubscribe: () => undefined,
    }));
    const agent = new PicklePiAgent({ client, config: testConfig(), registry });

    await agent.handleMatrixEvent({
      class: "message",
      content: {},
      edited: false,
      encrypted: false,
      eventId: "$input",
      kind: "message",
      messageType: "m.text",
      raw: {},
      roomId: "!room:example",
      sender: { isMe: false, userId: "@alice:example" },
      text: "hello pi",
      type: "m.room.message",
    });

    expect(client.beeper.streams.create).toHaveBeenCalledTimes(1);
    expect(client.beeper.streams.register).toHaveBeenCalledTimes(1);
    expect(client.beeper.streams.publish.mock.calls.map(([options]) => delta(options).part.type)).toEqual([
      "start",
      "text-start",
      "text-delta",
      "text-end",
      "finish",
    ]);
    expect(client.messages.edit).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$target",
      roomId: "!room:example",
      text: "hello",
    }));
  });
});

async function createRegistry(): Promise<PicklePiRegistry> {
  return new PicklePiRegistry(join(await mkdtemp(join(tmpdir(), "pickle-pi-agent-")), "registry.json"));
}

function testConfig(): PicklePiConfig {
  return {
    appserviceId: "pickle-pi",
    dataDir: "/tmp/pickle-pi",
    ghostLocalpart: "pickle-pi",
    serviceBotLocalpart: "pickle-pi-service",
    storePath: "/tmp/pickle-pi/store",
  };
}

function testBinding(): PicklePiBinding {
  return {
    createdAt: 1,
    cwd: "/repo",
    id: "binding_1",
    mode: "headless",
    owner: "appservice",
    piGhostUserId: "@pickle-pi:example",
    piSessionFile: "/tmp/pickle-pi/session.jsonl",
    roomId: "!room:example",
    updatedAt: 1,
  };
}

function createClient() {
  const client = {
    beeper: {
      streams: {
        create: vi.fn(async () => ({ descriptor: { device_id: "DEVICE", type: "com.beeper.llm", user_id: "@bot:example" } })),
        publish: vi.fn(async () => undefined),
        register: vi.fn(async () => undefined),
      },
    },
    close: vi.fn(async () => undefined),
    messages: {
      edit: vi.fn(async () => ({ eventId: "$edit", raw: {}, roomId: "!room:example" })),
      get: vi.fn(async () => ({ message: null })),
      send: vi.fn(async () => ({ eventId: "$target", raw: {}, roomId: "!room:example" })),
    },
    rooms: {
      sendStateEvent: vi.fn(async () => ({ eventId: "$state", raw: {}, roomId: "!room:example" })),
    },
  };
  return client as unknown as MatrixClient & typeof client;
}

function delta(options: { content?: Record<string, unknown> }): Record<string, unknown> {
  const deltas = options.content?.["com.beeper.llm.deltas"];
  if (!Array.isArray(deltas)) throw new Error("missing com.beeper.llm.deltas");
  const [first] = deltas;
  if (!first || typeof first !== "object") throw new Error("missing stream delta");
  return first as Record<string, unknown>;
}
