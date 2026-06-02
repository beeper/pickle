import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 512_000;

const requireFromHere = createRequire(import.meta.url);

export interface BeeperCliRunOptions {
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes?: number;
  timeoutMs?: number;
}

export interface BeeperCliRunResult {
  command: string;
  args: string[];
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
  stdout: string;
}

export function createBeeperCliTool() {
  return {
    name: "beeper_cli",
    label: "Beeper CLI",
    description:
      "Run the bundled Beeper CLI as a dedicated local function. Use for Beeper Desktop chat search, reads, and sends.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments passed to the Beeper CLI, excluding the executable name.",
        },
        cwd: {
          type: "string",
          description: "Working directory for the CLI process. Defaults to the current process directory.",
        },
        timeoutMs: {
          type: "integer",
          minimum: 1,
          description: "Maximum process runtime in milliseconds.",
        },
        maxOutputBytes: {
          type: "integer",
          minimum: 1,
          description: "Maximum stdout plus stderr bytes to retain.",
        },
      },
      required: ["args"],
    },
    async execute(_id: string, params: Record<string, unknown>) {
      const runOptions: BeeperCliRunOptions = {
        args: readStringArray(params.args, "args"),
      };
      const cwd = readOptionalString(params.cwd, "cwd");
      const timeoutMs = readOptionalPositiveInteger(params.timeoutMs, "timeoutMs");
      const maxOutputBytes = readOptionalPositiveInteger(params.maxOutputBytes, "maxOutputBytes");
      if (cwd !== undefined) runOptions.cwd = cwd;
      if (timeoutMs !== undefined) runOptions.timeoutMs = timeoutMs;
      if (maxOutputBytes !== undefined) runOptions.maxOutputBytes = maxOutputBytes;
      return runBeeperCli(runOptions);
    },
  };
}

export function registerBeeperCli(program: unknown): void {
  const commandProgram = program as {
    command?: (name: string) => {
      description?: (text: string) => unknown;
      allowUnknownOption?: (value?: boolean) => unknown;
      argument?: (flags: string, description?: string) => unknown;
      option?: (flags: string, description?: string) => unknown;
      action?: (handler: (...args: unknown[]) => unknown) => unknown;
    };
  };
  const command = commandProgram.command?.("beeper");
  if (!command) return;
  command.description?.("Run the bundled Beeper CLI.");
  command.allowUnknownOption?.(true);
  command.argument?.("[args...]", "Arguments passed to the Beeper CLI");
  command.option?.("--timeout-ms <ms>", "Maximum process runtime in milliseconds");
  command.option?.("--max-output-bytes <bytes>", "Maximum stdout plus stderr bytes to retain");
  command.action?.(async (...actionArgs: unknown[]) => {
    const args = actionArgs[0];
    const options = isRecord(actionArgs[1]) ? actionArgs[1] : {};
    const runOptions: BeeperCliRunOptions = {
      args: readStringArray(args, "args"),
    };
    const timeoutMs = parseOptionalPositiveIntegerOption(options.timeoutMs, "timeout-ms");
    const maxOutputBytes = parseOptionalPositiveIntegerOption(options.maxOutputBytes, "max-output-bytes");
    if (timeoutMs !== undefined) runOptions.timeoutMs = timeoutMs;
    if (maxOutputBytes !== undefined) runOptions.maxOutputBytes = maxOutputBytes;
    const result = await runBeeperCli(runOptions);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exitCode = result.code ?? 1;
  });
}

export async function runBeeperCli(options: BeeperCliRunOptions): Promise<BeeperCliRunResult> {
  const args = options.args ?? [];
  const env = options.env ?? process.env;
  const launcher = resolveBeeperCliLauncher(env);
  return spawnAndCollect(process.execPath, [launcher, ...args], {
    cwd: options.cwd ? resolve(options.cwd) : process.cwd(),
    env,
    maxOutputBytes: options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  }, launcher);
}

function resolveBeeperCliLauncher(env: NodeJS.ProcessEnv): string {
  if (env.BEEPER_CLI) return env.BEEPER_CLI;
  return requireFromHere.resolve("beeper-cli/bin/beeper.js");
}

function spawnAndCollect(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; maxOutputBytes: number; timeoutMs: number },
  reportedCommand = command,
): Promise<BeeperCliRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`Beeper CLI timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    const append = (current: Buffer, chunk: Buffer) => {
      const next = Buffer.concat([current, chunk]);
      if (next.byteLength <= options.maxOutputBytes) return next;
      return next.subarray(next.byteLength - options.maxOutputBytes);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({
        command: reportedCommand,
        args: args.slice(1),
        code,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      });
    });
  });
}

function readStringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${key} must be an array of strings`);
  }
  return value;
}

function readOptionalString(value: unknown, key: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function readOptionalPositiveInteger(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function parseOptionalPositiveIntegerOption(value: unknown, key: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a positive integer`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${key} must be a positive integer`);
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
