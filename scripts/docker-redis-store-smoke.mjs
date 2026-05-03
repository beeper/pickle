import assert from "node:assert/strict";
import { Socket } from "node:net";
import { createMatrixStore } from "../packages/state-simple/dist/index.js";

const host = process.env.BMJS_E2E_REDIS_HOST ?? "127.0.0.1";
const port = Number(process.env.BMJS_E2E_REDIS_PORT ?? 6379);
const prefix = process.env.BMJS_E2E_REDIS_PREFIX ?? `bmjs:e2e:${Date.now()}:`;

async function eventually(label, fn, timeoutMs = 30000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

class RedisConnection {
  static connect(options) {
    const socket = new Socket();
    const connection = new RedisConnection(socket);
    return new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.connect(options.port, options.host, () => {
        socket.off("error", reject);
        socket.on("data", (chunk) => connection.push(chunk));
        socket.on("error", (error) => connection.fail(error));
        resolve(connection);
      });
    });
  }

  constructor(socket) {
    this.buffer = Buffer.alloc(0);
    this.pending = [];
    this.socket = socket;
  }

  command(...args) {
    return new Promise((resolve, reject) => {
      this.pending.push({ reject, resolve });
      this.socket.write(encodeCommand(args));
    });
  }

  close() {
    this.socket.destroy();
  }

  fail(error) {
    for (const pending of this.pending.splice(0)) {
      pending.reject(error);
    }
  }

  push(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.pending.length > 0) {
      const parsed = parseReply(this.buffer, 0);
      if (!parsed) {
        return;
      }
      this.buffer = this.buffer.subarray(parsed.offset);
      const pending = this.pending.shift();
      if (parsed.error) {
        pending.reject(parsed.error);
      } else {
        pending.resolve(parsed.value);
      }
    }
  }
}

function encodeCommand(args) {
  const chunks = [Buffer.from(`*${args.length}\r\n`)];
  for (const arg of args) {
    const value = arg instanceof Uint8Array ? Buffer.from(arg) : Buffer.from(String(arg));
    chunks.push(Buffer.from(`$${value.length}\r\n`), value, Buffer.from("\r\n"));
  }
  return Buffer.concat(chunks);
}

function parseReply(buffer, offset) {
  if (offset >= buffer.length) {
    return null;
  }
  const type = String.fromCharCode(buffer[offset]);
  if (type === "+") {
    const line = readLine(buffer, offset + 1);
    return line && { offset: line.offset, value: line.value };
  }
  if (type === "-") {
    const line = readLine(buffer, offset + 1);
    return line && { error: new Error(line.value), offset: line.offset };
  }
  if (type === ":") {
    const line = readLine(buffer, offset + 1);
    return line && { offset: line.offset, value: Number(line.value) };
  }
  if (type === "$") {
    const line = readLine(buffer, offset + 1);
    if (!line) {
      return null;
    }
    const length = Number(line.value);
    if (length < 0) {
      return { offset: line.offset, value: null };
    }
    const end = line.offset + length;
    if (buffer.length < end + 2) {
      return null;
    }
    return { offset: end + 2, value: new Uint8Array(buffer.subarray(line.offset, end)) };
  }
  if (type === "*") {
    const line = readLine(buffer, offset + 1);
    if (!line) {
      return null;
    }
    const length = Number(line.value);
    if (length < 0) {
      return { offset: line.offset, value: null };
    }
    const values = [];
    let cursor = line.offset;
    for (let index = 0; index < length; index += 1) {
      const parsed = parseReply(buffer, cursor);
      if (!parsed) {
        return null;
      }
      values.push(parsed.value instanceof Uint8Array ? new TextDecoder().decode(parsed.value) : parsed.value);
      cursor = parsed.offset;
    }
    return { offset: cursor, value: values };
  }
  throw new Error(`Unsupported Redis reply type ${type}`);
}

function readLine(buffer, offset) {
  const end = buffer.indexOf("\r\n", offset);
  if (end === -1) {
    return null;
  }
  return {
    offset: end + 2,
    value: buffer.subarray(offset, end).toString("utf8"),
  };
}

const redis = await RedisConnection.connect({ host, port });

try {
  await eventually("redis ping", async () => (await redis.command("PING")) === "PONG");
  const store = createMatrixStore({
    delete: (key) => redis.command("DEL", prefix + key),
    get: async (key) => {
      const value = await redis.command("GET", prefix + key);
      return value instanceof Uint8Array ? value : null;
    },
    list: async (keyPrefix) => {
      const keys = await redis.command("KEYS", prefix + keyPrefix + "*");
      assert.ok(Array.isArray(keys));
      return keys.map((key) => key.slice(prefix.length)).sort();
    },
    set: (key, value) => redis.command("SET", prefix + key, value),
  });

  const first = new Uint8Array([0, 1, 2, 253, 254, 255]);
  const second = new TextEncoder().encode("second value");
  await store.set("crypto/account", first);
  await store.set("crypto/session/1", second);
  await store.set("state/room", new Uint8Array([42]));

  assert.deepEqual(await store.get("crypto/account"), first);
  assert.deepEqual(await store.get("crypto/session/1"), second);
  assert.deepEqual(await store.list("crypto/"), ["crypto/account", "crypto/session/1"]);

  const fetched = await store.get("crypto/account");
  assert.ok(fetched);
  fetched[0] = 99;
  assert.deepEqual(await store.get("crypto/account"), first, "store reads must be defensive copies");

  await store.delete("crypto/account");
  assert.equal(await store.get("crypto/account"), null);
  assert.deepEqual(await store.list("crypto/"), ["crypto/session/1"]);

  console.log("redis store smoke passed");
} finally {
  const keys = await redis.command("KEYS", prefix + "*").catch(() => []);
  if (Array.isArray(keys) && keys.length > 0) {
    await redis.command("DEL", ...keys);
  }
  redis.close();
}
