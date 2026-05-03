import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const root = new URL("..", import.meta.url);
const rootPath = root.pathname;
const temp = await mkdtemp(join(tmpdir(), "pickle-consumer-"));
const packDir = join(temp, "packs");
const consumerDir = join(temp, "consumer");

await mkdirp(packDir);
await execFileAsync("pnpm", ["-r", "--filter", "./packages/*", "pack", "--pack-destination", packDir], {
  cwd: rootPath,
});
await execFileAsync("npm", ["init", "-y"], { cwd: await mkdirp(consumerDir) });

const coreTarball = join(packDir, "beeper-pickle-0.1.0.tgz");
const cloudflareTarball = join(packDir, "beeper-pickle-cloudflare-0.1.0.tgz");
const adapterTarball = join(packDir, "beeper-pickle-chat-adapter-0.1.0.tgz");

await execFileAsync("npm", ["install", coreTarball, cloudflareTarball, adapterTarball, "chat@4.26.0"], {
  cwd: consumerDir,
});

const { stdout } = await execFileAsync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    `
      import * as core from "@beeper/pickle";
      import * as node from "@beeper/pickle/node";
      import * as cf from "@beeper/pickle-cloudflare";
      import * as adapter from "@beeper/pickle-chat-adapter";
      const checks = {
        core: ["createMatrixClient", "createMatrixLogin"].every((key) => key in core),
        node: ["createMatrixClient"].every((key) => key in node),
        cloudflare: ["createCloudflareKVMatrixStore", "createDurableObjectMatrixStore", "MatrixSyncDurableObject"].every((key) => key in cf),
        adapter: ["createMatrixAdapter"].every((key) => key in adapter),
      };
      if (!Object.values(checks).every(Boolean)) {
        throw new Error(JSON.stringify(checks));
      }
      console.log(JSON.stringify(checks));
    `,
  ],
  { cwd: consumerDir }
);

console.log(stdout.trim());

async function mkdirp(path) {
  await import("node:fs/promises").then(({ mkdir }) => mkdir(path, { recursive: true }));
  return path;
}
