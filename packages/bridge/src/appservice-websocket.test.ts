import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocketServer } from "ws";
import { AppserviceWebsocket } from "./appservice-websocket";
import type { BridgeLogger } from "./types";

const servers: Array<{ close(callback?: (error?: Error) => void): void }> = [];

afterEach(async () => {
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
    const websocket = new AppserviceWebsocket({
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
      dispatch,
      log: (() => {}) as BridgeLogger,
    });

    websocket.start();
    await connected;
    websocket.stop();

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
    const websocket = new AppserviceWebsocket({
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
      dispatch,
      log: (() => {}) as BridgeLogger,
    });

    websocket.start();
    await connected;
    websocket.stop();

    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "$proxied",
      kind: "message",
      text: "proxied",
    }));
  });
});
