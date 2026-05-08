#!/usr/bin/env node
import { resolve } from "node:path";
import { createDefaultConfig, defaultConfigPath, readConfig, writeConfig } from "./config";
import { generateRegistration, writeRegistration } from "./registration";
import { PicklePiAgent } from "./appservice";

async function main(argv: string[]): Promise<void> {
  const command = argv[2] ?? "help";
  if (command === "init") {
    const config = createDefaultConfig();
    await writeConfig(config);
    console.log(`Wrote ${defaultConfigPath(config.dataDir)}`);
    return;
  }
  if (command === "register") {
    const config = await readConfig().catch(() => createDefaultConfig());
    const out = resolve(argv[3] ?? config.dataDir, "registration.json");
    await writeRegistration(out, generateRegistration(config));
    console.log(`Wrote ${out}`);
    return;
  }
  if (command === "status") {
    const config = await readConfig().catch(() => createDefaultConfig());
    console.log(JSON.stringify({ appserviceId: config.appserviceId, dataDir: config.dataDir }, null, 2));
    return;
  }
  if (command === "start") {
    const agent = await PicklePiAgent.create();
    await agent.start();
    console.log("pickle-pi-agent started");
    return;
  }
  console.log("Usage: pickle-pi-agent <init|register [path]|start|status>");
}

main(process.argv).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
