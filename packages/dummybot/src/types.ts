export interface CommonCommandOptions {
  reasoningChars: number;
  steps: number;
  sources: number;
  documents: number;
  files: number;
  meta: boolean;
  dataName: string;
  dataTransientName: string;
  delayMinMs: number;
  delayMaxMs: number;
  chunkMin: number;
  chunkMax: number;
  finishReason: FinishReason;
  abort: boolean;
  error: boolean;
  seed: number;
  seedSet: boolean;
}

export type FinishReason = "stop" | "length" | "tool-calls" | "content-filter" | "other";
export type Profile = "balanced" | "tools" | "artifacts" | "terminals";

export interface LoremCommand {
  name: "stream-lorem";
  chars: number;
  options: CommonCommandOptions;
}

export interface ToolSpec {
  name: string;
  tags: string[];
  fail: boolean;
  approval: boolean;
  deny: boolean;
  delta: boolean;
  inputError: boolean;
  preliminary: boolean;
  provider: boolean;
  displayTitle: string;
  sequenceIndex: number;
}

export interface ToolsCommand {
  name: "stream-tools";
  chars: number;
  tools: ToolSpec[];
  options: CommonCommandOptions;
}

export interface SharedStreamOptions {
  profile: Profile;
  seed: number;
  seedSet: boolean;
  allowAbort: boolean;
  allowError: boolean;
  allowApproval: boolean;
}

export interface RandomCommand extends SharedStreamOptions {
  name: "stream-random";
  durationMs: number;
  actions: number;
  delayMinMs: number;
  delayMaxMs: number;
}

export interface ChaosCommand extends SharedStreamOptions {
  name: "stream-chaos";
  turns: number;
  durationMs: number;
  staggerMinMs: number;
  staggerMaxMs: number;
  maxActions: number;
}

export type ParsedCommand = { name: "help" } | LoremCommand | ToolsCommand | RandomCommand | ChaosCommand | null;

export type DummyStreamPart = string | Record<string, unknown>;
