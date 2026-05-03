import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { ACCOUNTS_PATH, SDK_ROOT } from "./config.mjs";

const accountIndex = Number(process.env.MATRIX_E2E_BROWSER_ACCOUNT_INDEX ?? 0);
const port = Number(process.env.MATRIX_E2E_BROWSER_PORT ?? 8765);
const account = JSON.parse(await readFile(ACCOUNTS_PATH, "utf8")).accounts[accountIndex];

if (!account) {
  throw new Error(`No browser smoke account at index ${accountIndex}; add reusable sessions to ${ACCOUNTS_PATH}.`);
}

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>better-matrix-js browser smoke</title>
    <script src="/sdk/packages/core/dist/wasm_exec.js"></script>
  </head>
  <body>
    <main>
      <h1>better-matrix-js browser smoke</h1>
      <pre id="status">starting</pre>
    </main>
    <script type="importmap">
      {
        "imports": {
          "better-matrix-js": "/sdk/packages/core/dist/index.js"
        }
      }
    </script>
    <script type="module">
      import { createMatrixClient } from "/sdk/packages/core/dist/index.js";
      import { createMatrixLogin } from "/sdk/packages/core/dist/login.js";
      import { createIndexedDBMatrixStore } from "/sdk/packages/state-indexeddb/dist/index.js";

      const account = ${JSON.stringify(account)};
      const status = document.querySelector("#status");
      const params = new URLSearchParams(location.search);
      const mode = params.get("mode") ?? "fresh";
      const sessionKey = "better-matrix-js-browser-session-" + account.username;
      const historyKey = "better-matrix-js-browser-history-" + account.username;
      const log = (message, data) => {
        status.textContent += "\\n" + message + (data ? " " + JSON.stringify(data) : "");
      };
      const finish = (ok, data) => {
        window.__BMJS_BROWSER_SMOKE__ = { mode, ok, ...data };
        document.body.dataset.result = ok ? "ok" : "fail";
        log(ok ? "PASS" : "FAIL", { mode, ...data });
      };

      async function loginFreshDevice() {
        return createMatrixLogin({
          homeserver: account.homeserverUrl,
          initialDeviceDisplayName: "better-matrix-js browser smoke " + mode
        }).token({
          token: account.loginToken,
          type: "org.matrix.login.jwt"
        });
      }

      function readSession() {
        const raw = localStorage.getItem(sessionKey);
        return raw ? JSON.parse(raw) : null;
      }

      async function createClient(session) {
        const wasmBytes = await (await fetch("/sdk/packages/core/dist/matrix-core.wasm")).arrayBuffer();
        return createMatrixClient({
          account: session,
          recoveryKey: account.recoveryKey,
          store: createIndexedDBMatrixStore({ databaseName: "better-matrix-js-browser-smoke-" + account.username + "-" + session.deviceId }),
          wasmBytes
        });
      }

      try {
        if (mode === "clear") {
          localStorage.removeItem(sessionKey);
          localStorage.removeItem(historyKey);
          finish(true, { cleared: true });
        } else {
          let session = readSession();
          if (!session || mode === "fresh" || mode === "new-device-history") {
            log("login-start", { userId: account.userId });
            session = await loginFreshDevice();
            if (mode !== "new-device-history") {
              localStorage.setItem(sessionKey, JSON.stringify(session));
            }
            log("login-ok", { deviceId: session.deviceId });
          } else {
            log("session-reuse", { deviceId: session.deviceId });
          }

          const client = await createClient(session);
          const debugSub = await client.subscribe({}, (event) => {
            if (event.kind === "crypto" || event.kind === "decryption") {
              log("event", event);
            }
          }, { live: false });
          const whoami = await client.boot();
          const crypto = await client.crypto.status();
          if (whoami.userId !== account.userId) {
            throw new Error("whoami mismatch: " + whoami.userId + " !== " + account.userId);
          }
          if (crypto.state === "disabled") {
            throw new Error("crypto disabled");
          }

          let history = JSON.parse(localStorage.getItem(historyKey) || "null");
          if (mode === "fresh" || !history) {
            const room = await client.rooms.create({
              initialState: [{
                content: { algorithm: "m.megolm.v1.aes-sha2" },
                stateKey: "",
                type: "m.room.encryption"
              }],
              name: "better-matrix-js browser smoke " + Date.now(),
              preset: "private_chat"
            });
            const sent = await client.messages.send({
              roomId: room.roomId,
              text: "browser encrypted history " + Date.now()
            });
            history = { eventId: sent.eventId, roomId: room.roomId };
            localStorage.setItem(historyKey, JSON.stringify(history));
            log("history-created", history);
          }

          const fetched = await client.messages.get({
            eventId: history.eventId,
            roomId: history.roomId
          });
          if (!fetched.message?.encrypted) {
            const rawFetched = await client.raw.request({
              method: "GET",
              path: "/_matrix/client/v3/rooms/" + encodeURIComponent(history.roomId) + "/event/" + encodeURIComponent(history.eventId)
            });
            log("raw-fetched", rawFetched.body);
            const sessionId = rawFetched.body?.content?.session_id;
            if (sessionId) {
              const backupFetched = await client.raw.request({
                method: "GET",
                path: "/_matrix/client/v3/room_keys/keys/" + encodeURIComponent(history.roomId) + "/" + encodeURIComponent(sessionId),
                query: { version: "1" }
              });
              log("backup-fetched", { status: backupFetched.status, body: backupFetched.body });
            }
          }
          debugSub.stop();
          await client.close();
          if (!fetched.message?.encrypted) {
            throw new Error("expected encrypted fetched message: " + JSON.stringify(fetched));
          }
          finish(true, {
            cryptoState: crypto.state,
            deviceId: whoami.deviceId,
            fetchedEventId: fetched.message.eventId,
            fetchedText: fetched.message.text,
            historyRoomId: history.roomId,
            storeBacked: crypto.storeBacked,
            userId: whoami.userId
          });
        }
      } catch (error) {
        finish(false, { error: error?.stack ?? error?.message ?? String(error) });
      }
    </script>
  </body>
</html>`;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(html);
    return;
  }
  if (url.pathname.startsWith("/sdk/")) {
    const relative = normalize(url.pathname.slice("/sdk/".length));
    if (relative.startsWith("..")) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    const file = join(SDK_ROOT, relative);
    response.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).on("error", () => {
      response.writeHead(404);
      response.end("not found");
    }).pipe(response);
    return;
  }
  response.writeHead(404);
  response.end("not found");
});

server.listen(port, "127.0.0.1", () => {
  console.log(`browser smoke server http://127.0.0.1:${port}`);
});
