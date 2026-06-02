import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const crabpotDir = resolve(process.env.CRABPOT_DIR ?? resolve(root, "..", "crabpot"));

if (!await exists(resolve(crabpotDir, "package.json"))) {
  console.error(`Missing Crabpot checkout at ${crabpotDir}`);
  console.error("");
  console.error("Set it up with:");
  console.error("  git clone https://github.com/openclaw/crabpot.git ../crabpot");
  console.error("  npm --prefix ../crabpot install");
  console.error("  npm --prefix ../crabpot test");
  console.error("");
  console.error("Crabpot also expects an OpenClaw checkout at ../openclaw by default.");
  console.error("Override the Crabpot location with CRABPOT_DIR=/path/to/crabpot.");
  process.exit(1);
}

console.log(`Running OpenClaw plugin compatibility tests in ${crabpotDir}`);
const child = spawn("npm", ["run", "check"], {
  cwd: crabpotDir,
  env: process.env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Crabpot check terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});

child.on("error", (error) => {
  console.error(`Failed to run Crabpot check: ${error.message}`);
  process.exit(1);
});

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
