import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      "--access-token",
      "secret",
    ], initIO)).resolves.toBe(0);
    expect(initIO.stdoutText).toContain('"accessToken": "<redacted>"');
    expect(JSON.parse(await readFile(configPath, "utf8"))).toMatchObject({
      accessToken: "secret",
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

    await expect(runCli(["start", "--config", configPath, "--get-only"], io, { startBridge })).resolves.toBe(0);

    expect(startBridge).toHaveBeenCalledWith(expect.objectContaining({
      account: {
        accessToken: "mx-token",
        deviceId: "DEVICE",
        homeserver: "https://matrix.beeper.com",
        userId: "@batuhan:beeper.com",
      },
      config: expect.objectContaining({
        gatewayUrl: "http://127.0.0.1:29390",
        matrixUserId: "@batuhan:beeper.com",
      }),
      getOnly: true,
    }));
    expect(io.stdoutText).toContain("OpenClaw bridge started");
  });
});

function captureIO() {
  const io = {
    stderrText: "",
    stdoutText: "",
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
