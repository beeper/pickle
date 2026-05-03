import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const rootPath = join(dirname(fileURLToPath(import.meta.url)), "..");
const tempRoot = await mkdtemp(join(tmpdir(), "better-matrix-js-package-consumer-"));
const packDir = join(tempRoot, "packs");
const consumerDir = join(tempRoot, "consumer");

let passed = false;

try {
  if (!relative(rootPath, consumerDir).startsWith("..")) {
    throw new Error(`consumer directory must be outside the repo: ${consumerDir}`);
  }

  await mkdir(packDir, { recursive: true });
  await mkdir(consumerDir, { recursive: true });

  const corePackage = await readPackage(join(rootPath, "packages/core/package.json"));
  const cloudflarePackage = await readPackage(join(rootPath, "packages/cloudflare/package.json"));
  const adapterPackage = await readPackage(join(rootPath, "packages/chat-adapter/package.json"));

  const cloudflareTarball = await packPackage(cloudflarePackage.name, packDir);
  const coreTarball = await packPackage(corePackage.name, packDir);
  const adapterTarball = await packPackage(adapterPackage.name, packDir);

  const dependencies = {
    [cloudflarePackage.name]: `file:${cloudflareTarball}`,
    [corePackage.name]: `file:${coreTarball}`,
    [adapterPackage.name]: `file:${adapterTarball}`,
  };
  const overrides = {
    [cloudflarePackage.name]: `file:${cloudflareTarball}`,
    [corePackage.name]: `file:${coreTarball}`,
  };

  for (const dependencyName of Object.keys(adapterPackage.dependencies ?? {})) {
    if (dependencyName !== corePackage.name) {
      const spec = await installedPackageLink("packages/chat-adapter", dependencyName);
      dependencies[dependencyName] = spec;
      overrides[dependencyName] = spec;
    }
  }

  if (adapterPackage.peerDependencies?.chat) {
    dependencies.chat = await installedPackageLink("packages/chat-adapter", "chat");
  }

  await writeFile(
    join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "better-matrix-js-package-consumer-smoke",
        private: true,
        type: "module",
        dependencies,
        pnpm: {
          overrides,
        },
      },
      null,
      2
    )}\n`
  );

  await execFileAsync(
    "pnpm",
    ["install", "--offline", "--ignore-scripts", "--no-frozen-lockfile", "--reporter=append-only"],
    { cwd: consumerDir }
  );

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
        import * as core from "better-matrix-js";
        import * as beeperLogin from "better-matrix-js/beeper-login";
        import * as helpers from "better-matrix-js/helpers";
        import * as login from "better-matrix-js/login";
        import * as node from "better-matrix-js/node";
        import * as cloudflare from "@better-matrix-js/cloudflare";
        import * as adapter from "@better-matrix-js/chat-adapter";

        const checks = {
          core: ["createMatrixClient", "createMatrixLogin"].every((key) => key in core),
          beeperLogin: ["createBeeperLogin"].every((key) => key in beeperLogin),
          helpers: ["onMessage", "onReaction", "onInvite", "onRawEvent"].every((key) => key in helpers),
          login: ["createMatrixLogin"].every((key) => key in login),
          node: ["createMatrixClient"].every((key) => key in node),
          cloudflare: ["createCloudflareKVMatrixStore", "createDurableObjectMatrixStore", "MatrixSyncDurableObject"].every((key) => key in cloudflare),
          adapter: ["createMatrixAdapter", "MatrixAdapter", "MatrixFormatConverter"].every((key) => key in adapter),
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
  passed = true;
} finally {
  if (passed) {
    await rm(tempRoot, { recursive: true, force: true });
  } else {
    console.error(`Package consumer smoke temp directory preserved at ${tempRoot}`);
  }
}

async function readPackage(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function packPackage(packageName, destination) {
  const { stdout } = await execFileAsync(
    "pnpm",
    ["--filter", packageName, "pack", "--pack-destination", destination, "--json"],
    { cwd: rootPath }
  );
  const packResult = JSON.parse(stdout);
  return packResult.filename;
}

async function installedPackageLink(importerPath, packageName) {
  const packageJsonPath = join(rootPath, importerPath, "node_modules", packageName, "package.json");
  const packageDir = await realpath(dirname(packageJsonPath));
  return `link:${packageDir}`;
}
