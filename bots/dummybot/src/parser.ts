import {
  DEFAULT_CHUNK_MAX,
  DEFAULT_CHUNK_MIN,
  MAX_DEMO_CHAOS_ACTIONS,
  MAX_DEMO_CHAOS_TURNS,
  MAX_DEMO_CHARS,
  MAX_DEMO_CHUNK_CHARS,
  MAX_DEMO_COLLECTIONS,
  MAX_DEMO_DELAY_MS,
  MAX_DEMO_DURATION_SECONDS,
  MAX_DEMO_RANDOM_ACTIONS,
  MAX_DEMO_REASONING_CHARS,
  MAX_DEMO_STAGGER_MS,
  MAX_DEMO_STEPS,
  MAX_DEMO_TOOL_SPECS,
} from "./constants";
import type { ChaosCommand, CommonCommandOptions, FinishReason, ParsedCommand, Profile, RandomCommand, SharedStreamOptions, ToolSpec } from "./types";

export function helpText(): string {
  return [
    "DummyBridge demo commands:",
    "help",
    "stream-lorem <chars> [--reasoning=N] [--steps=N] [--sources=N] [--documents=N] [--files=N] [--meta] [--data=name] [--data-transient=name] [--delay-ms=min:max] [--chunk-chars=min:max] [--seed=N] [--finish=stop|length|tool-calls|content-filter|other] [--abort|--error]",
    "stream-tools <chars> <tool[#fail|#approval|#deny|#delta|#inputerror|#prelim|#provider]>... [common options]",
    "stream-random [seconds] [--actions=N] [--profile=balanced|tools|artifacts|terminals] [--seed=N] [--delay-ms=min:max] [--allow-abort] [--allow-error] [--allow-approval]",
    "stream-chaos [turns] [seconds] [--profile=balanced|tools|artifacts|terminals] [--seed=N] [--stagger-ms=min:max] [--max-actions=N] [--allow-abort] [--allow-error] [--allow-approval]",
    "Notes: plain messages only, new chats create new rooms, and approval-tagged tools wait for user approval.",
  ].join("\n");
}

export function parseCommand(input: string): ParsedCommand {
  const tokens = String(input || "").trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  switch (tokens[0]?.toLowerCase()) {
    case "help":
    case "/help":
    case "!help":
      return { name: "help" };
    case "dummybridge":
      return tokens[1]?.toLowerCase() === "help" ? { name: "help" } : null;
    case "stream-lorem":
      return parseLoremCommand(tokens.slice(1));
    case "stream-tools":
      return parseToolsCommand(tokens.slice(1));
    case "stream-random":
      return parseRandomCommand(tokens.slice(1));
    case "stream-chaos":
      return parseChaosCommand(tokens.slice(1));
    default:
      return null;
  }
}

function parseLoremCommand(tokens: string[]): ParsedCommand {
  if (!tokens.length) throw new Error("stream-lorem requires a character count");
  const chars = parsePositiveInt(tokens[0] ?? "", "character count");
  validateMaxIntValue(chars, MAX_DEMO_CHARS, "character count");
  return { name: "stream-lorem", chars, options: parseCommonOptions(tokens.slice(1)) };
}

function parseToolsCommand(tokens: string[]): ParsedCommand {
  if (tokens.length < 2) throw new Error("stream-tools requires a character count and at least one tool");
  const chars = parsePositiveInt(tokens[0] ?? "", "character count");
  validateMaxIntValue(chars, MAX_DEMO_CHARS, "character count");
  const toolTokens = tokens.slice(1).filter((token) => !token.startsWith("--"));
  const optionTokens = tokens.slice(1).filter((token) => token.startsWith("--"));
  if (!toolTokens.length) throw new Error("stream-tools requires at least one tool spec");
  validateMaxIntValue(toolTokens.length, MAX_DEMO_TOOL_SPECS, "tool spec count");
  return {
    name: "stream-tools",
    chars,
    tools: toolTokens.map(parseToolSpec),
    options: parseCommonOptions(optionTokens),
  };
}

function parseRandomCommand(tokens: string[]): RandomCommand {
  const cmd: RandomCommand = {
    name: "stream-random",
    durationMs: 20_000,
    actions: 20,
    delayMinMs: 350,
    delayMaxMs: 1150,
    ...defaultSharedOptions(),
  };
  let rest = tokens;
  if (rest[0] && !rest[0].startsWith("--")) {
    const seconds = parsePositiveInt(rest[0], "duration");
    validateMaxIntValue(seconds, MAX_DEMO_DURATION_SECONDS, "duration seconds");
    cmd.durationMs = seconds * 1000;
    rest = rest.slice(1);
  }
  for (const token of rest) {
    const [key, value, hasValue] = parseOptionToken(token);
    switch (key) {
      case "actions":
        cmd.actions = parseValidatedInt(value, hasValue, token, "actions", MAX_DEMO_RANDOM_ACTIONS, false);
        break;
      case "delay-ms": {
        if (!hasValue) throw new Error(`${token} requires a value`);
        const [minMs, maxMs] = parseIntRange(value, "delay-ms");
        validateMaxIntRange(minMs, maxMs, MAX_DEMO_DELAY_MS, "delay range");
        cmd.delayMinMs = minMs;
        cmd.delayMaxMs = maxMs;
        break;
      }
      default:
        if (!parseSharedStreamOption(key, value, hasValue, token, cmd)) throw new Error(`unknown random option ${JSON.stringify(token)}`);
    }
  }
  return cmd;
}

function parseChaosCommand(tokens: string[]): ChaosCommand {
  const cmd: ChaosCommand = {
    name: "stream-chaos",
    turns: 3,
    durationMs: 10_000,
    staggerMinMs: 150,
    staggerMaxMs: 900,
    maxActions: 10,
    ...defaultSharedOptions(),
  };
  let rest = tokens;
  if (rest[0] && !rest[0].startsWith("--")) {
    const turns = parsePositiveInt(rest[0], "turn count");
    validateMaxIntValue(turns, MAX_DEMO_CHAOS_TURNS, "turn count");
    cmd.turns = turns;
    rest = rest.slice(1);
  }
  if (rest[0] && !rest[0].startsWith("--")) {
    const seconds = parsePositiveInt(rest[0], "duration");
    validateMaxIntValue(seconds, MAX_DEMO_DURATION_SECONDS, "duration seconds");
    cmd.durationMs = seconds * 1000;
    rest = rest.slice(1);
  }
  for (const token of rest) {
    const [key, value, hasValue] = parseOptionToken(token);
    switch (key) {
      case "stagger-ms": {
        if (!hasValue) throw new Error(`${token} requires a value`);
        const [minMs, maxMs] = parseIntRange(value, "delay-ms");
        validateMaxIntRange(minMs, maxMs, MAX_DEMO_STAGGER_MS, "stagger range");
        cmd.staggerMinMs = minMs;
        cmd.staggerMaxMs = maxMs;
        break;
      }
      case "max-actions":
        cmd.maxActions = parseValidatedInt(value, hasValue, token, "max-actions", MAX_DEMO_CHAOS_ACTIONS, false);
        break;
      default:
        if (!parseSharedStreamOption(key, value, hasValue, token, cmd)) throw new Error(`unknown chaos option ${JSON.stringify(token)}`);
    }
  }
  if (cmd.turns < 1) throw new Error("stream-chaos requires at least one turn");
  return cmd;
}

function parseCommonOptions(tokens: string[]): CommonCommandOptions {
  const opts: CommonCommandOptions = {
    reasoningChars: 0,
    steps: 0,
    sources: 0,
    documents: 0,
    files: 0,
    meta: false,
    dataName: "",
    dataTransientName: "",
    delayMinMs: 30,
    delayMaxMs: 150,
    chunkMin: DEFAULT_CHUNK_MIN,
    chunkMax: DEFAULT_CHUNK_MAX,
    finishReason: "stop",
    abort: false,
    error: false,
    seed: 0,
    seedSet: false,
  };
  for (const token of tokens) {
    const [key, value, hasValue] = parseOptionToken(token);
    switch (key) {
      case "reasoning":
        opts.reasoningChars = parseValidatedInt(value, hasValue, token, "reasoning", MAX_DEMO_REASONING_CHARS, true);
        break;
      case "steps":
        opts.steps = parseValidatedInt(value, hasValue, token, "steps", MAX_DEMO_STEPS, false);
        break;
      case "sources":
        opts.sources = parseValidatedInt(value, hasValue, token, "sources", MAX_DEMO_COLLECTIONS, true);
        break;
      case "documents":
        opts.documents = parseValidatedInt(value, hasValue, token, "documents", MAX_DEMO_COLLECTIONS, true);
        break;
      case "files":
        opts.files = parseValidatedInt(value, hasValue, token, "files", MAX_DEMO_COLLECTIONS, true);
        break;
      case "meta":
        opts.meta = true;
        break;
      case "data":
        if (!hasValue) throw new Error(`${token} requires a value`);
        opts.dataName = value.trim();
        break;
      case "data-transient":
        if (!hasValue) throw new Error(`${token} requires a value`);
        opts.dataTransientName = value.trim();
        break;
      case "delay-ms": {
        if (!hasValue) throw new Error(`${token} requires a value`);
        const [minMs, maxMs] = parseIntRange(value, "delay-ms");
        validateMaxIntRange(minMs, maxMs, MAX_DEMO_DELAY_MS, "delay range");
        opts.delayMinMs = minMs;
        opts.delayMaxMs = maxMs;
        break;
      }
      case "chunk-chars": {
        if (!hasValue) throw new Error(`${token} requires a value`);
        const [minChunk, maxChunk] = parseIntRange(value, "chunk-chars");
        validateMaxIntRange(minChunk, maxChunk, MAX_DEMO_CHUNK_CHARS, "chunk size range");
        opts.chunkMin = minChunk;
        opts.chunkMax = maxChunk;
        break;
      }
      case "seed":
        if (!hasValue) throw new Error(`${token} requires a value`);
        opts.seed = parseInt64(value, "seed");
        opts.seedSet = true;
        break;
      case "finish": {
        if (!hasValue) throw new Error(`${token} requires a value`);
        const reason = normalizeFinishReason(value);
        if (!reason) throw new Error(`unsupported finish reason ${JSON.stringify(value)}`);
        opts.finishReason = reason;
        break;
      }
      case "abort":
        opts.abort = true;
        break;
      case "error":
        opts.error = true;
        break;
      default:
        throw new Error(`unknown option ${JSON.stringify(token)}`);
    }
  }
  validateCommonOptions(opts);
  return opts;
}

function parseSharedStreamOption(key: string, value: string, hasValue: boolean, token: string, opts: SharedStreamOptions): boolean {
  switch (key) {
    case "profile":
      if (!hasValue) throw new Error(`${token} requires a value`);
      if (!["balanced", "tools", "artifacts", "terminals"].includes(value.trim().toLowerCase())) throw new Error(`unknown profile ${JSON.stringify(value)}`);
      opts.profile = value.trim().toLowerCase() as Profile;
      return true;
    case "seed":
      if (!hasValue) throw new Error(`${token} requires a value`);
      opts.seed = parseInt64(value, "seed");
      opts.seedSet = true;
      return true;
    case "allow-abort":
      opts.allowAbort = true;
      return true;
    case "allow-error":
      opts.allowError = true;
      return true;
    case "allow-approval":
      opts.allowApproval = true;
      return true;
    default:
      return false;
  }
}

function parseToolSpec(raw: string, idx: number): ToolSpec {
  const [namePart = "", ...tags] = raw.split("#");
  const name = namePart.trim();
  if (!name) throw new Error(`tool spec ${JSON.stringify(raw)} is missing a tool name`);
  const spec: ToolSpec = { name, tags: [], fail: false, approval: false, deny: false, delta: false, inputError: false, preliminary: false, provider: false, displayTitle: name, sequenceIndex: idx + 1 };
  for (const rawTag of tags) {
    const tag = rawTag.trim().toLowerCase();
    if (!tag) continue;
    spec.tags.push(tag);
    if (tag === "fail") spec.fail = true;
    else if (tag === "approval") spec.approval = true;
    else if (tag === "deny") spec.deny = true;
    else if (tag === "delta") spec.delta = true;
    else if (tag === "inputerror") spec.inputError = true;
    else if (tag === "prelim") spec.preliminary = true;
    else if (tag === "provider") spec.provider = true;
    else throw new Error(`unknown tool tag ${JSON.stringify(tag)} in ${JSON.stringify(raw)}`);
  }
  if ([spec.fail, spec.approval, spec.deny].filter(Boolean).length > 1) throw new Error(`tool spec ${JSON.stringify(raw)} has conflicting final state tags`);
  return spec;
}

function defaultSharedOptions(): SharedStreamOptions {
  return { profile: "balanced", seed: 0, seedSet: false, allowAbort: false, allowError: false, allowApproval: false };
}

function validateCommonOptions(opts: CommonCommandOptions): void {
  if (opts.abort && opts.error) throw new Error("--abort and --error cannot be combined");
  if ((opts.abort || opts.error) && opts.finishReason !== "stop") throw new Error("--finish cannot be combined with --abort or --error");
  if (opts.chunkMin <= 0 || opts.chunkMax < opts.chunkMin) throw new Error(`invalid chunk size range ${opts.chunkMin}:${opts.chunkMax}`);
  if (opts.delayMinMs < 0 || opts.delayMaxMs < opts.delayMinMs) throw new Error(`invalid delay range ${opts.delayMinMs}:${opts.delayMaxMs}`);
}

function normalizeFinishReason(value: string): FinishReason | "" {
  switch (value.trim().toLowerCase()) {
    case "":
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool-calls":
    case "tool_calls":
    case "toolcalls":
      return "tool-calls";
    case "content-filter":
    case "content_filter":
    case "contentfilter":
      return "content-filter";
    case "other":
      return "other";
    default:
      return "";
  }
}

function parseOptionToken(token: string): [string, string, boolean] {
  const trimmed = token.trim().replace(/^--/, "");
  const index = trimmed.indexOf("=");
  if (index === -1) return [trimmed.toLowerCase(), "", false];
  return [trimmed.slice(0, index).trim().toLowerCase(), trimmed.slice(index + 1).trim(), true];
}

function parseValidatedInt(value: string, hasValue: boolean, token: string, label: string, max: number, allowZero: boolean): number {
  if (!hasValue) throw new Error(`${token} requires a value`);
  const n = allowZero ? parseNonNegativeInt(value, label) : parsePositiveInt(value, label);
  validateMaxIntValue(n, max, label);
  return n;
}

function parsePositiveInt(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid ${label} ${JSON.stringify(raw)}`);
  return value;
}

function parseNonNegativeInt(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isInteger(value) || value < 0) throw new Error(`invalid ${label} ${JSON.stringify(raw)}`);
  return value;
}

function parseInt64(raw: string, label: string): number {
  const value = Number.parseInt(raw.trim(), 10);
  if (!Number.isSafeInteger(value)) throw new Error(`invalid ${label} ${JSON.stringify(raw)}`);
  return value;
}

function parseIntRange(raw: string, label: string): [number, number] {
  const [minRaw, maxRaw] = raw.trim().split(":", 2);
  if (maxRaw === undefined) {
    const value = parseNonNegativeInt(raw, label);
    return [value, value];
  }
  const minValue = parseNonNegativeInt(minRaw ?? "", label);
  const maxValue = parseNonNegativeInt(maxRaw, label);
  if (maxValue < minValue) throw new Error(`invalid ${label} range ${JSON.stringify(raw)}`);
  return [minValue, maxValue];
}

function validateMaxIntValue(value: number, max: number, label: string): void {
  if (value > max) throw new Error(`${label} ${value} exceeds the maximum of ${max}`);
}

function validateMaxIntRange(minValue: number, maxValue: number, max: number, label: string): void {
  if (minValue > max || maxValue > max) throw new Error(`invalid ${label} ${minValue}:${maxValue}; maximum is ${max}`);
}
