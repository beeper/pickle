import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli";

describe("pickle-openclaw CLI", () => {
  it("writes secure config and registration files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-cli-"));
    const configPath = join(dir, "config.json");
    const registrationPath = join(dir, "registration.json");
    const initIO = captureIO();
    await expect(runCli([
      "init",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--homeserver",
      "https://matrix.example",
      "--gateway-access-token",
      "gateway-secret",
      "--access-token",
      "secret",
    ], initIO)).resolves.toBe(0);
    expect(initIO.stdoutText).toContain('"accessToken": "<redacted>"');
    expect(initIO.stdoutText).toContain('"gatewayAccessToken": "<redacted>"');
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      accessToken: "secret",
      gatewayAccessToken: "gateway-secret",
      homeserver: "https://matrix.example",
    });
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);

    const registerIO = captureIO();
    await expect(runCli([
      "register",
      "--config",
      configPath,
      "--output",
      registrationPath,
      "--as-token",
      "as",
      "--hs-token",
      "hs",
    ], registerIO)).resolves.toBe(0);
    expect(registerIO.stdoutText.trim()).toBe(registrationPath);
    expect(JSON.parse(await readFile(registrationPath, "utf8"))).toMatchObject({
      as_token: "as",
      hs_token: "hs",
      id: "pickle-openclaw",
      sender_localpart: "openclawbot",
    });
    expect((await stat(registrationPath)).mode & 0o777).toBe(0o600);
  });

  it("reports unknown commands", async () => {
    const io = captureIO();
    await expect(runCli(["wat"], io)).resolves.toBe(2);
    expect(io.stderrText).toContain("Unknown command: wat");
  });

  it("starts the bridge from persisted Beeper account config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-start-"));
    const configPath = join(dir, "config.json");
    const io = captureIO();
    const startBridge = vi.fn(async () => undefined);
    await expect(runCli([
      "init",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--access-token",
      "mx-token",
      "--gateway-url",
      "http://127.0.0.1:29390",
      "--homeserver",
      "https://matrix.beeper.com",
      "--matrix-device-id",
      "DEVICE",
      "--matrix-user-id",
      "@batuhan:beeper.com",
    ], captureIO())).resolves.toBe(0);

    await expect(runCli(["start", "--config", configPath, "--get-only", "--backfill", "--backfill-limit", "25"], io, { startBridge })).resolves.toBe(0);

    expect(startBridge).toHaveBeenCalledWith(expect.objectContaining({
      account: {
        accessToken: "mx-token",
        deviceId: "DEVICE",
        homeserver: "https://matrix.beeper.com",
        userId: "@batuhan:beeper.com",
      },
      backfill: true,
      backfillLimit: 25,
      config: expect.objectContaining({
        gatewayUrl: "http://127.0.0.1:29390",
        matrixUserId: "@batuhan:beeper.com",
      }),
      getOnly: true,
    }));
    expect(io.stdoutText).toContain("OpenClaw bridge started");
  });

  it("calls arbitrary OpenClaw Gateway RPC methods from config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-rpc-"));
    const configPath = join(dir, "config.json");
    await expect(runCli([
      "init",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--gateway-url",
      "http://127.0.0.1:29390",
    ], captureIO())).resolves.toBe(0);
    const runtime = fakeRuntime({
      "config.schema.lookup": { path: ["agents"], type: "object" },
    });
    const io = captureIO();

    await expect(runCli([
      "rpc",
      "--config",
      configPath,
      "config.schema.lookup",
      "--params-json",
      "{\"path\":[\"agents\"]}",
    ], io, { runtimeFactory: () => runtime })).resolves.toBe(0);

    expect(runtime.call).toHaveBeenCalledWith("config.schema.lookup", { path: ["agents"] });
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(JSON.parse(io.stdoutText)).toEqual({ path: ["agents"], type: "object" });
  });

  it("prints an OpenClaw Gateway feature snapshot", async () => {
    const runtime = fakeRuntime({}, {
      agents: { agents: [] },
      status: { ok: true },
    });
    const io = captureIO();

    await expect(runCli(["features", "--gateway-url", "http://127.0.0.1:29390"], io, {
      runtimeFactory: () => runtime,
    })).resolves.toBe(0);

    expect(runtime.featureSnapshot).toHaveBeenCalledOnce();
    expect(runtime.close).toHaveBeenCalledOnce();
    expect(JSON.parse(io.stdoutText)).toEqual({
      agents: { agents: [] },
      status: { ok: true },
    });
  });

  it("runs Beeper setup from CLI and persists runtime bridge-manager settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-beeper-setup-"));
    const configPath = join(dir, "config.json");
    const io = captureIO();
    const setupBridge = vi.fn(async (options) => {
      expect(options).toMatchObject({
        baseDomain: "beeper-staging.com",
        bridgeManagerToken: "hungry-token",
        email: "batuhan@example.com",
        env: "staging",
        homeserverDomain: "beeper.local",
        postState: false,
      });
      expect(await options.getLoginCode?.()).toBe("123456");
      return {
        account: {
          accessToken: "mx-token",
          deviceId: "DEV",
          homeserver: "https://matrix.beeper-staging.com",
          userId: "@batuhan:beeper-staging.com",
        },
        config: {
          accessToken: "mx-token",
          appserviceId: "openclaw",
          homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
          hsToken: "hs",
          matrixDeviceId: "DEV",
          matrixUserId: "@batuhan:beeper-staging.com",
          registrationUrl: "http://127.0.0.1:29391",
        },
        init: {
          homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
          registration: { id: "openclaw", hsToken: "hs", url: "http://127.0.0.1:29391" },
        },
      } as never;
    });

    await expect(runCli([
      "beeper-setup",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--email",
      "batuhan@example.com",
      "--login-code",
      "123456",
      "--env",
      "staging",
      "--bridge-manager-token",
      "hungry-token",
      "--homeserver-domain",
      "beeper.local",
      "--no-post-state",
    ], io, { setupBridge })).resolves.toBe(0);

    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written).toMatchObject({
      accessToken: "mx-token",
      appserviceId: "openclaw",
      baseDomain: "beeper-staging.com",
      beeperEnv: "staging",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry-token",
      homeserver: "https://matrix.beeper-staging.com/_hungryserv/batuhan",
      homeserverDomain: "beeper.local",
      hsToken: "hs",
      matrixDeviceId: "DEV",
      matrixUserId: "@batuhan:beeper-staging.com",
    });
    expect(io.stdoutText).toContain('"bridgeManagerToken": "<redacted>"');
    expect(io.stdoutText).not.toContain("hungry-token");
  });

  it("prompts for Beeper login OTP in CLI setup when --login-code is omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-beeper-setup-prompt-"));
    const configPath = join(dir, "config.json");
    const io = captureIO("654321\n");
    const setupBridge = vi.fn(async (options) => {
      expect(await options.getLoginCode?.()).toBe("654321");
      return {
        account: {
          accessToken: "mx-token",
          deviceId: "DEV",
          homeserver: "https://matrix.beeper.com",
          userId: "@batuhan:beeper.com",
        },
        config: {
          accessToken: "mx-token",
          appserviceId: "openclaw",
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          hsToken: "hs",
          matrixDeviceId: "DEV",
          matrixUserId: "@batuhan:beeper.com",
          registrationUrl: "http://127.0.0.1:29391",
        },
        init: {
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          registration: { id: "openclaw", hsToken: "hs", url: "http://127.0.0.1:29391" },
        },
      } as never;
    });

    await expect(runCli([
      "beeper-setup",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--email",
      "batuhan@example.com",
    ], io, { setupBridge })).resolves.toBe(0);

    expect(setupBridge).toHaveBeenCalledOnce();
    expect(io.stderrText).toContain("Enter Beeper login code:");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      accessToken: "mx-token",
      matrixDeviceId: "DEV",
    });
  });

  it("prompts for Beeper login OTP in CLI login when --login-code is omitted", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-beeper-login-prompt-"));
    const configPath = join(dir, "config.json");
    const io = captureIO("111222\n");
    const loginToBeeper = vi.fn(async (options) => {
      expect(await options.getLoginCode?.()).toBe("111222");
      return {
        account: {
          accessToken: "mx-token",
          deviceId: "DEV",
          homeserver: "https://matrix.beeper.com",
          userId: "@batuhan:beeper.com",
        },
        config: {
          accessToken: "mx-token",
          homeserver: "https://matrix.beeper.com",
          matrixDeviceId: "DEV",
          matrixUserId: "@batuhan:beeper.com",
        },
      };
    });

    await expect(runCli([
      "beeper-login",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--email",
      "batuhan@example.com",
    ], io, { loginToBeeper })).resolves.toBe(0);

    expect(loginToBeeper).toHaveBeenCalledOnce();
    expect(io.stderrText).toContain("Enter Beeper login code:");
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      accessToken: "mx-token",
      matrixUserId: "@batuhan:beeper.com",
    });
  });

  it("runs Beeper appservice registration from CLI and preserves existing login config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-beeper-register-"));
    const configPath = join(dir, "config.json");
    await expect(runCli([
      "init",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--access-token",
      "mx-token",
      "--homeserver",
      "https://matrix.beeper.com",
    ], captureIO())).resolves.toBe(0);
    const createAppService = vi.fn(async (options) => {
      expect(options).toMatchObject({
        accessToken: "mx-token",
        address: "http://127.0.0.1:29391",
        bridgeManagerToken: "hungry-token",
        getOnly: true,
        homeserver: "https://matrix.beeper.com",
        postState: false,
        selfHosted: true,
      });
      return {
        config: {
          appserviceId: "openclaw",
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          hsToken: "hs",
          registrationUrl: "http://127.0.0.1:29391",
        },
        init: {
          homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
          registration: { id: "openclaw", hsToken: "hs", url: "http://127.0.0.1:29391" },
        },
      } as never;
    });
    const io = captureIO();

    await expect(runCli([
      "beeper-register",
      "--config",
      configPath,
      "--bridge-manager-token",
      "hungry-token",
      "--get-only",
      "--no-post-state",
    ], io, { createAppService })).resolves.toBe(0);

    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written).toMatchObject({
      accessToken: "mx-token",
      appserviceId: "openclaw",
      bridgeManagerPostState: false,
      bridgeManagerToken: "hungry-token",
      homeserver: "https://matrix.beeper.com/_hungryserv/batuhan",
      hsToken: "hs",
    });
    expect(io.stdoutText).toContain('"bridgeManagerToken": "<redacted>"');
    expect(io.stdoutText).not.toContain("hungry-token");
  });
});

function fakeRuntime(responses: Record<string, unknown>, snapshot: unknown = {}) {
  return {
    call: vi.fn(async (method: string) => responses[method]),
    close: vi.fn(async () => undefined),
    featureSnapshot: vi.fn(async () => snapshot),
  } as never;
}

function captureIO(stdinText?: string) {
  const io = {
    stderrText: "",
    stdoutText: "",
    stdin: stdinText === undefined ? undefined : Readable.from([stdinText]),
    stderr: {
      write(this: { owner: { stderrText: string } }, chunk: string) {
        this.owner.stderrText += chunk;
        return true;
      },
      owner: undefined as unknown as { stderrText: string },
    },
    stdout: {
      write(this: { owner: { stdoutText: string } }, chunk: string) {
        this.owner.stdoutText += chunk;
        return true;
      },
      owner: undefined as unknown as { stdoutText: string },
    },
  };
  io.stderr.owner = io;
  io.stdout.owner = io;
  return io;
}
