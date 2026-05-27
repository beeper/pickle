import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
    expect(extension.channelPlugin).toBe(registered[0]);
    expect(resolveBundledRuntimeChannelRegistration(extension)).toMatchObject({
      id: "beeper",
      plugin: expect.objectContaining({
        id: "beeper",
        setupWizard: expect.any(Object),
      }),
    });
    expect(registered).toEqual([
      expect.objectContaining({
        capabilities: expect.objectContaining({
          reactions: true,
          threads: true,
        }),
        id: "beeper",
        message: expect.objectContaining({
          live: expect.objectContaining({
            capabilities: expect.objectContaining({ nativeStreaming: true }),
          }),
        }),
        messaging: expect.any(Object),
        setup: expect.any(Object),
        setupWizard: expect.any(Object),
        threading: expect.any(Object),
      }),
    ]);
  });

  it("honors SDK channel registration modes", () => {
    const registerChannel = vi.fn();
    openClawBeeperPlugin.register({
      registerChannel,
      registrationMode: "cli-metadata",
    } as never);
    expect(registerChannel).not.toHaveBeenCalled();

    openClawBeeperPlugin.register({
      registerChannel,
      registrationMode: "discovery",
      runtime: { marker: "runtime" },
    } as never);
    expect(registerChannel).toHaveBeenCalledTimes(1);
    expect(registerChannel).toHaveBeenCalledWith({
      plugin: expect.objectContaining({ id: "beeper" }),
    });
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
      scripts?: Record<string, string>;
      version?: string;
    };
    const manifest = JSON.parse(await readFile(resolve("openclaw.plugin.json"), "utf8")) as {
      id?: string;
      channels?: string[];
      channelConfigs?: Record<string, {
        commands?: Record<string, unknown>;
        schema?: { properties?: Record<string, unknown> };
        uiHints?: Record<string, { sensitive?: boolean }>;
      }>;
      configSchema?: {
        properties?: Record<string, unknown>;
      };
      uiHints?: Record<string, { sensitive?: boolean }>;
      channelEnvVars?: Record<string, string[]>;
    };
    const schema = JSON.parse(await readFile(resolve("src/beeper-channel-config.schema.json"), "utf8"));

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
    expect(packageJson.openclaw?.compat?.pluginApi).toBe(">=2026.5.22");
    expect(packageJson.peerDependencies?.openclaw).toBe(">=2026.5.22");
    expect(packageJson.scripts?.prepublishOnly).toBe("node ../../scripts/guard-pnpm-publish.mjs");
    expect(packageJson.files).toContain("dist");
    expect(manifest).toEqual(expect.objectContaining({ id: "beeper", channels: ["beeper"] }));
    expect(manifest.channelEnvVars?.beeper).toContain("PICKLE_OPENCLAW_DEVICE_ID");
    expect(manifest.channelEnvVars?.beeper).not.toContain("PICKLE_OPENCLAW_GATEWAY_ACCESS_TOKEN");
    expect(manifest.channelEnvVars?.beeper).not.toContain("OPENCLAW_GATEWAY_TOKEN");
    expect(manifest.uiHints).toMatchObject({
      accessToken: { sensitive: true },
      asToken: { sensitive: true },
      bridgeManagerToken: { sensitive: true },
      hsToken: { sensitive: true },
    });
    expect(Object.keys(manifest.configSchema?.properties ?? {}).sort()).toEqual([
      "accessToken",
      "allowedRoomIds",
      "allowedUserIds",
      "approvalBehavior",
      "appserviceId",
      "asToken",
      "backfillLimit",
      "beeperEnv",
      "bridgeId",
      "bridgeManagerToken",
      "contactVisibility",
      "dataDir",
      "enabled",
      "homeserver",
      "homeserverDomain",
      "hsToken",
      "importSources",
      "matrixDeviceId",
      "matrixUserId",
    ]);
    expect(manifest.configSchema).toEqual(schema);
    expect(manifest.channelConfigs?.beeper?.schema).toEqual(schema);
    expect(manifest.configSchema?.properties).not.toHaveProperty("streamFinalization");
    expect(manifest.channelConfigs?.beeper).toMatchObject({
      commands: {
        nativeCommandsAutoEnabled: true,
        nativeSkillsAutoEnabled: true,
      },
      schema: {
        properties: expect.objectContaining({
          accessToken: expect.any(Object),
          importSources: expect.any(Object),
        }),
      },
      uiHints: {
        accessToken: { sensitive: true },
      },
    });
  });

  it("keeps the public package manifest publishable and installable from built files", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8")) as {
      bin?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      files?: string[];
      main?: string;
      openclaw?: {
        runtimeExtensions?: string[];
        runtimeSetupEntry?: string;
      };
    };
    const npmIgnore = await readFile(resolve(".npmignore"), "utf8");
    const dependencies = Object.entries(packageJson.dependencies ?? {});
    const devDependencies = Object.entries(packageJson.devDependencies ?? {});

    expect(packageJson.files).toContain("dist");
    expect(npmIgnore.split(/\r?\n/)).toEqual(expect.arrayContaining([
      "src",
      "!dist",
      "!dist/**",
    ]));
    expect(packageJson.main).toBe("./dist/plugin-entry.mjs");
    expect(packageJson.bin?.["pickle-openclaw"]).toBe("./dist/cli.mjs");
    expect(packageJson.openclaw?.runtimeExtensions).toEqual(["./dist/plugin-entry.mjs"]);
    expect(packageJson.openclaw?.runtimeSetupEntry).toBe("./dist/setup-entry.mjs");
    expect(dependencies).toEqual([]);
    expect(devDependencies).toEqual(expect.arrayContaining([
      ["@beeper/pickle", "workspace:^"],
      ["@beeper/pickle-ag-ui", "workspace:^"],
      ["@beeper/pickle-bridge", "workspace:^"],
      ["@beeper/pickle-state-file", "workspace:^"],
    ]));
    expect(devDependencies.find(([, version]) => version === "workspace:*")).toBeUndefined();
  });
});

function resolveBundledRuntimeChannelRegistration(moduleExport: unknown): { id?: string; plugin?: unknown } {
  const resolved = unwrapDefaultModuleExport(moduleExport);
  if (!resolved || typeof resolved !== "object") return {};
  const entry = resolved as {
    id?: unknown;
    channelPlugin?: unknown;
  };
  if (
    typeof entry.id !== "string" ||
    !entry.channelPlugin
  ) {
    return {};
  }
  return {
    id: entry.id,
    plugin: entry.channelPlugin,
  };
}

function unwrapDefaultModuleExport(value: unknown): unknown {
  if (value && typeof value === "object" && "default" in value) {
    return (value as { default?: unknown }).default;
  }
  return value;
}
