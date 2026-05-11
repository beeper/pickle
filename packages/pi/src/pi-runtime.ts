import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PicklePiBinding, PicklePiConfig } from "./types";

export interface PiAgentSession {
  prompt(text: string, options?: unknown): Promise<void>;
  sendUserMessage?(content: string | unknown[], options?: { deliverAs?: "steer" | "followUp" }): Promise<void>;
  subscribe(listener: (event: unknown) => void): () => void;
}

export interface HeadlessPiSession {
  binding: PicklePiBinding;
  modelFallbackMessage?: string;
  session: PiAgentSession;
  unsubscribe(): void;
}

export interface HeadlessPiRuntimeOptions {
  binding: PicklePiBinding;
  config: PicklePiConfig;
  onEvent(event: unknown): void | Promise<void>;
}

let ownedSessionEnvLock = Promise.resolve();

export async function createHeadlessPiSession(options: HeadlessPiRuntimeOptions): Promise<HeadlessPiSession> {
  const pi = await loadPiCodingAgent();
  const nativeSessionDir = resolve(options.config.dataDir, "sessions", "native");
  await mkdir(dirname(options.binding.piSessionFile), { recursive: true });
  await mkdir(nativeSessionDir, { recursive: true });

  const result = await withOwnedSessionEnv(async () => {
    const sessionManager = pi.SessionManager.open(options.binding.piSessionFile, nativeSessionDir, options.binding.cwd);
    const resourceLoader = new pi.DefaultResourceLoader({ cwd: options.binding.cwd });
    await resourceLoader.reload();
    return pi.createAgentSession({
      cwd: options.binding.cwd,
      customTools: [],
      resourceLoader,
      sessionManager,
      sessionStartEvent: { reason: "startup", type: "session_start" },
      tools: pi.createCodingTools(options.binding.cwd),
    });
  });
  const unsubscribe = result.session.subscribe((event: unknown) => {
    void Promise.resolve(options.onEvent(event)).catch((error: unknown) => {
      console.error("Failed to handle Pi session event", { bindingId: options.binding.id, error });
    });
  });
  const headless: HeadlessPiSession = {
    binding: options.binding,
    session: result.session,
    unsubscribe,
  };
  if (result.modelFallbackMessage) headless.modelFallbackMessage = result.modelFallbackMessage;
  return headless;
}

async function withOwnedSessionEnv<T>(callback: () => Promise<T>): Promise<T> {
  const previousLock = ownedSessionEnvLock;
  let release!: () => void;
  ownedSessionEnvLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousLock;
  const previousOwnedSession = process.env.PICKLE_PI_OWNED_SESSION;
  process.env.PICKLE_PI_OWNED_SESSION = "1";
  try {
    return await callback();
  } finally {
    if (previousOwnedSession === undefined) {
      delete process.env.PICKLE_PI_OWNED_SESSION;
    } else {
      process.env.PICKLE_PI_OWNED_SESSION = previousOwnedSession;
    }
    release();
  }
}

async function loadPiCodingAgent(): Promise<{
  DefaultResourceLoader: new (options: { cwd: string }) => { reload(): Promise<void> };
  SessionManager: { open(path: string, sessionDir?: string, cwdOverride?: string): unknown };
  createAgentSession(options: Record<string, unknown>): Promise<{ modelFallbackMessage?: string; session: PiAgentSession }>;
  createCodingTools(cwd: string): unknown;
}> {
  try {
    const dynamicImport = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;
    return (await dynamicImport("@earendil-works/pi-coding-agent")) as Awaited<ReturnType<typeof loadPiCodingAgent>>;
  } catch (error) {
    throw new Error(
      "Missing @earendil-works/pi-coding-agent. Install Pi in the runtime environment before starting headless sessions.",
      { cause: error }
    );
  }
}
