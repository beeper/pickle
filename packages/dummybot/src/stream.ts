import { setTimeout as delay } from "node:timers/promises";
import { buildDemoVisibleText, buildLoremText, chunkText, sanitizeToolName, sliceByStep, splitCount } from "./content";
import { SeededRng, rngForOptions, sampleDelay } from "./rng";
import type { ChaosCommand, CommonCommandOptions, DummyStreamPart, ParsedCommand, RandomCommand, ToolSpec } from "./types";

type RandomActionKind = "text" | "reasoning" | "step" | "tool_ok" | "tool_fail" | "tool_approval" | "tool_deny" | "source" | "document" | "file" | "metadata" | "data" | "data_transient";
type RuntimeOptions = Omit<Required<DummyStreamOptions>, "signal"> & { signal?: AbortSignal };

export interface DummyStreamOptions {
  now?: () => number;
  signal?: AbortSignal;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export async function* streamCommand(command: Exclude<ParsedCommand, null | { name: "help" }>, options: DummyStreamOptions = {}): AsyncGenerator<DummyStreamPart> {
  const runtime = runtimeOptions(options);
  switch (command.name) {
    case "stream-lorem":
      yield* runLorem(command.chars, command.options, runtime);
      break;
    case "stream-tools":
      yield* runTools(command.chars, command.tools, command.options, runtime);
      break;
    case "stream-random":
      yield* runRandom(command, runtime);
      break;
    case "stream-chaos":
      yield* runChaos(command, runtime);
      break;
  }
}

async function* runLorem(chars: number, opts: CommonCommandOptions, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  const rng = rngForOptions(opts.seedSet, opts.seed, runtime.now());
  const contentRng = new SeededRng(rng.int63());
  const stepCount = opts.steps > 0 ? opts.steps : 1;
  const text = buildDemoVisibleText(chars, contentRng);
  const reasoning = buildLoremText(opts.reasoningChars, contentRng);
  for (let step = 0; step < stepCount; step += 1) {
    if (opts.steps > 0) yield { type: "start-step" };
    yield* commonDecorations(opts, chars, step, stepCount);
    if (reasoning) yield* streamReasoning(sliceByStep(reasoning, stepCount, step), rng, opts, runtime);
    yield* streamVisibleText(sliceByStep(text, stepCount, step), rng, opts, runtime);
    if (opts.steps > 0) yield { type: "finish-step" };
  }
  yield terminalPart(opts);
}

async function* runTools(chars: number, tools: ToolSpec[], opts: CommonCommandOptions, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  const rng = rngForOptions(opts.seedSet, opts.seed, runtime.now());
  const contentRng = new SeededRng(rng.int63());
  const phaseCount = Math.max(tools.length + 1, Math.max(opts.steps, 1));
  const text = buildDemoVisibleText(chars, contentRng);
  const reasoning = buildLoremText(opts.reasoningChars, contentRng);
  for (let phase = 0; phase < phaseCount; phase += 1) {
    yield { type: "start-step" };
    yield* commonDecorations(opts, chars, phase, phaseCount);
    if (reasoning) yield* streamReasoning(sliceByStep(reasoning, phaseCount, phase), rng, opts, runtime);
    yield* streamVisibleText(sliceByStep(text, phaseCount, phase), rng, opts, runtime);
    const tool = tools[phase];
    if (tool) yield* runToolSpec(tool, rng, opts, runtime);
    yield { type: "finish-step" };
  }
  yield terminalPart(opts);
}

async function* runRandom(cmd: RandomCommand, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  const started = runtime.now();
  const seed = cmd.seedSet ? cmd.seed : started;
  const rng = new SeededRng(seed);
  const deadline = cmd.durationMs > 0 ? started + cmd.durationMs : 0;
  let now = started;
  let stepOpen = false;
  for (let action = 0; action < cmd.actions; action += 1) {
    if (deadline && now >= deadline) break;
    if (action > 0) {
      let delay = sampleDelay(rng, cmd.delayMinMs, cmd.delayMaxMs);
      if (deadline) {
        const remaining = deadline - now;
        if (remaining <= 0) break;
        if (delay > remaining) delay = remaining;
      }
      await runtime.sleep(delay, runtime.signal);
      now += delay;
      if (deadline && now >= deadline) break;
    }
    const kind = chooseRandomAction(cmd, rng);
    switch (kind) {
      case "text":
        yield* streamVisibleText(buildDemoVisibleText(40 + rng.intn(160), new SeededRng(rng.int63())), rng, {}, runtime);
        break;
      case "reasoning":
        yield* streamReasoning(buildLoremText(30 + rng.intn(120), new SeededRng(rng.int63())), rng, {}, runtime);
        break;
      case "step":
        yield { type: stepOpen ? "finish-step" : "start-step" };
        stepOpen = !stepOpen;
        break;
      case "tool_ok":
        yield* runToolSpec(randomTool(rng, action), rng, {}, runtime);
        break;
      case "tool_fail":
        yield* runToolSpec({ ...randomTool(rng, action), fail: true }, rng, {}, runtime);
        break;
      case "tool_approval":
        yield* runToolSpec({ ...randomTool(rng, action), approval: true }, rng, {}, runtime);
        break;
      case "tool_deny":
        yield* runToolSpec({ ...randomTool(rng, action), deny: true }, rng, {}, runtime);
        break;
      case "source":
        yield { sourceType: "url", title: `Random Source ${action + 1}`, type: "source", url: `https://dummybridge.local/random/source/${action + 1}` };
        break;
      case "document":
        yield { filename: `random-doc-${action + 1}.txt`, id: `random-doc-${action + 1}`, mediaType: "text/plain", title: `Random Document ${action + 1}`, type: "source-document" };
        break;
      case "file":
        yield { mediaType: "application/octet-stream", type: "file", url: `mxc://dummybridge/random-file-${action + 1}` };
        break;
      case "metadata":
        yield { messageMetadata: buildDemoMessageMetadata("stream-random", seed, action + 1), type: "message-metadata" };
        break;
      case "data":
        yield { data: { action: action + 1, seed }, id: "random", transient: false, type: "data" };
        break;
      case "data_transient":
        yield { data: { action: action + 1 }, id: "random-transient", transient: true, type: "data" };
        break;
    }
  }
  const terminal = chooseRandomTerminal(cmd, rng);
  if (terminal === "abort") yield { reason: "DummyBridge random mode aborted", type: "abort" };
  else if (terminal === "error") yield { errorText: "DummyBridge random mode failed", type: "error" };
  else yield { finishReason: "stop", messageMetadata: { finish_reason: "stop", turn_id: "dummybridge" }, type: "finish" };
}

async function* runChaos(cmd: ChaosCommand, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  const seed = cmd.seedSet ? cmd.seed : runtime.now();
  for (let index = 0; index < cmd.turns; index += 1) {
    const childSeed = seed + (index + 1) * 97;
    if (index > 0) {
      yield { messageMetadata: { child_index: index + 1, child_seed: childSeed, child_turn: true }, type: "message-metadata" };
      await runtime.sleep(sampleDelay(new SeededRng(childSeed + 17), cmd.staggerMinMs, cmd.staggerMaxMs), runtime.signal);
    }
    yield* runRandom({
      name: "stream-random",
      durationMs: cmd.durationMs,
      actions: Math.max(3, Math.min(cmd.maxActions, Math.floor(cmd.durationMs / 1000))),
      delayMinMs: 180,
      delayMaxMs: 900,
      profile: cmd.profile,
      seed: childSeed,
      seedSet: true,
      allowAbort: cmd.allowAbort,
      allowError: cmd.allowError,
      allowApproval: cmd.allowApproval,
    }, runtime);
  }
}

async function* streamVisibleText(text: string, rng: SeededRng, opts: Partial<CommonCommandOptions>, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  for (const chunk of chunkText(text, rng, opts.chunkMin, opts.chunkMax)) {
    yield { delta: chunk, id: "text_dummybridge", type: "text-delta" };
    await runtime.sleep(sampleDelay(rng, opts.delayMinMs, opts.delayMaxMs), runtime.signal);
  }
}

async function* streamReasoning(text: string, rng: SeededRng, opts: Partial<CommonCommandOptions>, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  if (!text.trim()) return;
  yield { id: "reasoning_dummybridge", type: "reasoning-start" };
  for (const chunk of chunkText(text, rng, opts.chunkMin, opts.chunkMax)) {
    yield { delta: chunk, id: "reasoning_dummybridge", type: "reasoning-delta" };
    await runtime.sleep(sampleDelay(rng, opts.delayMinMs, opts.delayMaxMs), runtime.signal);
  }
  yield { id: "reasoning_dummybridge", type: "reasoning-end" };
}

async function* runToolSpec(spec: ToolSpec, rng: SeededRng, opts: Partial<CommonCommandOptions>, runtime: RuntimeOptions): AsyncGenerator<DummyStreamPart> {
  const toolCallId = `dummy-tool-${spec.sequenceIndex}-${sanitizeToolName(spec.name)}`;
  const input = { tool: spec.name, sequence: spec.sequenceIndex, tags: spec.tags };
  yield { dynamic: true, providerExecuted: spec.provider, title: spec.displayTitle, toolCallId, toolName: spec.name, type: "tool-input-start" };
  if (spec.inputError) {
    yield { dynamic: true, errorText: "DummyBridge synthetic input error", input, providerExecuted: spec.provider, toolCallId, toolName: spec.name, type: "tool-input-error" };
  } else if (spec.delta) {
    for (const chunk of chunkText(JSON.stringify({ tool: spec.name, sequence: spec.sequenceIndex }), rng, opts.chunkMin, opts.chunkMax)) {
      yield { inputTextDelta: chunk, providerExecuted: spec.provider, toolCallId, toolName: spec.name, type: "tool-input-delta" };
      await runtime.sleep(sampleDelay(rng, opts.delayMinMs, opts.delayMaxMs), runtime.signal);
    }
  } else {
    yield { dynamic: true, input, providerExecuted: spec.provider, toolCallId, toolName: spec.name, type: "tool-input-available" };
  }
  if (spec.preliminary) yield { output: { status: "streaming", tool: spec.name }, preliminary: true, providerExecuted: spec.provider, toolCallId, type: "tool-output-available" };
  if (spec.approval) {
    const approvalId = `approval-${spec.sequenceIndex}-${sanitizeToolName(spec.name)}`;
    yield { approvalId, presentation: { title: spec.name, details: [{ label: "Mode", value: "DummyBridge demo approval" }], allowAlways: true }, toolCallId, type: "tool-approval-request" };
    yield { approvalId, approved: true, reason: "approved", toolCallId, type: "tool-approval-response" };
  }
  if (spec.deny) {
    yield { toolCallId, type: "tool-output-denied" };
    return;
  }
  if (spec.fail || spec.inputError) {
    yield { errorText: "DummyBridge synthetic tool failure", providerExecuted: spec.provider, toolCallId, type: "tool-output-error" };
    return;
  }
  yield { output: { status: "ok", tool: spec.name, sequence: spec.sequenceIndex }, providerExecuted: spec.provider, toolCallId, type: "tool-output-available" };
}

function* commonDecorations(opts: CommonCommandOptions, chars: number, step: number, steps: number): Generator<DummyStreamPart> {
  if (opts.meta) yield { messageMetadata: buildDemoMessageMetadata("demo", opts.seedSet ? opts.seed : chars, step + 1), type: "message-metadata" };
  for (let i = 0; i < splitCount(opts.sources, steps, step); i += 1) yield { sourceType: "url", title: `Demo Source ${step + 1}.${i + 1}`, type: "source", url: `https://dummybridge.local/source/${step + 1}-${i + 1}` };
  for (let i = 0; i < splitCount(opts.documents, steps, step); i += 1) yield { filename: `demo-doc-${step + 1}-${i + 1}.txt`, id: `demo-doc-${step + 1}-${i + 1}`, mediaType: "text/plain", title: `Demo Document ${step + 1}.${i + 1}`, type: "source-document" };
  for (let i = 0; i < splitCount(opts.files, steps, step); i += 1) yield { mediaType: "application/octet-stream", type: "file", url: `mxc://dummybridge/demo-file-${step + 1}-${i + 1}` };
  if (step === 0 && opts.dataName.trim()) yield { data: { mode: "persistent", stage: step + 1 }, id: opts.dataName, transient: false, type: "data" };
  if (step === 0 && opts.dataTransientName.trim()) yield { data: { mode: "transient", stage: step + 1 }, id: opts.dataTransientName, transient: true, type: "data" };
}

function terminalPart(opts: CommonCommandOptions): DummyStreamPart {
  if (opts.abort) return { reason: "DummyBridge synthetic abort", type: "abort" };
  if (opts.error) return { errorText: "DummyBridge synthetic error", type: "error" };
  return { finishReason: opts.finishReason, messageMetadata: { finish_reason: opts.finishReason, turn_id: "dummybridge" }, type: "finish" };
}

function chooseRandomAction(cmd: RandomCommand, rng: SeededRng): RandomActionKind {
  const weights: Array<{ kind: RandomActionKind; weight: number }> = [
    { kind: "text", weight: 6 }, { kind: "reasoning", weight: 4 }, { kind: "step", weight: 2 }, { kind: "tool_ok", weight: 3 }, { kind: "tool_fail", weight: 2 },
    { kind: "source", weight: 2 }, { kind: "document", weight: 2 }, { kind: "file", weight: 2 }, { kind: "metadata", weight: 2 }, { kind: "data", weight: 1 }, { kind: "data_transient", weight: 1 },
  ];
  if (cmd.profile === "tools") {
    weights.push({ kind: "tool_deny", weight: 3 });
    for (const item of weights) if (item.kind.startsWith("tool_")) item.weight += 4;
  } else if (cmd.profile === "artifacts") {
    for (const item of weights) if (["source", "document", "file", "metadata", "data", "data_transient"].includes(item.kind)) item.weight += 4;
  } else if (cmd.profile === "terminals") {
    for (const item of weights) if (item.kind === "step") item.weight += 4;
  }
  if (cmd.allowApproval) weights.push({ kind: "tool_approval", weight: 2 });
  let target = rng.intn(weights.reduce((sum, item) => sum + item.weight, 0));
  for (const item of weights) {
    target -= item.weight;
    if (target < 0) return item.kind;
  }
  return "text";
}

function chooseRandomTerminal(cmd: RandomCommand, rng: SeededRng): "finish" | "abort" | "error" {
  const options: Array<"finish" | "abort" | "error"> = ["finish"];
  if (cmd.allowAbort) options.push("abort");
  if (cmd.allowError) options.push("error");
  return options[rng.intn(options.length)] ?? "finish";
}

function randomTool(rng: SeededRng, action: number): ToolSpec {
  const names = ["search", "fetch", "summarize", "calendar", "shell", "files", "preview"];
  const name = names[rng.intn(names.length)] ?? "search";
  return { name, tags: [], fail: false, approval: false, deny: false, delta: false, inputError: false, preliminary: false, provider: false, displayTitle: name, sequenceIndex: action + 1 };
}

function buildDemoMessageMetadata(command: string, seed: number, step: number): Record<string, unknown> {
  return { command, seed, step, model: "dummybridge-demo", prompt_tokens: 100 + step, completion_tokens: 200 + step };
}

function runtimeOptions(options: DummyStreamOptions): RuntimeOptions {
  return {
    now: options.now ?? Date.now,
    sleep: options.sleep ?? sleep,
    ...(options.signal ? { signal: options.signal } : {}),
  };
}

async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return;
  await delay(ms, undefined, signal ? { signal } : undefined);
}
