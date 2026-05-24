import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import extension, { openClawBeeperPlugin } from "./openclaw-extension";

describe("OpenClaw plugin package metadata", () => {
  it("exports a loadable OpenClaw plugin object", () => {
    const registered: unknown[] = [];
    openClawBeeperPlugin.register({
      registerChannel(registration) {
        registered.push(registration.plugin);
      },
      channels: {
        register(plugin) {
          registered.push(plugin);
        },
      },
    });
    expect(extension.id).toBe("beeper");
    expect(registered).toEqual([
      expect.objectContaining({
        capabilities: expect.objectContaining({
          reactions: true,
          threads: true,
        }),
        id: "beeper",
        setup: expect.any(Object),
        setupWizard: expect.any(Object),
      }),
      expect.objectContaining({
        id: "beeper",
      }),
    ]);
  });

  it("declares ClawHub install metadata and a package manifest", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      files?: string[];
      openclaw?: {
        extensions?: string[];
        runtimeExtensions?: string[];
        setupEntry?: string;
        runtimeSetupEntry?: string;
        channel?: { id?: string };
        install?: { clawhubSpec?: string; defaultChoice?: string; npmSpec?: string };
        compat?: { pluginApi?: string };
      };
      peerDependencies?: { openclaw?: string };
      version?: string;
    };
    const manifest = JSON.parse(await readFile(resolve("openclaw.plugin.json"), "utf8")) as {
      id?: string;
      channels?: string[];
      configSchema?: {
        properties?: Record<string, unknown>;
      };
      uiHints?: Record<string, { sensitive?: boolean }>;
    };

    expect(packageJson.files).toContain("openclaw.plugin.json");
    expect(packageJson.openclaw?.extensions).toEqual(["./src/plugin-entry.ts"]);
    expect(packageJson.openclaw?.runtimeExtensions).toEqual(["./dist/plugin-entry.mjs"]);
    expect(packageJson.openclaw?.setupEntry).toBe("./src/setup-entry.ts");
    expect(packageJson.openclaw?.runtimeSetupEntry).toBe("./dist/setup-entry.mjs");
    expect(packageJson.openclaw?.channel?.id).toBe("beeper");
    expect(packageJson.openclaw?.install?.defaultChoice).toBe("clawhub");
    expect(packageJson.openclaw?.install?.clawhubSpec).toBe(
      `clawhub:@beeper/pickle-openclaw@${packageJson.version}`,
    );
    expect(packageJson.openclaw?.install?.npmSpec).toBe(
      `@beeper/pickle-openclaw@${packageJson.version}`,
    );
    expect(packageJson.openclaw?.compat?.pluginApi).toBe(">=2026.5.24");
    expect(packageJson.peerDependencies?.openclaw).toBe(">=2026.5.24");
    expect(manifest).toEqual(expect.objectContaining({ id: "beeper", channels: ["beeper"] }));
    expect(manifest.uiHints).toMatchObject({
      accessToken: { sensitive: true },
      asToken: { sensitive: true },
      bridgeManagerToken: { sensitive: true },
      gatewayAccessToken: { sensitive: true },
      hsToken: { sensitive: true },
    });
    expect(Object.keys(manifest.configSchema?.properties ?? {}).sort()).toEqual([
      "accessToken",
      "allowedRoomIds",
      "allowedUserIds",
      "approvalBehavior",
      "asToken",
      "backfillLimit",
      "baseDomain",
      "beeperEnv",
      "bridgeManagerPostState",
      "bridgeManagerToken",
      "contactVisibility",
      "dataDir",
      "enabled",
      "gatewayAccessToken",
      "gatewayUrl",
      "homeserver",
      "homeserverDomain",
      "hsToken",
      "importSources",
      "matrixDeviceId",
      "matrixUserId",
      "nonFederatedRooms",
      "registrationUrl",
      "streamFinalization",
    ]);
  });
});
