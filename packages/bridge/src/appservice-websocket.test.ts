import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { AppserviceWebsocket } from "./appservice-websocket";
import type { BridgeLogger } from "./types";

const servers: Array<{ close(callback?: (error?: Error) => void): void }> = [];
const websockets: AppserviceWebsocket[] = [];

afterEach(async () => {
  for (const websocket of websockets.splice(0)) websocket.stop();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error?: Error) => error ? reject(error) : resolve());
  })));
});

describe("AppserviceWebsocket", () => {
  it("connects to as_sync, dispatches transactions, and acknowledges them", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    const dispatch = vi.fn(async () => {});
    const connected = new Promise<void>((resolve, reject) => {
      wsServer.on("connection", (socket, request) => {
        try {
          expect(request.url).toBe("/_hungryserv/alice/_matrix/client/unstable/fi.mau.as_sync");
          expect(request.headers.authorization).toBe("Bearer as-token");
          socket.once("message", (raw) => {
            const response = JSON.parse(raw.toString()) as { command: string; data: { txn_id: string }; id: number };
            expect(response).toEqual({
              command: "response",
              data: { txn_id: "txn-1" },
              id: 7,
            });
            resolve();
          });
          socket.send(JSON.stringify({
            command: "transaction",
            events: [{
              content: { body: "hi", msgtype: "m.text" },
              event_id: "$event",
              room_id: "!room:example",
              sender: "@alice:example",
              type: "m.room.message",
            }],
            id: 7,
            txn_id: "txn-1",
          }));
        } catch (error) {
          reject(error);
        }
      });
    });
    const websocket = createWebsocket(homeserver, {
      dispatch,
      log: (() => {}) as BridgeLogger,
    });
    websockets.push(websocket);

    websocket.start();
    await connected;

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$event",
      kind: "message",
      roomId: "!room:example",
      text: "hi",
    }));
  });

  it("preserves Matrix edit, reply, thread, mention, and formatted body metadata from appservice transactions", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    const dispatch = vi.fn(async () => {});
    const connected = new Promise<void>((resolve, reject) => {
      wsServer.on("connection", (socket) => {
        socket.once("message", () => resolve());
        socket.send(JSON.stringify({
          command: "transaction",
          events: [
            {
              content: {
                body: "* old",
                "m.new_content": {
                  body: "corrected",
                  formatted_body: "<strong>corrected</strong>",
                  "m.mentions": { room: true, user_ids: ["@bob:example"] },
                  msgtype: "m.text",
                },
                "m.relates_to": { event_id: "$old", rel_type: "m.replace" },
                msgtype: "m.text",
              },
              event_id: "$edit",
              room_id: "!room:example",
              sender: "@alice:example",
              type: "m.room.message",
            },
            {
              content: {
                body: "thread reply",
                "m.relates_to": {
                  event_id: "$thread",
                  is_falling_back: false,
                  "m.in_reply_to": { event_id: "$parent" },
                  rel_type: "m.thread",
                },
                msgtype: "m.text",
              },
              event_id: "$thread-reply",
              room_id: "!room:example",
              sender: "@alice:example",
              type: "m.room.message",
            },
          ],
          id: 11,
          txn_id: "txn-relations",
        }));
      });
    });
    const websocket = createWebsocket(homeserver, {
      dispatch,
      log: (() => {}) as BridgeLogger,
    });
    websockets.push(websocket);

    websocket.start();
    await connected;

    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({
      edited: true,
      eventId: "$edit",
      html: "<strong>corrected</strong>",
      mentions: { room: true, userIds: ["@bob:example"] },
      relation: { eventId: "$old", type: "m.replace" },
      replaces: "$old",
      text: "corrected",
    }));
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({
      edited: false,
      eventId: "$thread-reply",
      relation: { eventId: "$thread", isFallback: false, replyTo: "$parent", type: "m.thread" },
      replyTo: "$parent",
      text: "thread reply",
      threadRoot: "$thread",
    }));
  });

  it("converts appservice Matrix media messages into attachments", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    const dispatch = vi.fn(async () => {});
    const connected = new Promise<void>((resolve) => {
      wsServer.on("connection", (socket) => {
        socket.once("message", () => resolve());
        socket.send(JSON.stringify({
          command: "transaction",
          events: [{
            content: {
              body: "photo.png",
              info: {
                h: 480,
                mimetype: "image/png",
                size: 12345,
                w: 640,
              },
              msgtype: "m.image",
              url: "mxc://example/photo",
            },
            event_id: "$image",
            room_id: "!room:example",
            sender: "@alice:example",
            type: "m.room.message",
          }],
          id: 12,
          txn_id: "txn-media",
        }));
      });
    });
    const websocket = createWebsocket(homeserver, {
      dispatch,
      log: (() => {}) as BridgeLogger,
    });
    websockets.push(websocket);

    websocket.start();
    await connected;

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{
        contentType: "image/png",
        contentUri: "mxc://example/photo",
        filename: "photo.png",
        height: 480,
        kind: "image",
        size: 12345,
        width: 640,
      }],
      eventId: "$image",
      messageType: "m.image",
      text: "photo.png",
    }));
  });

  it("converts encrypted appservice Matrix media into encrypted attachments", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    const dispatch = vi.fn(async () => {});
    const encryptedFile = {
      hashes: { sha256: "hash" },
      iv: "iv",
      key: { alg: "A256CTR", ext: true, k: "key", key_ops: ["encrypt", "decrypt"], kty: "oct" },
      url: "mxc://example/encrypted",
      v: "v2",
    };
    const connected = new Promise<void>((resolve) => {
      wsServer.on("connection", (socket) => {
        socket.once("message", () => resolve());
        socket.send(JSON.stringify({
          command: "transaction",
          events: [{
            content: {
              body: "secret.pdf",
              file: encryptedFile,
              filename: "secret.pdf",
              info: {
                mimetype: "application/pdf",
                size: 777,
              },
              msgtype: "m.file",
            },
            event_id: "$encrypted-file",
            room_id: "!room:example",
            sender: "@alice:example",
            type: "m.room.message",
          }],
          id: 13,
          txn_id: "txn-encrypted-media",
        }));
      });
    });
    const websocket = createWebsocket(homeserver, {
      dispatch,
      log: (() => {}) as BridgeLogger,
    });
    websockets.push(websocket);

    websocket.start();
    await connected;

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      attachments: [{
        contentType: "application/pdf",
        encryptedFile,
        filename: "secret.pdf",
        kind: "file",
        size: 777,
      }],
      eventId: "$encrypted-file",
      messageType: "m.file",
      text: "secret.pdf",
    }));
  });

  it("forwards appservice transactions before acknowledging them", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    let releaseTransaction!: () => void;
    const transactionGate = new Promise<void>((resolve) => {
      releaseTransaction = resolve;
    });
    const handleTransaction = vi.fn(() => transactionGate);
    let acknowledged = false;
    const connected = new Promise<void>((resolve, reject) => {
      wsServer.on("connection", (socket) => {
        socket.once("message", (raw) => {
          try {
            acknowledged = true;
            const response = JSON.parse(raw.toString()) as { command: string; data: { txn_id: string }; id: number };
            expect(response).toEqual({
              command: "response",
              data: { txn_id: "txn-td" },
              id: 8,
            });
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        socket.send(JSON.stringify({
          command: "transaction",
          id: 8,
          to_device: [{
            content: { device_id: "DESKTOP", event_id: "$event", room_id: "!room:example" },
            sender: "@alice:example",
            to_device_id: "PICKLE",
            to_user_id: "@bot:example",
            type: "com.beeper.stream.subscribe",
          }],
          txn_id: "txn-td",
        }));
      });
    });
    const websocket = createWebsocket(homeserver, {
      handleTransaction,
      log: (() => {}) as BridgeLogger,
    });
    websockets.push(websocket);

    websocket.start();
    const ackBeforeRelease = await Promise.race([
      connected.then(() => true),
      delay(20).then(() => false),
    ]);
    expect(ackBeforeRelease).toBe(false);
    expect(acknowledged).toBe(false);
    releaseTransaction();
    await connected;

    expect(handleTransaction).toHaveBeenCalledWith(expect.objectContaining({
      to_device: [expect.objectContaining({
        content: { device_id: "DESKTOP", event_id: "$event", room_id: "!room:example" },
        sender: "@alice:example",
        to_device_id: "PICKLE",
        to_user_id: "@bot:example",
        type: "com.beeper.stream.subscribe",
      })],
      txn_id: "txn-td",
    }));
  });

  it("handles http_proxy appservice transaction requests", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    const dispatch = vi.fn(async () => {});
    const handleTransaction = vi.fn(async () => {});
    const connected = new Promise<void>((resolve, reject) => {
      wsServer.on("connection", (socket) => {
        socket.once("message", (raw) => {
          try {
            const response = JSON.parse(raw.toString()) as { command: string; data: { status: number; body: unknown }; id: number };
            expect(response.command).toBe("response");
            expect(response.id).toBe(9);
            expect(response.data.status).toBe(200);
            expect(response.data.body).toEqual({});
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        socket.send(JSON.stringify({
          command: "http_proxy",
          data: {
            body: {
              events: [{
                content: { body: "proxied", msgtype: "m.text" },
                event_id: "$proxied",
                room_id: "!room:example",
                sender: "@alice:example",
                type: "m.room.message",
              }],
            },
            method: "PUT",
            path: "/_matrix/app/v1/transactions/txn-2",
          },
          id: 9,
        }));
      });
    });
    const websocket = createWebsocket(homeserver, {
      dispatch,
      handleTransaction,
      log: (() => {}) as BridgeLogger,
    });
    websockets.push(websocket);

    websocket.start();
    await connected;

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$proxied",
      kind: "message",
      text: "proxied",
    }));
    expect(handleTransaction).toHaveBeenCalledWith(expect.objectContaining({
      events: [expect.objectContaining({ event_id: "$proxied" })],
      txn_id: "txn-2",
    }));
  });

  it("reconnects with capped exponential backoff and resets after a stable connection", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    const log = vi.fn() as BridgeLogger;
    let connectionCount = 0;
    wsServer.on("connection", (socket) => {
      connectionCount++;
      if (connectionCount <= 4) {
        socket.close();
        return;
      }
      if (connectionCount === 5) {
        setTimeout(() => socket.close(), 35);
      }
    });
    const websocket = createWebsocket(homeserver, {
      log,
      timing: {
        initialReconnectMs: 5,
        maxReconnectMs: 20,
        pingIntervalMs: 1_000,
        pingTimeoutMs: 1_000,
        stableConnectionMs: 20,
      },
    });
    websockets.push(websocket);

    websocket.start();
    await waitFor(() => connectionCount >= 6);

    const reconnects = log.mock.calls
      .filter(([, event]) => event === "appservice_websocket_closed")
      .map(([, , data]) => (data as { reconnectMs: number }).reconnectMs);
    expect(reconnects).toEqual([5, 10, 20, 20, 5]);
  });

  it("reconnects when a websocket ping is not acknowledged", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    let connectionCount = 0;
    wsServer.on("connection", () => {
      connectionCount++;
    });
    const websocket = createWebsocket(homeserver, {
      timing: {
        initialReconnectMs: 5,
        maxReconnectMs: 10,
        pingIntervalMs: 5,
        pingTimeoutMs: 5,
        stableConnectionMs: 1_000,
      },
    });
    websockets.push(websocket);

    websocket.start();
    await waitFor(() => connectionCount >= 2);
  });

  it("does not reconnect after a replacement close command", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    const onClose = vi.fn();
    const onReplaced = vi.fn();
    let connectionCount = 0;
    wsServer.on("connection", (socket) => {
      connectionCount++;
      socket.send(JSON.stringify({ command: "disconnect", status: "conn_replaced" }));
    });
    const websocket = createWebsocket(homeserver, {
      onClose,
      onReplaced,
      timing: {
        initialReconnectMs: 5,
        maxReconnectMs: 10,
        pingIntervalMs: 1_000,
        pingTimeoutMs: 1_000,
        stableConnectionMs: 1_000,
      },
    });
    websockets.push(websocket);

    websocket.start();
    await waitFor(() => onReplaced.mock.calls.length > 0);
    await delay(30);

    expect(connectionCount).toBe(1);
    expect(onClose).toHaveBeenCalledWith(expect.objectContaining({
      reconnect: false,
      replaced: true,
      status: "conn_replaced",
    }));
    expect(onReplaced).toHaveBeenCalledWith(expect.objectContaining({
      replaced: true,
      status: "conn_replaced",
    }));
  });
});

function createWebsocket(
  homeserver: string,
  overrides: Partial<ConstructorParameters<typeof AppserviceWebsocket>[0]> = {}
): AppserviceWebsocket {
  return new AppserviceWebsocket({
    appservice: {
      homeserver,
      homeserverDomain: "example",
      registration: {
        asToken: "as-token",
        hsToken: "hs-token",
        id: "sh-dummy",
        namespaces: { users: [] },
        senderLocalpart: "dummybot",
        url: "",
      },
    },
    dispatch: vi.fn(async () => {}),
    log: (() => {}) as BridgeLogger,
    ...overrides,
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("timed out waiting for condition");
    await delay(5);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
