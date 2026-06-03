import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import extension, { openClawBeeperPlugin } from "./plugin-entry";

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
    expect(extension.kind).toBe("bundled-channel-entry");
    const loadedPlugin = extension.loadChannelPlugin();
    expect(loadedPlugin.id).toBe("beeper");
    expect(extension.loadChannelSecrets()).toMatchObject({
      secretTargetRegistryEntries: expect.arrayContaining([
        expect.objectContaining({ pathPattern: "channels.beeper.accounts.*.asToken" }),
        expect.objectContaining({ pathPattern: "channels.beeper.accounts.*.hsToken" }),
      ]),
    });
    const runtimeRegistration = resolveBundledRuntimeChannelRegistration(extension);
    expect(runtimeRegistration.id).toBe("beeper");
    expect(runtimeRegistration.plugin.id).toBe("beeper");
    expect(runtimeRegistration.plugin.setupWizard).toEqual(expect.any(Object));
    expect(registered).toHaveLength(1);
    const [registeredPlugin] = registered as Array<typeof loadedPlugin>;
    expect(registeredPlugin.id).toBe("beeper");
    expect(registeredPlugin.capabilities.reactions).toBe(true);
    expect(registeredPlugin.capabilities.threads).toBe(true);
    expect(registeredPlugin.message?.live?.capabilities.nativeStreaming).toBe(true);
    expect(registeredPlugin.messaging).toEqual(expect.any(Object));
    expect(registeredPlugin.setup).toEqual(expect.any(Object));
    expect(registeredPlugin.setupWizard).toEqual(expect.any(Object));
    expect(registeredPlugin.threading).toEqual(expect.any(Object));
  }, 60_000);

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
        channel?: {
          cliAddOptions?: Array<{ flags?: string; description?: string }>;
          configuredState?: { specifier?: string; exportName?: string };
          id?: string;
          persistedAuthState?: { specifier?: string; exportName?: string };
        };
        install?: { clawhubSpec?: string; defaultChoice?: string; npmSpec?: string };
        compat?: { pluginApi?: string };
      };
      peerDependencies?: { openclaw?: string };
      scripts?: Record<string, string>;
      version?: string;
    };
    const manifest = JSON.parse(await readFile(resolve("openclaw.plugin.json"), "utf8")) as {
      activation?: { onStartup?: boolean };
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
    expect(packageJson.files).not.toContain("skills");
    expect(packageJson.openclaw?.extensions).toEqual(["./src/plugin-entry.ts"]);
    expect(packageJson.openclaw?.runtimeExtensions).toEqual(["./dist/plugin-entry.mjs"]);
    expect(packageJson.openclaw?.setupEntry).toBe("./src/setup-entry.ts");
    expect(packageJson.openclaw?.runtimeSetupEntry).toBe("./dist/setup-entry.mjs");
    expect(packageJson.openclaw?.channel?.id).toBe("beeper");
    expect(packageJson.openclaw?.channel?.configuredState).toEqual({
      specifier: "./auth-presence",
      exportName: "hasAnyBeeperConfiguredState",
    });
    expect(packageJson.openclaw?.channel?.persistedAuthState).toEqual({
      specifier: "./auth-presence",
      exportName: "hasAnyBeeperAuth",
    });
    expect(packageJson.openclaw?.channel?.cliAddOptions).toEqual([
      {
        flags: "--server-env <env>",
        description: "Beeper server environment: prod, staging, dev, or local",
      },
    ]);
    expect(packageJson.openclaw?.install?.defaultChoice).toBe("clawhub");
    expect(packageJson.openclaw?.install?.clawhubSpec).toBe("clawhub:@beeper/openclaw");
    expect(packageJson.openclaw?.install?.npmSpec).toBe("@beeper/openclaw");
    expect(packageJson.openclaw?.compat?.pluginApi).toBe(">=2026.6.2");
    expect(packageJson.peerDependencies?.openclaw).toBe(">=2026.6.2");
    expect(packageJson.scripts?.prepublishOnly).toBe("node ../../scripts/guard-pnpm-publish.mjs");
    expect(packageJson.files).toContain("dist");
    expect(manifest).toEqual(expect.objectContaining({
      id: "beeper",
      channels: ["beeper"],
    }));
    expect(manifest.activation?.onStartup).toBe(false);
    expect(manifest.channelEnvVars).toBeUndefined();
    expect(manifest.uiHints).toBeUndefined();
    expect(manifest.configSchema).toEqual({
      type: "object",
      additionalProperties: false,
      properties: {},
    });
    expect(manifest.channelConfigs?.beeper?.schema).toEqual(schema);
    expect(manifest.configSchema?.properties).not.toHaveProperty("streamFinalization");
    expect(manifest.channelConfigs?.beeper).toMatchObject({
      commands: {
        nativeCommandsAutoEnabled: true,
        nativeSkillsAutoEnabled: true,
      },
      schema: {
        additionalProperties: false,
        properties: expect.objectContaining({
          accounts: expect.any(Object),
          agents: expect.any(Object),
          defaultAccount: expect.any(Object),
        }),
      },
      uiHints: expect.objectContaining({
        "accounts.*.asToken": expect.objectContaining({ sensitive: true, tags: ["hidden"] }),
        "accounts.*.hsToken": expect.objectContaining({ sensitive: true, tags: ["hidden"] }),
        "accounts.*.serverEnv": expect.objectContaining({
          help: expect.stringContaining("Choose before Beeper login"),
        }),
      }),
    });
    expect(manifest.channelConfigs?.beeper?.schema?.properties).not.toHaveProperty("asToken");
    expect(manifest.channelConfigs?.beeper?.schema?.properties).not.toHaveProperty("hsToken");
    expect(manifest.channelConfigs?.beeper?.schema?.properties).not.toHaveProperty("serverEnv");
    expect(manifest.channelConfigs?.beeper?.schema?.properties?.accounts).toMatchObject({
      additionalProperties: {
        properties: {
          asToken: expect.any(Object),
          bridge: expect.any(Object),
          hsToken: expect.any(Object),
          serverEnv: expect.objectContaining({ enum: ["prod", "staging", "dev", "local"] }),
        },
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
      ["@beeper/pickle-ag-ui", "workspace:^"],
      ["@beeper/pickle-bridge", "workspace:^"],
      ["@beeper/pickle-state-file", "workspace:^"],
    ]));
    expect(devDependencies.some(([name]) => name === "@beeper/pickle")).toBe(false);
    expect(devDependencies.find(([, version]) => version === "workspace:*")).toBeUndefined();
  });
});

function resolveBundledRuntimeChannelRegistration(moduleExport: unknown): { id?: string; plugin?: unknown } {
  const resolved = unwrapDefaultModuleExport(moduleExport);
  if (!resolved || typeof resolved !== "object") return {};
  const entry = resolved as {
    id?: unknown;
    loadChannelPlugin?: () => unknown;
  };
  if (
    typeof entry.id !== "string" ||
    typeof entry.loadChannelPlugin !== "function"
  ) {
    return {};
  }
  return {
    id: entry.id,
    plugin: entry.loadChannelPlugin(),
  };
}

function unwrapDefaultModuleExport(value: unknown): unknown {
  if (value && typeof value === "object" && "default" in value) {
    return (value as { default?: unknown }).default;
  }
  return value;
}
