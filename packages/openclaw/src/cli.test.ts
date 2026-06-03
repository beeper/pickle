import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "./cli";

describe("pickle-openclaw CLI", () => {
  it("only exposes Beeper login and whoami commands", async () => {
    const helpIO = captureIO();
    await expect(runCli(["--help"], helpIO)).resolves.toBe(0);
    expect(helpIO.stdoutText).toContain("login");
    expect(helpIO.stdoutText).toContain("whoami");
    expect(helpIO.stdoutText).toContain("--server-env <prod|staging|dev|local>");
    expect(helpIO.stdoutText).not.toContain("beeper-login");
    expect(helpIO.stdoutText).not.toContain("beeper-register");
    expect(helpIO.stdoutText).not.toContain("rpc");
    expect(helpIO.stdoutText).not.toContain("smoke");

    const unknownIO = captureIO();
    await expect(runCli(["rpc"], unknownIO)).resolves.toBe(2);
    expect(unknownIO.stderrText).toContain("Unknown command: rpc");
    expect(unknownIO.stderrText).not.toContain("OPENCLAW_GATEWAY_TOKEN");
  });

  it("logs in to Beeper, registers the appservice, and writes a secure config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-login-"));
    const configPath = join(dir, "config.json");
    const setupBridge = vi.fn(async () => ({
      account: {
        accessToken: "mx-token",
        deviceId: "DEVICE",
        homeserver: "https://matrix.beeper.com",
        userId: "@batuhan:beeper.com",
      },
      config: {
        appserviceId: "sh-openclaw-device",
        asToken: "as-token",
        bridgeId: "sh-openclaw-device",
        homeserver: "https://matrix.beeper.com",
        hsToken: "hs-token",
        matrixDeviceId: "DEVICE",
        matrixUserId: "@batuhan:beeper.com",
      },
      init: {
        homeserver: "https://matrix.beeper.com",
        registration: {
          asToken: "as-token",
          hsToken: "hs-token",
          id: "sh-openclaw-device",
          senderLocalpart: "sh-openclaw-devicebot",
          url: "websocket",
        },
      },
    }));
    const io = captureIO("123456\n");

    await expect(runCli([
      "login",
      "--config",
      configPath,
      "--data-dir",
      dir,
      "--email",
      "you@example.com",
      "--server-env",
      "staging",
    ], io, { setupBridge })).resolves.toBe(0);

    expect(setupBridge).toHaveBeenCalledWith(expect.objectContaining({
      email: "you@example.com",
      env: "staging",
      getLoginCode: expect.any(Function),
    }));
    await expect(setupBridge.mock.calls[0]?.[0].getLoginCode()).resolves.toBe("123456");
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      appserviceId: "sh-openclaw-device",
      asToken: "as-token",
      homeserver: "https://matrix.beeper.com",
      hsToken: "hs-token",
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper.com",
      serverEnv: "staging",
    });
    const output = JSON.parse(io.stdoutText);
    expect(output.account).toMatchObject({
      appserviceId: "sh-openclaw-device",
      bridgeId: "sh-openclaw-device",
      canConnect: true,
      deviceId: "DEVICE",
      serverEnv: "staging",
      userId: "@batuhan:beeper.com",
    });
    expect(output).not.toHaveProperty("init");
    expect(io.stdoutText).not.toContain("mx-token");
    expect(io.stdoutText).not.toContain("as-token");
    expect(io.stdoutText).not.toContain("hs-token");
    expect(io.stdoutText).not.toContain("bridge-manager-token");
  });

  it("prompts for the Beeper login code when one is not provided", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-login-prompt-"));
    const setupBridge = vi.fn(async () => ({
      account: {
        accessToken: "mx-token",
        deviceId: "DEVICE",
        homeserver: "https://matrix.beeper.com",
        userId: "@alice:beeper.com",
      },
      config: {
        appserviceId: "sh-openclaw-device",
        asToken: "as-token",
        bridgeId: "sh-openclaw-device",
        homeserver: "https://matrix.beeper.com",
        hsToken: "hs-token",
        matrixDeviceId: "DEVICE",
        matrixUserId: "@alice:beeper.com",
      },
      init: {
        homeserver: "https://matrix.beeper.com",
        registration: {
          asToken: "as-token",
          hsToken: "hs-token",
          id: "sh-openclaw-device",
          senderLocalpart: "sh-openclaw-devicebot",
          url: "websocket",
        },
      },
    }));
    const io = captureIO("654321\n");

    await expect(runCli([
      "login",
      "--config",
      join(dir, "config.json"),
      "--email",
      "alice@example.com",
    ], io, { setupBridge })).resolves.toBe(0);

    await expect(setupBridge.mock.calls[0]?.[0].getLoginCode()).resolves.toBe("654321");
    expect(io.stderrText).toContain("Enter Beeper login code:");
  });

  it("can log in with username/password without prompting for OTP", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-password-"));
    const setupBridge = successfulSetupBridge();
    const io = captureIO();

    await expect(runCli([
      "login",
      "--config",
      join(dir, "config.json"),
      "--username",
      "batuhan",
      "--password",
      "secret",
      "--server-env",
      "staging",
    ], io, { setupBridge })).resolves.toBe(0);

    expect(setupBridge).toHaveBeenCalledWith(expect.objectContaining({
      env: "staging",
      password: "secret",
      username: "batuhan",
    }));
    expect(setupBridge.mock.calls[0]?.[0]).not.toHaveProperty("getLoginCode");
    expect(io.stderrText).not.toContain("Enter Beeper login code:");
  });

  it("rejects ambiguous login credentials", async () => {
    const io = captureIO();

    await expect(runCli([
      "login",
      "--email",
      "you@example.com",
      "--username",
      "batuhan",
      "--password",
      "secret",
    ], io)).resolves.toBe(1);

    expect(io.stderrText).toContain("Choose only one login method");
  });

  it("prints the saved Beeper bridge identity", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-whoami-"));
    const configPath = join(dir, "config.json");
    await runCli([
      "login",
      "--config",
      configPath,
      "--email",
      "you@example.com",
    ], captureIO("123456\n"), { setupBridge: successfulSetupBridge() });
    const io = captureIO();

    await expect(runCli(["whoami", "--config", configPath], io)).resolves.toBe(0);

    expect(JSON.parse(io.stdoutText)).toEqual({
      appserviceId: "sh-openclaw-device",
      bridgeId: "sh-openclaw-device",
      canConnect: true,
      deviceId: "DEVICE",
      homeserver: "https://matrix.beeper.com",
      serverEnv: "prod",
      userId: "@batuhan:beeper.com",
    });
  });

  it("reports incomplete identity when no Beeper login is saved", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pickle-openclaw-empty-"));
    const io = captureIO();

    await expect(runCli(["whoami", "--data-dir", dir], io)).resolves.toBe(0);

    expect(JSON.parse(io.stdoutText)).toMatchObject({
      canConnect: false,
      deviceId: null,
      homeserver: null,
      userId: null,
    });
  });
});

function successfulSetupBridge() {
  return vi.fn(async () => ({
    account: {
      accessToken: "mx-token",
      deviceId: "DEVICE",
      homeserver: "https://matrix.beeper.com",
      userId: "@batuhan:beeper.com",
    },
    config: {
      appserviceId: "sh-openclaw-device",
      asToken: "as-token",
      bridgeId: "sh-openclaw-device",
      homeserver: "https://matrix.beeper.com",
      hsToken: "hs-token",
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper.com",
    },
    init: {
      homeserver: "https://matrix.beeper.com",
      registration: {
        asToken: "as-token",
        hsToken: "hs-token",
        id: "sh-openclaw-device",
        senderLocalpart: "sh-openclaw-devicebot",
        url: "websocket",
      },
    },
  }));
}

function captureIO(stdin = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    get stderrText() {
      return stderr.join("");
    },
    get stdoutText() {
      return stdout.join("");
    },
    stderr: {
      write: (chunk: string | Uint8Array) => {
        stderr.push(String(chunk));
        return true;
      },
    },
    stdin: Readable.from([stdin]),
    stdout: {
      write: (chunk: string | Uint8Array) => {
        stdout.push(String(chunk));
        return true;
      },
    },
  };
}
