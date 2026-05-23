import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const packagesDir = join(root, "packages");
const packages = await readdir(packagesDir, { withFileTypes: true });
const failures = [];

for (const entry of packages) {
  if (!entry.isDirectory()) {
    continue;
  }
  const packageDir = join(packagesDir, entry.name);
  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  const sourceDir = join(packageDir, "src");
  for (const file of await sourceFiles(sourceDir)) {
    const source = await readFile(file, "utf8");
    const imports = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((match) => match[1]);
    for (const specifier of imports) {
      if (specifier === "./index" || specifier === `${packageJson.name}`) {
        failures.push(`${relative(root, file)} imports ${specifier}`);
      }
    }
  }
}

const aiPackage = JSON.parse(await readFile(join(packagesDir, "ai-sdk/package.json"), "utf8"));
if (aiPackage.dependencies?.ai || aiPackage.peerDependencies?.ai) {
  failures.push("@beeper/pickle-ai-sdk must not require Vercel AI SDK at runtime");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

async function sourceFiles(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...await sourceFiles(file));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      result.push(file);
    }
  }
  return result;
}
