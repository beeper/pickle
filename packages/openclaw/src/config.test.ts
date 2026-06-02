import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createConfigFromOpenClawSetup, readConfig, writeConfig } from "./config";

describe("OpenClaw bridge config", () => {
  afterEach(() => {
    delete process.env.PICKLE_OPENCLAW_BEEPER_ENV;
    delete process.env.PICKLE_OPENCLAW_DEVICE_ID;
    delete process.env.PICKLE_OPENCLAW_HS_TOKEN;
    delete process.env.OPENCLAW_DEVICE_ID;
  });

  it("defaults to appservice-owned non-federated bridge settings", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" });
    expect(config).toMatchObject({
      appserviceId: "sh-openclaw",
      dataDir: "/tmp/openclaw-bridge",
    });
  });

  it("derives the self-hosted Beeper bridge id from the OpenClaw device id environment", () => {
    process.env.PICKLE_OPENCLAW_DEVICE_ID = "OPENCLAW.DEV.123";
    expect(createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" })).toMatchObject({
      appserviceId: "sh-openclaw-openclaw-dev-123",
      bridgeId: "sh-openclaw-openclaw-dev-123",
    });
  });

  it("accepts saved login and registration state from OpenClaw config", () => {
    expect(createDefaultConfig({
      beeperEnv: "staging",
      asToken: "as-token",
      dataDir: "/tmp/openclaw-bridge",
      homeserverDomain: "beeper.local",
    })).toMatchObject({
      beeperEnv: "staging",
      asToken: "as-token",
      homeserverDomain: "beeper.local",
    });
  });

  it("preserves dashboard bridge identity settings through OpenClaw setup config", () => {
    const config = createConfigFromOpenClawSetup({
      channels: {
        beeper: {
          appserviceId: "custom-openclaw",
          dataDir: "/tmp/openclaw-bridge",
        },
      },
    });

    expect(config).toMatchObject({
      appserviceId: "custom-openclaw",
      dataDir: "/tmp/openclaw-bridge",
    });
  });

  it("accepts only Beeper environment and OpenClaw device id from environment variables", () => {
    process.env.PICKLE_OPENCLAW_BEEPER_ENV = "staging";
    process.env.PICKLE_OPENCLAW_DEVICE_ID = "openclaw.device";
    process.env.PICKLE_OPENCLAW_HS_TOKEN = "ignored";

    expect(createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" })).toMatchObject({
      appserviceId: "sh-openclaw-openclaw-device",
      beeperEnv: "staging",
      bridgeId: "sh-openclaw-openclaw-device",
    });
    expect(createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" }).hsToken).toBeUndefined();
  });


  it("stores config with owner-only file permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-config-"));
    const path = join(dir, "config.json");
    const config = createDefaultConfig({ asToken: "as-secret", dataDir: dir, homeserver: "https://matrix.example", hsToken: "hs-secret" });
    await writeConfig(config, path);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      asToken: "as-secret",
      homeserver: "https://matrix.example",
      hsToken: "hs-secret",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(readConfig(path)).resolves.toMatchObject(config);
  });
});
