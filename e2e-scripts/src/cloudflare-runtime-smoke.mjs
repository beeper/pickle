import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = resolve(root, "e2e-scripts/.out/cloudflare-runtime-smoke");
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID ?? "2d6696feb60377216e949e7a39f904a1";
const name = process.env.BMJS_CLOUDFLARE_SMOKE_NAME ??
  `better-matrix-js-cf-smoke-${new Date().toISOString().replaceAll(/\D/g, "").slice(0, 14)}`;

await mkdir(outDir, { recursive: true });
const configPath = resolve(outDir, "wrangler.jsonc");
await writeFile(configPath, JSON.stringify({
  account_id: accountId,
  compatibility_date: "2026-04-24",
  durable_objects: {
    bindings: [
      { class_name: "MatrixStoreSmokeObject", name: "MATRIX_STORE_SMOKE" },
      { class_name: "MatrixSyncSmokeObject", name: "MATRIX_SYNC" },
    ],
  },
  main: "../../src/cloudflare-runtime-worker.mjs",
  migrations: [
    {
      new_sqlite_classes: ["MatrixStoreSmokeObject", "MatrixSyncSmokeObject"],
      tag: "v1",
    },
  ],
  name,
  vars: {
    MATRIX_SYNC_WEBHOOK_URL: "https://example.invalid/matrix/webhook",
    SMOKE_WEBHOOK_SECRET: "better-matrix-js-cloudflare-runtime-smoke",
  },
  workers_dev: true,
}, null, 2));

const deploy = run("pnpm", [
  "--dir",
  "examples/cloudflare-worker",
  "exec",
  "wrangler",
  "deploy",
  "--config",
  configPath,
]);
const workerUrl = deploy.stdout.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0];
assert.ok(workerUrl, `Could not find workers.dev URL in Wrangler output:\n${deploy.stdout}`);

const rootResponse = await getJson(workerUrl);
assert.deepEqual(rootResponse, { ok: true });

const cryptoResponse = await getJson(`${workerUrl}/crypto`);
assert.equal(cryptoResponse.payload.since, "before");
assert.equal(cryptoResponse.payload.response.next_batch, "cloudflare-smoke");
assert.equal(cryptoResponse.envelope.alg, "AES-GCM-256");

const storeResponse = await getJson(`${workerUrl}/store`);
assert.deepEqual(storeResponse.stored, [1, 3, 3, 7]);
assert.deepEqual(storeResponse.keys, ["runtime"]);
assert.equal(storeResponse.deleted, true);

const syncStatus = await getJson(`${workerUrl}/sync/status`);
assert.equal(syncStatus.enabled, false);

const syncStart = await postJson(`${workerUrl}/sync/start`);
assert.equal(syncStart.ok, true);
assert.equal(syncStart.status.enabled, true);
assert.match(syncStart.status.lastError, /MATRIX_SYNC_ACCESS_TOKEN|MATRIX_SYNC_HOMESERVER_URL/);

console.log(JSON.stringify({
  name,
  ok: true,
  workerUrl,
}, null, 2));

async function getJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  assert.equal(response.ok, true, `${url} failed: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}

async function postJson(url) {
  const response = await fetch(url, { method: "POST" });
  const text = await response.text();
  assert.equal(response.ok, true, `${url} failed: HTTP ${response.status} ${text}`);
  return JSON.parse(text);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: accountId,
    },
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result;
}
