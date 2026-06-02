import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaPath = resolve(packageDir, "src/beeper-channel-config.schema.json");
const manifestPath = resolve(packageDir, "openclaw.plugin.json");

const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

manifest.configSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
};
delete manifest.uiHints;
manifest.channelConfigs ??= {};
manifest.channelConfigs.beeper ??= {};
manifest.channelConfigs.beeper.schema = schema;
manifest.channelConfigs.beeper.uiHints = {
  "accounts.*.asToken": { sensitive: true, tags: ["hidden"] },
  "accounts.*.hsToken": { sensitive: true, tags: ["hidden"] },
  "accounts.*.serverEnv": {
    help: "Choose before Beeper login. To change it after connecting, log out and log back in.",
  },
};

await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
