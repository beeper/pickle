import WebSocket from "ws";
import type { MatrixAppserviceInitOptions, MatrixClientEvent } from "@beeper/pickle";
import type { BridgeLogger } from "./types";

export interface AppserviceWebsocketOptions {
  appservice: MatrixAppserviceInitOptions;
  dispatch(event: MatrixClientEvent): Promise<unknown>;
  handleHTTPProxy?(request: HTTPProxyRequest): Promise<HTTPProxyResponse | null>;
  handleTransaction?(transaction: Record<string, unknown>): Promise<unknown>;
  log: BridgeLogger;
  onClose?(event: AppserviceWebsocketCloseEvent): void | Promise<void>;
  onOpen?(): void | Promise<void>;
  onReplaced?(event: AppserviceWebsocketCloseEvent): void | Promise<void>;
  timing?: Partial<AppserviceWebsocketTimingOptions>;
}

export interface AppserviceWebsocketCloseEvent {
  code?: number;
  reason?: string;
  reconnect: boolean;
  replaced: boolean;
  status?: string;
}

export interface AppserviceWebsocketTimingOptions {
  initialReconnectMs: number;
  maxReconnectMs: number;
  pingIntervalMs: number;
  pingTimeoutMs: number;
  stableConnectionMs: number;
}

export class AppserviceWebsocket {
  static readonly defaultTiming: AppserviceWebsocketTimingOptions = {
    initialReconnectMs: 2_000,
    maxReconnectMs: 120_000,
    pingIntervalMs: 180_000,
    pingTimeoutMs: 30_000,
    stableConnectionMs: 60_000,
  };

  readonly #appservice: MatrixAppserviceInitOptions;
  readonly #dispatch: (event: MatrixClientEvent) => Promise<unknown>;
  readonly #handleProxy: ((request: HTTPProxyRequest) => Promise<HTTPProxyResponse | null>) | undefined;
  readonly #handleTransaction: ((transaction: Record<string, unknown>) => Promise<unknown>) | undefined;
  readonly #log: BridgeLogger;
  readonly #onClose: ((event: AppserviceWebsocketCloseEvent) => void | Promise<void>) | undefined;
  readonly #onOpen: (() => void | Promise<void>) | undefined;
  readonly #onReplaced: ((event: AppserviceWebsocketCloseEvent) => void | Promise<void>) | undefined;
  readonly #timing: AppserviceWebsocketTimingOptions;
  #closed = false;
  #nextPingId = 1;
  #pendingPingId: number | null = null;
  #pingIntervalTimer: NodeJS.Timeout | null = null;
  #pingTimeoutTimer: NodeJS.Timeout | null = null;
  #reconnectMs: number;
  #reconnectTimer: NodeJS.Timeout | null = null;
  #handledCloses = new WeakSet<WebSocket>();
  #socket: WebSocket | null = null;
  #stableTimer: NodeJS.Timeout | null = null;

  constructor(options: AppserviceWebsocketOptions) {
    this.#appservice = options.appservice;
    this.#dispatch = options.dispatch;
    this.#handleProxy = options.handleHTTPProxy;
    this.#handleTransaction = options.handleTransaction;
    this.#log = options.log;
    this.#onClose = options.onClose;
    this.#onOpen = options.onOpen;
    this.#onReplaced = options.onReplaced;
    this.#timing = { ...AppserviceWebsocket.defaultTiming, ...options.timing };
    this.#reconnectMs = this.#timing.initialReconnectMs;
  }

  start(): void {
    this.#closed = false;
    this.#clearReconnectTimer();
    this.#connect();
  }

  stop(): void {
    this.#closed = true;
    this.#clearReconnectTimer();
    this.#clearConnectionTimers();
    this.#socket?.close();
    this.#socket = null;
  }

  #connect(): void {
    if (this.#closed) return;
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
      this.#clearConnectionTimers();
      this.#pingIntervalTimer = setInterval(() => this.#ping(), this.#timing.pingIntervalMs);
      this.#stableTimer = setTimeout(() => {
        this.#reconnectMs = this.#timing.initialReconnectMs;
        this.#log("debug", "appservice_websocket_stable", { reconnectMs: this.#reconnectMs });
      }, this.#timing.stableConnectionMs);
      void Promise.resolve(this.#onOpen?.()).catch((error: unknown) => {
        this.#log("warn", "appservice_websocket_open_handler_failed", { error });
      });
    });
    socket.on("message", (data) => {
      void this.#handleMessage(data).catch((error: unknown) => {
        this.#log("error", "appservice_websocket_message_failed", { error });
      });
    });
    socket.on("close", (code, reason) => {
      this.#handleSocketClose(socket, { code, reason: reason.toString() });
    });
    socket.on("error", (error) => {
      this.#log("warn", "appservice_websocket_error", { error });
    });
  }

  #handleSocketClose(socket: WebSocket, close: { code?: number; reason?: string; replaced?: boolean; status?: string }): void {
    if (this.#handledCloses.has(socket)) return;
    this.#handledCloses.add(socket);
    this.#clearConnectionTimers();
    if (this.#socket === socket) this.#socket = null;
    const status = close.status ?? closeStatusFromReason(close.reason);
    const replaced = close.replaced ?? (close.code === 4001 || status === "conn_replaced");
    const reconnect = !this.#closed && !replaced;
    const event: AppserviceWebsocketCloseEvent = {
      reconnect,
      replaced,
    };
    if (close.code !== undefined) event.code = close.code;
    if (close.reason !== undefined) event.reason = close.reason;
    if (status !== undefined) event.status = status;
    if (replaced) this.#closed = true;
    void Promise.resolve(this.#onClose?.(event)).catch((error: unknown) => {
      this.#log("warn", "appservice_websocket_close_handler_failed", { error });
    });
    if (replaced) {
      void Promise.resolve(this.#onReplaced?.(event)).catch((error: unknown) => {
        this.#log("warn", "appservice_websocket_replaced_handler_failed", { error });
      });
    }
    if (this.#closed || !reconnect) return;
    const reconnectMs = this.#reconnectMs;
    this.#reconnectMs = Math.min(this.#reconnectMs * 2, this.#timing.maxReconnectMs);
    this.#log("warn", "appservice_websocket_closed", {
      code: close.code,
      reconnectMs,
      reason: close.reason ?? "",
      status,
    });
    this.#reconnectTimer = setTimeout(() => this.#connect(), reconnectMs);
  }

  #clearConnectionTimers(): void {
    if (this.#pingIntervalTimer) clearInterval(this.#pingIntervalTimer);
    if (this.#pingTimeoutTimer) clearTimeout(this.#pingTimeoutTimer);
    if (this.#stableTimer) clearTimeout(this.#stableTimer);
    this.#pendingPingId = null;
    this.#pingIntervalTimer = null;
    this.#pingTimeoutTimer = null;
    this.#stableTimer = null;
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
  }

  #closeFromCommand(message: WebsocketMessage): boolean {
    const status = stringValue(message.status) ?? stringValue(objectValue(message.data)?.status);
    const replaced = message.command === "replaced" || status === "conn_replaced";
    if (message.command !== "close" && message.command !== "disconnect" && !replaced) return false;
    const socket = this.#socket;
    if (!socket) return true;
    this.#log("warn", "appservice_websocket_close_command", { command: message.command, replaced, status });
    if (replaced) {
      this.#closed = true;
      const reason = JSON.stringify({ command: message.command ?? "disconnect", status: status ?? "conn_replaced" });
      socket.close(4001, reason);
      this.#handleSocketClose(socket, { code: 4001, reason, replaced, status: status ?? "conn_replaced" });
      return true;
    }
    socket.close();
    return true;
  }

  #handlePingResponse(message: WebsocketMessage): boolean {
    if ((message.command !== "response" && message.command !== "error") || message.id !== this.#pendingPingId) return false;
    if (this.#pingTimeoutTimer) clearTimeout(this.#pingTimeoutTimer);
    this.#pendingPingId = null;
    this.#pingTimeoutTimer = null;
    return true;
  }

  async #handleMessage(data: WebSocket.RawData): Promise<void> {
    const message = JSON.parse(data.toString()) as WebsocketMessage;
    this.#log("debug", "appservice_websocket_message", {
      command: message.command ?? "transaction",
      eventCount: message.events?.length,
      id: message.id,
      txnId: message.txn_id,
    });
    try {
      if (this.#closeFromCommand(message)) return;
      if (this.#handlePingResponse(message)) return;
      if (message.command === "connect") return;
      if (message.command === "ping") {
        this.#send(messageResponse(message, true, message.data ?? { timestamp: Date.now() }));
        return;
      }
      if (message.command === "response" || message.command === "error") return;
      if (!message.command || message.command === "transaction") {
        await this.#handleTransaction?.(message as Record<string, unknown>);
        for (const raw of message.events ?? []) {
          const event = rawMatrixEvent(raw);
          this.#log("debug", "appservice_websocket_transaction_event", {
            eventId: raw.event_id,
            roomId: raw.room_id,
            sender: raw.sender,
            type: raw.type,
          });
          if (event) await this.#dispatch(event);
        }
        this.#send(messageResponse(message, true, { txn_id: message.txn_id }));
        return;
      }
      if (message.command === "http_proxy") {
        const response = await this.#handleHTTPProxy(message.data);
        this.#log("debug", "appservice_websocket_http_proxy_response", { id: message.id, status: response.status });
        this.#send(messageResponse(message, true, response));
        return;
      }
      this.#send(messageResponse(message, false, { code: "M_UNKNOWN", message: `unknown websocket command ${message.command}` }));
    } catch (error: unknown) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.#log("error", "appservice_websocket_message_failed", { error: messageText, id: message.id });
      this.#send(messageResponse(message, false, { code: "M_UNKNOWN", message: messageText }));
    }
  }

  async #handleHTTPProxy(data: unknown): Promise<HTTPProxyResponse> {
    const request = data as HTTPProxyRequest;
    this.#log("debug", "appservice_websocket_http_proxy_request", {
      method: request.method ?? "GET",
      path: request.path ?? "",
    });
    const handled = await this.#handleProxy?.(request);
    if (handled) return handled;
    const path = request.path ?? "";
    const method = request.method ?? "GET";
    const transactionMatch = /^\/?_matrix\/app\/v1\/transactions\/([^/]+)$/.exec(path);
    if (method === "PUT" && transactionMatch) {
      const transaction = objectValue(request.body) ?? {};
      const events = Array.isArray(transaction.events) ? transaction.events : [];
      this.#log("debug", "appservice_websocket_http_transaction", {
        eventCount: events.length,
        txnId: transactionMatch[1],
      });
      await this.#handleTransaction?.(transaction);
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
    if (this.#pendingPingId !== null) {
      this.#log("warn", "appservice_websocket_ping_stale", { id: this.#pendingPingId });
      this.#socket?.terminate();
      return;
    }
    const id = this.#nextPingId++;
    if (!this.#send({
      command: "ping",
      data: { timestamp: Date.now() },
      id,
    })) return;
    this.#pendingPingId = id;
    this.#pingTimeoutTimer = setTimeout(() => {
      this.#log("warn", "appservice_websocket_ping_timeout", { id });
      this.#socket?.terminate();
    }, this.#timing.pingTimeoutMs);
  }

  send(command: string, data: unknown): boolean {
    return this.#send({ command, data });
  }

  #send(message: WebsocketRequest | null): boolean {
    if (!message || this.#socket?.readyState !== WebSocket.OPEN) return false;
    this.#socket.send(JSON.stringify(message));
    return true;
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
  status?: string;
  txn_id?: string;
}

export interface HTTPProxyRequest {
  body?: unknown;
  escaped_path?: boolean;
  headers?: Record<string, string[]>;
  method?: string;
  path?: string;
  query?: string;
}

export interface HTTPProxyResponse {
  body?: unknown;
  headers: Record<string, string[]>;
  status: number;
}

interface RawMatrixEvent {
  [key: string]: unknown;
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
  if (message.id === undefined || message.id === null || message.command === "response" || message.command === "error") return null;
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

function closeStatusFromReason(reason: string | undefined): string | undefined {
  if (!reason) return undefined;
  try {
    return stringValue((JSON.parse(reason) as { status?: unknown }).status);
  } catch {
    return undefined;
  }
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
