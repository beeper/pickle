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
        accessToken: "mx-token",
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
      "--env",
      "staging",
      "--bridge-manager-token",
      "bridge-manager-token",
    ], io, { setupBridge })).resolves.toBe(0);

    expect(setupBridge).toHaveBeenCalledWith(expect.objectContaining({
      bridgeManagerToken: "bridge-manager-token",
      email: "you@example.com",
      env: "staging",
      getLoginCode: expect.any(Function),
      push: false,
      selfHosted: true,
    }));
    await expect(setupBridge.mock.calls[0]?.[0].getLoginCode()).resolves.toBe("123456");
    expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      accessToken: "mx-token",
      appserviceId: "sh-openclaw-device",
      asToken: "as-token",
      beeperEnv: "staging",
      bridgeManagerToken: "bridge-manager-token",
      homeserver: "https://matrix.beeper.com",
      hsToken: "hs-token",
      matrixDeviceId: "DEVICE",
      matrixUserId: "@batuhan:beeper.com",
    });
    const output = JSON.parse(io.stdoutText);
    expect(output.account).toMatchObject({
      appserviceId: "sh-openclaw-device",
      beeperEnv: "staging",
      bridgeId: "sh-openclaw-device",
      canConnect: true,
      deviceId: "DEVICE",
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
        accessToken: "mx-token",
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
      beeperEnv: "production",
      bridgeId: "sh-openclaw-device",
      canConnect: true,
      deviceId: "DEVICE",
      homeserver: "https://matrix.beeper.com",
      registrationUrl: "websocket",
      userId: "@batuhan:beeper.com",
    });
  });

  it("reports incomplete identity when no Beeper login is saved", async () => {
    const io = captureIO();

    await expect(runCli(["whoami", "--data-dir", "/tmp/pickle-openclaw-empty"], io)).resolves.toBe(0);

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
      accessToken: "mx-token",
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
