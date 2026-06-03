import { access, readFile, readdir } from "node:fs/promises";
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
  if (!await exists(join(packageDir, "package.json"))) {
    continue;
  }
  const packageJson = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  if (!packageJson.private) {
    await auditPublishManifest(packageJson, packageDir);
  }
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

const aguiPackage = JSON.parse(await readFile(join(packagesDir, "ag-ui/package.json"), "utf8"));
if (aguiPackage.dependencies?.ai || aguiPackage.peerDependencies?.ai) {
  failures.push("@beeper/pickle-ag-ui must not require Vercel AI SDK at runtime");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function auditPublishManifest(packageJson, packageDir) {
  const packagePath = relative(root, join(packageDir, "package.json"));
  const requiredFields = ["name", "version", "description", "license", "type", "exports", "files", "publishConfig"];
  for (const field of requiredFields) {
    if (packageJson[field] === undefined) {
      failures.push(`${packagePath} missing ${field}`);
    }
  }

  const packageDirectory = relative(root, packageDir);
  if (packageJson.repository?.type !== "git") {
    failures.push(`${packagePath} missing repository.type=git`);
  }
  if (packageJson.repository?.url !== "git+https://github.com/beeper/pickle.git") {
    failures.push(`${packagePath} missing repository.url`);
  }
  if (packageJson.repository?.directory !== packageDirectory) {
    failures.push(`${packagePath} missing repository.directory=${packageDirectory}`);
  }
  if (packageJson.publishConfig?.access !== "public") {
    failures.push(`${packagePath} missing publishConfig.access=public`);
  }
  if (!packageJson.files?.includes("README.md")) {
    failures.push(`${packagePath} files missing README.md`);
  } else if (!await exists(join(packageDir, "README.md"))) {
    failures.push(`${packagePath} lists README.md but the file is missing`);
  }
  if (!packageJson.files?.includes("LICENSE")) {
    failures.push(`${packagePath} files missing LICENSE`);
  } else if (!await exists(join(packageDir, "LICENSE"))) {
    failures.push(`${packagePath} lists LICENSE but the file is missing`);
  }
  if (packageJson.scripts?.prepublishOnly !== "node ../../scripts/guard-pnpm-publish.mjs"
    && packageJson.scripts?.prepublishOnly !== "node ../../scripts/guard-pnpm-publish.mjs && pnpm build") {
    failures.push(`${packagePath} missing workspace publish guard`);
  }
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
