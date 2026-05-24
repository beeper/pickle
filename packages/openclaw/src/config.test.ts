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

  it("accepts dashboard-derived bridge behavior settings", () => {
    expect(createDefaultConfig({
      backfillLimit: 25,
      baseDomain: "beeper-staging.com",
      beeperEnv: "staging",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry-token",
      asToken: "as-token",
      contactVisibility: "agents-and-users",
      dataDir: "/tmp/openclaw-bridge",
      gatewayAccessToken: "gateway-token",
      homeserverDomain: "beeper.local",
      importSources: ["dashboard", "tui"],
      approvalBehavior: "native",
      streamFinalization: "replace",
    })).toMatchObject({
      approvalBehavior: "native",
      backfillLimit: 25,
      baseDomain: "beeper-staging.com",
      beeperEnv: "staging",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry-token",
      asToken: "as-token",
      contactVisibility: "agents-and-users",
      gatewayAccessToken: "gateway-token",
      homeserverDomain: "beeper.local",
      importSources: ["dashboard", "tui"],
      streamFinalization: "replace",
    });
  });

  it("stores config with owner-only file permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-config-"));
    const path = join(dir, "config.json");
    const config = createDefaultConfig({ accessToken: "secret", asToken: "as-secret", dataDir: dir, gatewayAccessToken: "gateway-secret", homeserver: "https://matrix.example" });
    await writeConfig(config, path);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      accessToken: "secret",
      asToken: "as-secret",
      gatewayAccessToken: "gateway-secret",
      homeserver: "https://matrix.example",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(readConfig(path)).resolves.toMatchObject(config);
  });
});
