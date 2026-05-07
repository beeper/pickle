import WebSocket from "ws";
import type { MatrixAppserviceInitOptions, MatrixClientEvent } from "@beeper/pickle";
import type { BridgeLogger } from "./types";

export interface AppserviceWebsocketOptions {
  appservice: MatrixAppserviceInitOptions;
  dispatch(event: MatrixClientEvent): Promise<unknown>;
  log: BridgeLogger;
}

export class AppserviceWebsocket {
  readonly #appservice: MatrixAppserviceInitOptions;
  readonly #dispatch: (event: MatrixClientEvent) => Promise<unknown>;
  readonly #log: BridgeLogger;
  #closed = false;
  #pingTimer: NodeJS.Timeout | null = null;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #socket: WebSocket | null = null;

  constructor(options: AppserviceWebsocketOptions) {
    this.#appservice = options.appservice;
    this.#dispatch = options.dispatch;
    this.#log = options.log;
  }

  start(): void {
    this.#closed = false;
    this.#connect();
  }

  stop(): void {
    this.#closed = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    this.#reconnectTimer = null;
    this.#pingTimer = null;
    this.#socket?.close();
    this.#socket = null;
  }

  #connect(): void {
    const url = websocketURL(this.#appservice.homeserver);
    const socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.#appservice.registration.asToken}`,
        "User-Agent": "@beeper/pickle-bridge",
        "X-Mautrix-Process-ID": `${process.pid}`,
        "X-Mautrix-Websocket-Version": "3",
      },
    });
    this.#socket = socket;
    socket.on("open", () => {
      this.#log("info", "appservice_websocket_open", { url });
      this.#pingTimer = setInterval(() => this.#ping(), 180_000);
    });
    socket.on("message", (data) => {
      void this.#handleMessage(data).catch((error: unknown) => {
        this.#log("error", "appservice_websocket_message_failed", { error });
      });
    });
    socket.on("close", (code, reason) => {
      if (this.#pingTimer) clearInterval(this.#pingTimer);
      this.#pingTimer = null;
      this.#socket = null;
      if (this.#closed) return;
      this.#log("warn", "appservice_websocket_closed", { code, reason: reason.toString() });
      this.#reconnectTimer = setTimeout(() => this.#connect(), 2_000);
    });
    socket.on("error", (error) => {
      this.#log("warn", "appservice_websocket_error", { error });
    });
  }

  async #handleMessage(data: WebSocket.RawData): Promise<void> {
    const message = JSON.parse(data.toString()) as WebsocketMessage;
    if (message.command === "connect") return;
    if (message.command === "ping") {
      this.#send(messageResponse(message, true, message.data ?? { timestamp: Date.now() }));
      return;
    }
    if (!message.command || message.command === "transaction") {
      for (const raw of message.events ?? []) {
        const event = rawMatrixEvent(raw);
        if (event) await this.#dispatch(event);
      }
      this.#send(messageResponse(message, true, { txn_id: message.txn_id }));
      return;
    }
    if (message.command === "http_proxy") {
      this.#send(messageResponse(message, true, await this.#handleHTTPProxy(message.data)));
      return;
    }
    this.#send(messageResponse(message, false, { code: "M_UNKNOWN", message: `unknown websocket command ${message.command}` }));
  }

  async #handleHTTPProxy(data: unknown): Promise<HTTPProxyResponse> {
    const request = data as HTTPProxyRequest;
    const path = request.path ?? "";
    const method = request.method ?? "GET";
    const transactionMatch = /^\/?_matrix\/app\/v1\/transactions\/([^/]+)$/.exec(path);
    if (method === "PUT" && transactionMatch) {
      const transaction = objectValue(request.body) ?? {};
      const events = Array.isArray(transaction.events) ? transaction.events : [];
      for (const raw of events) {
        const event = rawMatrixEvent(raw as RawMatrixEvent);
        if (event) await this.#dispatch(event);
      }
      return jsonHTTPResponse(200, {});
    }
    if (method === "GET" && /^\/?_matrix\/app\/v1\/users\//.test(path)) {
      return jsonHTTPResponse(200, {});
    }
    if (method === "GET" && /^\/?_matrix\/app\/v1\/rooms\//.test(path)) {
      return jsonHTTPResponse(404, { errcode: "M_NOT_FOUND", error: "Room alias not handled by this bridge" });
    }
    return jsonHTTPResponse(404, { errcode: "M_NOT_FOUND", error: `Unhandled appservice websocket proxy request: ${method} ${path}` });
  }

  #ping(): void {
    this.#send({
      command: "ping",
      data: { timestamp: Date.now() },
      id: Date.now(),
    });
  }

  #send(message: WebsocketRequest | null): void {
    if (!message || this.#socket?.readyState !== WebSocket.OPEN) return;
    this.#socket.send(JSON.stringify(message));
  }
}

interface WebsocketRequest {
  command: string;
  data: unknown;
  id?: number;
}

interface WebsocketMessage {
  command?: string;
  data?: unknown;
  events?: RawMatrixEvent[];
  id?: number;
  txn_id?: string;
}

interface HTTPProxyRequest {
  body?: unknown;
  escaped_path?: boolean;
  headers?: Record<string, string[]>;
  method?: string;
  path?: string;
  query?: string;
}

interface HTTPProxyResponse {
  body?: unknown;
  headers: Record<string, string[]>;
  status: number;
}

interface RawMatrixEvent {
  content?: Record<string, unknown>;
  event_id?: string;
  origin_server_ts?: number;
  redacts?: string;
  room_id?: string;
  sender?: string;
  state_key?: string;
  type?: string;
  unsigned?: Record<string, unknown>;
}

function messageResponse(message: WebsocketMessage, ok: boolean, data: unknown): WebsocketRequest | null {
  if (!message.id || message.command === "response" || message.command === "error") return null;
  return {
    command: ok ? "response" : "error",
    data,
    id: message.id,
  };
}

function jsonHTTPResponse(status: number, body: unknown): HTTPProxyResponse {
  return {
    body,
    headers: { "content-type": ["application/json"] },
    status,
  };
}

function websocketURL(homeserver: string): string {
  const url = new URL(homeserver);
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
  url.pathname = joinPath(url.pathname, "_matrix/client/unstable/fi.mau.as_sync");
  return url.toString();
}

function joinPath(base: string, suffix: string): string {
  return `${base.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

function rawMatrixEvent(raw: RawMatrixEvent): MatrixClientEvent | null {
  const type = raw.type ?? "";
  const content = raw.content ?? {};
  const roomId = raw.room_id;
  const eventId = raw.event_id;
  const senderId = raw.sender;
  const sender = senderId ? { isMe: false, userId: senderId } : undefined;
  if (type === "m.room.message" && roomId && eventId && sender) {
    return stripUndefined({
      attachments: [],
      class: "message",
      content,
      edited: false,
      encrypted: false,
      eventId,
      kind: "message",
      messageType: stringValue(content.msgtype) ?? "m.text",
      raw,
      roomId,
      sender,
      text: stringValue(content.body) ?? "",
      timestamp: raw.origin_server_ts,
      type,
      unsigned: raw.unsigned,
    }) as MatrixClientEvent;
  }
  if (type === "m.reaction" && roomId && eventId && sender) {
    const relates = objectValue(content["m.relates_to"]);
    return stripUndefined({
      added: true,
      class: "message",
      content,
      eventId,
      key: stringValue(relates?.key) ?? "",
      kind: "reaction",
      raw,
      relatesTo: stringValue(relates?.event_id) ?? "",
      roomId,
      sender,
      timestamp: raw.origin_server_ts,
      type,
      unsigned: raw.unsigned,
    }) as MatrixClientEvent;
  }
  if (type === "m.room.redaction" && roomId) {
    return genericEvent("redaction", raw, content);
  }
  if (type === "m.typing") {
    return genericEvent("typing", raw, content);
  }
  return genericEvent("raw", raw, content);
}

function genericEvent(kind: "raw" | "redaction" | "typing", raw: RawMatrixEvent, content: Record<string, unknown>): MatrixClientEvent {
  const event = {
    class: kind === "typing" ? "ephemeral" : "unknown",
    content,
    eventId: raw.event_id,
    kind,
    raw,
    roomId: raw.room_id,
    sender: raw.sender ? { isMe: false, userId: raw.sender } : undefined,
    timestamp: raw.origin_server_ts,
    type: raw.type ?? "",
    unsigned: raw.unsigned,
  };
  return stripUndefined(event) as MatrixClientEvent;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  for (const key of Object.keys(value)) {
    if (value[key] === undefined) delete value[key];
  }
  return value;
}
