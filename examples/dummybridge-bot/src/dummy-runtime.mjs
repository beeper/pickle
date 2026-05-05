const lorem = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Integer nec odio praesent libero sed cursus ante dapibus diam.",
  "Nulla quis sem at nibh elementum imperdiet duis sagittis ipsum.",
  "Praesent mauris fusce nec tellus sed augue semper porta.",
  "Mauris massa vestibulum lacinia arcu eget nulla.",
  "Curabitur ullamcorper ultricies nisi nam eget dui etiam rhoncus.",
];

const max = {
  actions: 64,
  chars: 20000,
  collections: 16,
  delayMs: 30000,
  steps: 32,
  tools: 16,
  turns: 16,
};

export function helpText() {
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

export async function* dummybridgeTextStream(input, options = {}) {
  const command = parseCommand(input);
  if (command.name === "help") {
    yield helpText();
    return;
  }
  if (command.name === "chaos") {
    for (let turn = 0; turn < command.turns; turn += 1) {
      yield `\n\n## Chaos turn ${turn + 1}/${command.turns}\n\n`;
      yield* runOne({ ...command, name: "random", seed: command.seed + turn, actions: command.maxActions });
      await sleep(sampleInt(makeRng(command.seed + turn), command.staggerMinMs, command.staggerMaxMs), options.signal);
    }
    return;
  }
  yield* runOne(command, options);
}

export async function* dummybridgeChaosTurnStream(input, turn, options = {}) {
  const command = parseCommand(input);
  if (command.name !== "chaos") {
    yield* dummybridgeTextStream(input, options);
    return;
  }
  const turnIndex = clamp(Number(turn) || 0, 0, command.turns - 1);
  yield* runOne({
    ...command,
    actions: command.maxActions,
    name: "random",
    seed: command.seed + ((turnIndex + 1) * 97),
  }, options);
}

export function parseCommand(input) {
  const tokens = String(input || "").trim().split(/\s+/).filter(Boolean);
  const first = normalizeCommand(tokens[0] || "stream-lorem");
  if (first === "help") return { name: "help" };
  if (first === "stream-chaos" || first === "stream-choaos") {
    const turns = clamp(readPositionalInt(tokens, 1, 4), 1, max.turns);
    return {
      ...common(tokens),
      maxActions: clamp(readOptionInt(tokens, "max-actions", 16), 1, max.actions),
      name: "chaos",
      staggerMaxMs: readRange(tokens, "stagger-ms", 250, 1500).max,
      staggerMinMs: readRange(tokens, "stagger-ms", 250, 1500).min,
      turns,
    };
  }
  if (first === "stream-random") {
    return {
      ...common(tokens),
      actions: clamp(readOptionInt(tokens, "actions", 24), 1, max.actions),
      chars: clamp(readOptionInt(tokens, "chars", 6000), 1, max.chars),
      name: "random",
      profile: readOption(tokens, "profile", "balanced"),
    };
  }
  if (first === "stream-tools") {
    const rawTools = tokens.slice(2).filter((token) => !token.startsWith("--"));
    return {
      ...common(tokens),
      chars: clamp(readPositionalInt(tokens, 1, 3200), 1, max.chars),
      name: "tools",
      tools: rawTools.slice(0, max.tools).map(parseTool).concat(rawTools.length ? [] : defaultTools()),
    };
  }
  if (!["stream-lorem", "error", "tools"].includes(first)) {
    return { name: "help" };
  }
  return {
    ...common(tokens),
    chars: clamp(readPositionalInt(tokens, 1, first === "error" ? 1200 : 4096), 1, max.chars),
    error: first === "error" || tokens.includes("--error"),
    name: "lorem",
    tools: first === "tools" ? defaultTools() : [],
  };
}

async function* runOne(command, options = {}) {
  const rng = makeRng(command.seed);
  const steps = clamp(command.steps, 1, max.steps);
  const tools = command.name === "random" ? randomTools(rng, command) : command.tools ?? [];
  const visible = markdownCorpus(command.chars, rng);
  const reasoning = prose(command.reasoning, rng);
  let reasoningStarted = false;

  yield { messageMetadata: metadata(command.name, command.seed, 0), type: "message-metadata" };
  yield { id: "text_dummybridge", type: "text-start" };
  yield { delta: `I heard: \`${escapeBackticks(command.raw || command.name)}\`\n\n`, id: "text_dummybridge", type: "text-delta" };

  for (let step = 0; step < steps; step += 1) {
    yield { type: "start-step" };
    yield* decorations(command, step, steps);
    if (reasoning && !reasoningStarted) {
      yield { id: "reasoning_dummybridge", type: "reasoning-start" };
      reasoningStarted = true;
    }
    if (reasoning) {
      for (const chunk of chunks(slice(reasoning, steps, step), rng, command.chunkMin, command.chunkMax)) {
        yield { delta: chunk, id: "reasoning_dummybridge", type: "reasoning-delta" };
        await sleep(sampleInt(rng, command.delayMinMs, command.delayMaxMs), options.signal);
      }
    }
    for (const chunk of chunks(slice(visible, steps, step), rng, command.chunkMin, command.chunkMax)) {
      yield { delta: chunk, id: "text_dummybridge", type: "text-delta" };
      await sleep(sampleInt(rng, command.delayMinMs, command.delayMaxMs), options.signal);
    }
    if (tools[step]) {
      yield* renderTool(tools[step], step + 1, rng, command, options);
    }
    yield { type: "finish-step" };
  }
  for (let index = steps; index < tools.length; index += 1) {
    yield* renderTool(tools[index], index + 1, rng, command, options);
  }
  if (reasoningStarted) yield { id: "reasoning_dummybridge", type: "reasoning-end" };
  yield { id: "text_dummybridge", type: "text-end" };

  if (command.abort) {
    yield { reason: "DummyBridge synthetic abort", type: "abort" };
    return;
  }
  if (command.error) {
    yield { errorText: "DummyBridge synthetic error", type: "error" };
    return;
  }
  yield { finishReason: command.finishReason || "stop", messageMetadata: { finish_reason: command.finishReason || "stop", turn_id: "dummybridge" }, type: "finish" };
}

async function* renderTool(tool, sequence, rng, command, options) {
  const id = `dummy-tool-${sequence}-${slug(tool.name)}`;
  const input = { sequence, tags: tool.tags ?? [], tool: tool.name };
  yield {
    dynamic: true,
    providerExecuted: Boolean(tool.provider),
    title: title(tool.name),
    toolCallId: id,
    toolName: tool.name,
    type: "tool-input-start",
  };
  if (tool.delta) {
    for (const chunk of chunks(JSON.stringify(input), rng, command.chunkMin, command.chunkMax)) {
      yield { inputTextDelta: chunk, toolCallId: id, type: "tool-input-delta" };
      await sleep(sampleInt(rng, command.delayMinMs, command.delayMaxMs), options.signal);
    }
  } else if (tool.inputError) {
    yield {
      dynamic: true,
      errorText: "DummyBridge synthetic input error",
      input,
      providerExecuted: Boolean(tool.provider),
      toolCallId: id,
      toolName: tool.name,
      type: "tool-input-error",
    };
  } else {
    yield {
      dynamic: true,
      input,
      providerExecuted: Boolean(tool.provider),
      toolCallId: id,
      toolName: tool.name,
      type: "tool-input-available",
    };
  }
  if (tool.prelim) {
    yield {
      output: { status: "streaming", tool: tool.name },
      preliminary: true,
      providerExecuted: Boolean(tool.provider),
      toolCallId: id,
      type: "tool-output-available",
    };
  }
  if (tool.approval || tool.deny) {
    const approvalId = `approval-${sequence}-${slug(tool.name)}`;
    yield { approvalId, toolCallId: id, type: "tool-approval-request" };
    yield { approvalId, approved: !tool.deny, reason: tool.deny ? "deny" : "approved", toolCallId: id, type: "tool-approval-response" };
  }
  if (tool.deny) {
    yield { toolCallId: id, type: "tool-output-denied" };
    return;
  }
  if (tool.fail || tool.inputError) {
    yield {
      errorText: "DummyBridge synthetic tool failure",
      providerExecuted: Boolean(tool.provider),
      toolCallId: id,
      type: "tool-output-error",
    };
    return;
  }
  yield {
    output: { sequence, status: "ok", tool: tool.name },
    providerExecuted: Boolean(tool.provider),
    toolCallId: id,
    type: "tool-output-available",
  };
}

function common(tokens) {
  const delay = readRange(tokens, "delay-ms", 30, 150);
  const chunk = readRange(tokens, "chunk-chars", 24, 96);
  return {
    abort: tokens.includes("--abort"),
    chunkMax: clamp(chunk.max, 1, 512),
    chunkMin: clamp(chunk.min, 1, 512),
    data: readOption(tokens, "data", "demo"),
    dataTransient: readOption(tokens, "data-transient", "demo-transient"),
    delayMaxMs: clamp(delay.max, 0, max.delayMs),
    delayMinMs: clamp(delay.min, 0, max.delayMs),
    documents: clamp(readOptionInt(tokens, "documents", 2), 0, max.collections),
    error: tokens.includes("--error"),
    files: clamp(readOptionInt(tokens, "files", 1), 0, max.collections),
    finishReason: readOption(tokens, "finish", "stop"),
    meta: tokens.includes("--meta"),
    raw: tokens.join(" "),
    reasoning: clamp(readOptionInt(tokens, "reasoning", 1200), 0, max.chars),
    seed: readOptionInt(tokens, "seed", 42),
    sources: clamp(readOptionInt(tokens, "sources", 3), 0, max.collections),
    steps: clamp(readOptionInt(tokens, "steps", 2), 1, max.steps),
  };
}

function metadata(command, seed, step) {
  return {
    command,
    completion_tokens: 200 + step,
    model: "dummybridge-demo",
    prompt_tokens: 100 + step,
    seed,
    step,
  };
}

function* decorations(command, step, steps) {
  if (command.meta) yield { messageMetadata: metadata("demo", command.seed, step + 1), type: "message-metadata" };
  for (let i = 0; i < split(command.sources, steps, step); i += 1) {
    yield {
      sourceId: `source-url-${step + 1}-${i + 1}`,
      title: `Demo Source ${step + 1}.${i + 1}`,
      type: "source-url",
      url: `https://dummybridge.local/source/${step + 1}-${i + 1}`,
    };
  }
  for (let i = 0; i < split(command.documents, steps, step); i += 1) {
    yield {
      filename: `demo-doc-${step + 1}-${i + 1}.txt`,
      mediaType: "text/plain",
      sourceId: `source-doc-${step + 1}-${i + 1}`,
      title: `Demo Document ${step + 1}.${i + 1}`,
      type: "source-document",
    };
  }
  for (let i = 0; i < split(command.files, steps, step); i += 1) {
    yield {
      mediaType: "application/octet-stream",
      type: "file",
      url: `mxc://dummybridge/demo-file-${step + 1}-${i + 1}`,
    };
  }
  if (step === 0 && command.data) yield { data: { mode: "persistent", stage: step + 1 }, type: `data-${command.data}` };
  if (step === 0 && command.dataTransient) {
    yield { data: { mode: "transient", stage: step + 1 }, transient: true, type: `data-${command.dataTransient}` };
  }
}

function markdownCorpus(chars, rng) {
  const blocks = [];
  while (blocks.join("\n\n").length < chars + 120) {
    const kind = sampleInt(rng, 0, 5);
    if (kind === 0) blocks.push(prose(sampleInt(rng, 160, 360), rng));
    else if (kind === 1) blocks.push(`${prose(sampleInt(rng, 90, 180), rng)} Review the [release notes](https://dummybridge.local/docs/streaming) for **incremental** output.`);
    else if (kind === 2) blocks.push("- Confirm seeded output.\n- Exercise markdown rendering.\n- Preserve readable deltas.");
    else if (kind === 3) blocks.push(`> Streaming output should feel alive.\n>\n> ${prose(sampleInt(rng, 80, 160), rng)}`);
    else if (kind === 4) blocks.push("```js\nconst preview = chunks.filter(Boolean).join(\"\");\n```");
    else blocks.push("| Metric | Value |\n| --- | --- |\n| stream | active |\n| renderer | markdown |");
  }
  return trim(blocks.join("\n\n"), chars);
}

function prose(chars, rng) {
  let out = "";
  while (out.length < chars + 80) out += `${out ? " " : ""}${lorem[sampleInt(rng, 0, lorem.length - 1)]}`;
  return trim(out, chars);
}

function chunks(text, rng, min, maxValue) {
  const out = [];
  let offset = 0;
  while (offset < text.length) {
    const size = sampleInt(rng, min, maxValue);
    out.push(text.slice(offset, offset + size));
    offset += size;
  }
  return out;
}

function randomTools(rng, command) {
  const pool = [
    "search#delta#prelim#provider",
    "fetch#fail#provider",
    "approval#deny",
    "render_artifact#provider",
    "shell#approval",
  ];
  return Array.from({ length: Math.min(command.actions, 12) }, () => parseTool(pool[sampleInt(rng, 0, pool.length - 1)]));
}

function defaultTools() {
  return ["lookup_room_context#delta#prelim#provider", "approval_gate#deny", "dummy_weather#provider"].map(parseTool);
}

function parseTool(token) {
  const [name = "tool", ...tags] = token.split("#");
  return {
    approval: tags.includes("approval"),
    delta: tags.includes("delta"),
    deny: tags.includes("deny"),
    fail: tags.includes("fail"),
    inputError: tags.includes("inputerror"),
    name,
    prelim: tags.includes("prelim"),
    provider: tags.includes("provider"),
    tags,
  };
}

function makeRng(seed) {
  let state = BigInt.asUintN(32, BigInt(seed || 1));
  return () => {
    state = BigInt.asUintN(32, state * 1664525n + 1013904223n);
    return Number(state) / 0x100000000;
  };
}

function sampleInt(rng, min, maxValue) {
  return Math.floor(min + rng() * (maxValue - min + 1));
}

function readOption(tokens, name, fallback) {
  const prefix = `--${name}=`;
  return tokens.find((token) => token.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function readOptionInt(tokens, name, fallback) {
  const value = Number.parseInt(readOption(tokens, name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

function readPositionalInt(tokens, index, fallback) {
  const value = Number.parseInt(tokens[index] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function readRange(tokens, name, fallbackMin, fallbackMax) {
  const raw = readOption(tokens, name, "");
  if (!raw) return { min: fallbackMin, max: fallbackMax };
  const [left, right = left] = raw.split(":");
  const min = Number.parseInt(left, 10);
  const maxValue = Number.parseInt(right, 10);
  if (!Number.isFinite(min) || !Number.isFinite(maxValue)) return { min: fallbackMin, max: fallbackMax };
  return { min: Math.min(min, maxValue), max: Math.max(min, maxValue) };
}

function normalizeCommand(value) {
  return String(value || "").trim().toLowerCase().replace(/^!dummybridge\s+/, "");
}

function split(total, steps, step) {
  const start = Math.floor((total * step) / steps);
  const end = Math.floor((total * (step + 1)) / steps);
  return end - start;
}

function slice(text, steps, step) {
  return text.slice(Math.floor((text.length * step) / steps), Math.floor((text.length * (step + 1)) / steps));
}

function trim(text, chars) {
  if (text.length <= chars) return text;
  const sliced = text.slice(0, chars);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > chars * 0.75 ? lastSpace : chars).trimEnd()}.`;
}

function clamp(value, min, maxValue) {
  return Math.max(min, Math.min(maxValue, value));
}

function slug(value) {
  return String(value || "tool").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function title(value) {
  return slug(value).split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function escapeBackticks(value) {
  return String(value).replaceAll("`", "\\`");
}

function sleep(ms, signal) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }, { once: true });
  });
}
