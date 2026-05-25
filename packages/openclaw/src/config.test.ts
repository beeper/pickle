import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultConfig, createConfigFromOpenClawSetup, readConfig, writeConfig } from "./config";

describe("OpenClaw bridge config", () => {
  afterEach(() => {
    delete process.env.PICKLE_OPENCLAW_ALLOW_ROOMS;
    delete process.env.PICKLE_OPENCLAW_ALLOW_USERS;
    delete process.env.PICKLE_OPENCLAW_APPSERVICE_ID;
    delete process.env.PICKLE_OPENCLAW_APP_SERVICE_ID;
    delete process.env.PICKLE_OPENCLAW_BRIDGE_ID;
    delete process.env.PICKLE_OPENCLAW_DEVICE_ID;
    delete process.env.OPENCLAW_DEVICE_ID;
  });

  it("defaults to appservice-owned non-federated bridge settings", () => {
    const config = createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" });
    expect(config).toMatchObject({
      appserviceId: "sh-openclaw",
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

  it("derives the self-hosted Beeper bridge id from the OpenClaw device id environment", () => {
    process.env.PICKLE_OPENCLAW_DEVICE_ID = "OPENCLAW.DEV.123";
    expect(createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" })).toMatchObject({
      appserviceId: "sh-openclaw",
      bridgeId: "sh-openclaw-openclaw-dev-123",
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
      homeserverDomain: "beeper.local",
      importSources: ["dashboard", "tui"],
      streamFinalization: "replace",
    });
  });

  it("preserves dashboard bridge identity settings through OpenClaw setup config", () => {
    const config = createConfigFromOpenClawSetup({
      channels: {
        beeper: {
          appserviceId: "custom-openclaw",
          dataDir: "/tmp/openclaw-bridge",
          ghostLocalpartPrefix: "oc_agent_",
          senderLocalpart: "ocbot",
          serviceBotLocalpart: "ocservice",
          storePath: "/tmp/openclaw-store",
          userLocalpartPrefix: "oc_user_",
        },
      },
    });

    expect(config).toMatchObject({
      appserviceId: "custom-openclaw",
      dataDir: "/tmp/openclaw-bridge",
      ghostLocalpartPrefix: "oc_agent_",
      senderLocalpart: "ocbot",
      serviceBotLocalpart: "ocservice",
      storePath: "/tmp/openclaw-store",
      userLocalpartPrefix: "oc_user_",
    });
  });

  it("accepts manifest-advertised environment variables", () => {
    process.env.PICKLE_OPENCLAW_APP_SERVICE_ID = "manifest-openclaw";
    process.env.PICKLE_OPENCLAW_ALLOW_ROOMS = "!a:example.com, !b:example.com";
    process.env.PICKLE_OPENCLAW_ALLOW_USERS = "@alice:example.com,@bob:example.com";

    expect(createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" })).toMatchObject({
      allowedRoomIds: ["!a:example.com", "!b:example.com"],
      allowedUserIds: ["@alice:example.com", "@bob:example.com"],
      appserviceId: "manifest-openclaw",
    });

    process.env.PICKLE_OPENCLAW_APPSERVICE_ID = "legacy-openclaw";
    expect(createDefaultConfig({ dataDir: "/tmp/openclaw-bridge" }).appserviceId).toBe("legacy-openclaw");
  });


  it("stores config with owner-only file permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-config-"));
    const path = join(dir, "config.json");
    const config = createDefaultConfig({ accessToken: "secret", asToken: "as-secret", dataDir: dir, homeserver: "https://matrix.example" });
    await writeConfig(config, path);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      accessToken: "secret",
      asToken: "as-secret",
      homeserver: "https://matrix.example",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await expect(readConfig(path)).resolves.toMatchObject(config);
  });
});
