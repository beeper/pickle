import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createDefaultConfig, readConfig, writeConfig } from "./config";

describe("OpenClaw bridge config", () => {
  it("defaults to appservice-owned non-federated bridge settings", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" });
    expect(config).toMatchObject({
      appserviceId: "pickle-openclaw",
      dataDir: "/tmp/openclaw-bridge",
      ghostLocalpartPrefix: "openclaw_agent_",
      nonFederatedRooms: true,
      registrationUrl: "http://127.0.0.1:29391",
      senderLocalpart: "openclawbot",
      serviceBotLocalpart: "openclawbot",
      storePath: "/tmp/openclaw-bridge/matrix-store",
      userLocalpartPrefix: "openclaw_user_",
    });
  });

  it("stores config with owner-only file permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-config-"));
    const path = join(dir, "config.json");
    const config = createDefaultConfig({ accessToken: "secret", dataDir: dir, homeserver: "https://matrix.example" });
    await writeConfig(config, path);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      accessToken: "secret",
      homeserver: "https://matrix.example",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(readConfig(path)).resolves.toMatchObject(config);
  });
});
