import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootPath = new URL("..", import.meta.url).pathname;
const temp = await mkdtemp(join(tmpdir(), "better-matrix-js-worker-"));
const packDir = join(temp, "packs");
const workerDir = join(temp, "worker");
const srcDir = join(workerDir, "src");

await mkdir(packDir, { recursive: true });
await execFileAsync(
  "pnpm",
  ["-r", "--filter", "better-matrix-js", "--filter", "@better-matrix-js/cloudflare", "pack", "--pack-destination", packDir],
  { cwd: rootPath }
);
await mkdir(srcDir, { recursive: true });
await execFileAsync("npm", ["init", "-y"], { cwd: workerDir });
await execFileAsync("npm", [
  "install",
  join(packDir, "better-matrix-js-0.1.0.tgz"),
  join(packDir, "better-matrix-js-cloudflare-0.1.0.tgz"),
], { cwd: workerDir });

await writeFile(
  join(srcDir, "index.js"),
  `
import "better-matrix-js/wasm_exec.js";
import wasmModule from "better-matrix-js/matrix-core.wasm";
import { createMatrixClient } from "better-matrix-js";
import {
  createDurableObjectMatrixStore,
  MatrixSyncDurableObject,
} from "@better-matrix-js/cloudflare";

export class MatrixClientObject {
  constructor(state) {
    this.state = state;
    this.corePromise = null;
  }

  async fetch() {
    this.corePromise ??= Promise.resolve(createMatrixClient({
      homeserver: "https://matrix.example.org",
      token: "smoke-token",
      store: createDurableObjectMatrixStore(this.state.storage, {
        prefix: "matrix/default/",
      }),
      wasmModule,
    }));
    const core = await this.corePromise;
    return Response.json({ ok: Boolean(core) });
  }
}

export class MatrixSyncObject extends MatrixSyncDurableObject {}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const binding = url.pathname.startsWith("/matrix/sync")
      ? env.MATRIX_SYNC
      : env.MATRIX_CLIENT;
    return binding.get(binding.idFromName("default")).fetch(request);
  },
};
`.trimStart()
);

await writeFile(
  join(workerDir, "wrangler.jsonc"),
  JSON.stringify(
    {
      name: "better-matrix-js-smoke",
      main: "src/index.js",
      compatibility_date: "2026-04-24",
      durable_objects: {
        bindings: [
          { class_name: "MatrixClientObject", name: "MATRIX_CLIENT" },
          { class_name: "MatrixSyncObject", name: "MATRIX_SYNC" },
        ],
      },
      migrations: [
        {
          new_classes: ["MatrixClientObject", "MatrixSyncObject"],
          tag: "v1",
        },
      ],
    },
    null,
    2
  )
);

const { stdout } = await execFileAsync(
  "npx",
  ["--yes", "wrangler@latest", "deploy", "--dry-run", "--outdir", "bundled"],
  { cwd: workerDir }
);
console.log(stdout.trim());

if (process.env.CI) {
  console.log("Skipping local Worker HTTP boot in CI after successful Wrangler dry run.");
  process.exit(0);
}

const wrangler = spawn(
  "npx",
  ["--yes", "wrangler@latest", "dev", "--local", "--ip", "127.0.0.1", "--port", "8791"],
  { cwd: workerDir, stdio: ["pipe", "pipe", "pipe"] }
);

let output = "";
wrangler.stdout.on("data", (chunk) => {
  output += chunk;
});
wrangler.stderr.on("data", (chunk) => {
  output += chunk;
});

const response = await waitForHttp("http://127.0.0.1:8791/", 30_000);
const body = await response.text();
const statusResponse = await fetch("http://127.0.0.1:8791/matrix/sync/status");
const statusBody = await statusResponse.text();
wrangler.kill("SIGTERM");
await waitForExit(wrangler);

if (!response.ok || body !== '{"ok":true}') {
  throw new Error(`Unexpected Worker response ${response.status}: ${body}`);
}
if (!statusResponse.ok || statusBody !== '{"enabled":false,"retryMs":0}') {
  throw new Error(`Unexpected Worker sync status ${statusResponse.status}: ${statusBody}`);
}

console.log(body);
console.log(statusBody);

async function waitFor(predicate, timeoutMs) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      wrangler.kill("SIGTERM");
      throw new Error(`Timed out waiting for Worker dev server:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function waitForHttp(url, timeoutMs) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started <= timeoutMs) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  wrangler.kill("SIGTERM");
  throw new Error(`Timed out waiting for Worker HTTP server: ${lastError}\n${output}`);
}

async function waitForExit(child) {
  await new Promise((resolve, reject) => {
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else if (code === null) {
        resolve();
      } else {
        reject(new Error(`wrangler dev exited with ${code}:\n${output}`));
      }
    });
  });
}
