import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const defaultScript = resolve(
  here,
  "../../../../matrix-chat-sdk-private-e2e/src/create-beeper-account.js"
);
const script = process.env.MATRIX_CREATE_ACCOUNT_SCRIPT || defaultScript;

if (!existsSync(script)) {
  throw new Error(`Account creator not found: ${script}`);
}

const result = await run(script, [
  "--format",
  "json",
  "--timeout-ms",
  process.env.MATRIX_E2E_ACCOUNT_TIMEOUT_MS || "60000",
]);

const account = JSON.parse(result);
const lines = [
  `export MATRIX_HOMESERVER_URL=${shellQuote(account.baseUrl)}`,
  `export MATRIX_ACCESS_TOKEN=${shellQuote(account.accessToken)}`,
];
if (account.recoveryKey) {
  lines.push(`export MATRIX_RECOVERY_KEY=${shellQuote(account.recoveryKey)}`);
}
lines.push(`# bot_user_id=${account.userId}`);
process.stdout.write(`${lines.join("\n")}\n`);

function run(scriptPath, args) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: process.env,
      stdio: ["ignore", "pipe", "inherit"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolveOutput(stdout);
      else reject(new Error(`Account creator exited with ${code}`));
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
