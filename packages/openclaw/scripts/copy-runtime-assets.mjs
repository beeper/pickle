import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pickleDist = resolve(packageDir, "../pickle/dist");
const outputDir = resolve(packageDir, "dist");

await mkdir(outputDir, { recursive: true });

for (const file of ["pickle.wasm", "wasm_exec.js"]) {
  const source = resolve(pickleDist, file);
  try {
    await stat(source);
  } catch {
    throw new Error(`Missing ${file}; run pnpm --filter @beeper/pickle build before building @beeper/pickle-openclaw`);
  }
  await copyFile(source, resolve(outputDir, file));
}
