import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageDir, "src/beeper-channel-config.schema.json");
const manifestPath = resolve(packageDir, "openclaw.plugin.json");

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.configSchema = schema;
manifest.channelConfigs ??= {};
manifest.channelConfigs.beeper ??= {};
manifest.channelConfigs.beeper.schema = schema;

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
