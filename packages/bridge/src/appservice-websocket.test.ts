import { createServer } from "node:http";
import { AddressInfo } from "node:net";
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

  it("handles http_proxy appservice transaction requests", async () => {
    const httpServer = createServer();
    const wsServer = new WebSocketServer({ server: httpServer });
    servers.push(wsServer, httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const homeserver = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}/_hungryserv/alice`;
    const dispatch = vi.fn(async () => {});
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
