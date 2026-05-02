import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Chat } from "chat";
import { FileMatrixStore, loadMatrixCoreFromNodePackage } from "better-matrix-js/node";
import { createMatrixAdapter, loginMatrix } from "@better-matrix-js/chat-adapter";
import { MemoryState } from "./memory-state.mjs";

const DEFAULT_INVITE = "@batuhan:beeper.com";
const DEFAULT_DELAY_MS = 180;

const loremSentenceCorpus = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit.",
  "Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.",
  "Integer nec odio praesent libero sed cursus ante dapibus diam.",
  "Nulla quis sem at nibh elementum imperdiet duis sagittis ipsum.",
  "Praesent mauris fusce nec tellus sed augue semper porta.",
  "Mauris massa vestibulum lacinia arcu eget nulla.",
  "Class aptent taciti sociosqu ad litora torquent per conubia nostra.",
  "In consectetur orci eu erat varius, vitae facilisis lorem blandit.",
  "Curabitur ullamcorper ultricies nisi nam eget dui etiam rhoncus.",
  "Donec sodales sagittis magna sed consequat leo eget bibendum sodales.",
  "Aliquam lorem ante dapibus in viverra quis feugiat a tellus.",
  "Phasellus viverra nulla ut metus varius laoreet quisque rutrum.",
];

const demoMarkdownLabels = ["release notes", "ops runbook", "incident log", "design memo", "qa checklist", "support brief"];
const demoMarkdownURLs = [
  "https://dummybridge.local/docs/streaming",
  "https://dummybridge.local/docs/markdown",
  "https://dummybridge.local/runbooks/turns",
  "https://dummybridge.local/notes/demo-output",
  "https://dummybridge.local/reference/tooling",
];
const demoMarkdownEmphasis = ["high-signal", "operator-visible", "tool-safe", "incremental", "review-ready", "latency-sensitive"];
const demoMarkdownListItems = [
  "Confirm the seeded output changes shape between runs.",
  "Surface enough formatting to stress the renderer.",
  "Keep deltas readable while chunks arrive out of phase.",
  "Preserve stable output for deterministic test fixtures.",
  "Expose links, tables, and code blocks without extra flags.",
  "Keep the generated prose plausible enough for manual inspection.",
];
const demoMarkdownQuoteCorpus = [
  "Streaming output should feel alive, not like the same paragraph repeated forever.",
  "Richer markdown gives the client something realistic to render while the turn is still open.",
  "Deterministic variety is more useful than perfect prose in a demo bridge.",
];
const demoMarkdownCodeSnippets = [
  'const preview = chunks.filter(Boolean).join("");',
  'writer.textDelta("| status | value |\\n| --- | --- |\\n");',
  "if (seeded) { return renderMarkdownBlocks(); }",
];
const demoMarkdownTableHeaders = [
  ["Metric", "Value", "Notes"],
  ["Phase", "Owner", "Status"],
  ["Artifact", "State", "Latency"],
];
const demoMarkdownTableRows = [
  ["stream", "warming", "steady deltas"],
  ["renderer", "active", "accepts markdown"],
  ["tool call", "complete", "output persisted"],
  ["search step", "queued", "awaiting sources"],
  ["summary", "ready", "links attached"],
  ["review", "running", "formatting checks"],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function env(name, fallback) {
  return process.env[name] || fallback;
}

async function main() {
  await loadEnvFile(process.env.MATRIX_ENV_FILE || "/Users/batuhan/Projects/labs/matrix-asks/.env");
  const homeserverUrl = env("MATRIX_HOMESERVER_URL", process.env.MATRIX_HOMESERVER);
  if (!homeserverUrl) throw new Error("Missing MATRIX_HOMESERVER_URL or MATRIX_HOMESERVER");
  const login = await resolveLogin(homeserverUrl);
  const inviteUserId = env("MATRIX_INVITE_USER_ID", DEFAULT_INVITE);
  const roomId =
    process.env.MATRIX_ROOM_ID || (await createSmokeRoom(homeserverUrl, login.accessToken, inviteUserId));
  console.log(`room_id=${roomId}`);
  console.log(`invited=${inviteUserId}`);
  const storeDir = env(
    "MATRIX_STORE_DIR",
    join(dirname(fileURLToPath(import.meta.url)), "..", ".matrix-store")
  );

  await mkdir(storeDir, { recursive: true });

  const matrix = createMatrixAdapter({
    accessToken: login.accessToken,
    createCore: () =>
      loadMatrixCoreFromNodePackage({
        host: { store: new FileMatrixStore(storeDir) },
      }),
    homeserverUrl,
    catchUpOnStart: process.env.MATRIX_CATCH_UP_ON_START === "1",
    inviteAutoJoin: { inviterAllowlist: [inviteUserId] },
    polling: { timeoutMs: 10_000 },
    recoveryKey: process.env.MATRIX_RECOVERY_KEY,
    userName: "matrix-stream-smoke",
  });

  const bot = new Chat({
    adapters: { matrix },
    fallbackStreamingPlaceholderText: "...",
    logger: "debug",
    onLockConflict: "force",
    state: new MemoryState(),
    streamingUpdateIntervalMs: 250,
    userName: "matrix-stream-smoke",
  });

  bot.onNewMention(async (thread, message) => {
    await thread.subscribe();
    await respond(matrix, thread, message);
  });

  bot.onSubscribedMessage(async (thread, message) => {
    await respond(matrix, thread, message);
  });

  await bot.initialize();
  const threadId = matrix.encodeThreadId({ roomId });
  const thread = bot.createThread(matrix, threadId, {}, false);
  await thread.subscribe();
  console.log(`subscribed_thread=${threadId}`);
  postWithTimeout(
    thread,
    [
      "Streaming smoke bot is online.",
      "Try: stream-lorem 4096 --reasoning=1200 --steps=3 --sources=4 --documents=3 --files=2 --meta --data=demo --data-transient=typing --delay-ms=80:220 --chunk-chars=48:160",
      "Also: stream-tools 2500 search#delta#prelim approval#deny weather#provider --reasoning=800 --steps=3, stream-random 20 --actions=24 --profile=artifacts, tools, error.",
    ].join("\n"),
    "initial online post"
  );

  console.log(`bot_user_id=${matrix.botUserId}`);
  console.log("waiting for Matrix messages; press Ctrl-C to stop");

  process.on("SIGINT", async () => {
    await bot.shutdown();
    process.exit(0);
  });
}

async function loadEnvFile(path) {
  if (!path) return;
  let text;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  const commentIndex = trimmed.search(/\s#/);
  return commentIndex === -1 ? trimmed : trimmed.slice(0, commentIndex).trim();
}

async function respond(matrix, thread, message) {
  const text = message.text.trim().toLowerCase();
  if (!text || message.author.isMe) return;
  console.log(`responding_to=${message.id} text=${JSON.stringify(message.text)}`);
  await thread.startTyping();
  const roomId = message.raw?.roomId;
  if (!roomId) {
    await thread.post(dummyAgentStream(text));
  } else {
    await matrix.stream(matrix.encodeThreadId({ roomId }), rawAgentStream(text));
  }
  console.log(`responded_to=${message.id}`);
}

function postWithTimeout(thread, message, label) {
  const timeoutMs = Number(process.env.MATRIX_BOOTSTRAP_POST_TIMEOUT_MS || 15000);
  Promise.race([
    thread.post(message),
    sleep(timeoutMs).then(() => {
      throw new Error(`${label} timed out after ${timeoutMs}ms`);
    }),
  ])
    .then(() => console.log(`${label}=ok`))
    .catch((error) => console.error(`${label}=failed`, error));
}

function readOption(tokens, name, fallback) {
  const prefix = `--${name}=`;
  const token = tokens.find((item) => item.startsWith(prefix));
  return token ? token.slice(prefix.length) : fallback;
}

function readOptionInt(tokens, name, fallback) {
  const value = Number.parseInt(readOption(tokens, name, String(fallback)), 10);
  return Number.isFinite(value) ? value : fallback;
}

function readRangeOption(tokens, name, fallbackMin, fallbackMax) {
  const raw = readOption(tokens, name, "");
  if (!raw) return { min: fallbackMin, max: fallbackMax };
  const [left, right = left] = raw.split(":");
  const min = Number.parseInt(left, 10);
  const max = Number.parseInt(right, 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: fallbackMin, max: fallbackMax };
  return { min: Math.max(0, Math.min(min, max)), max: Math.max(min, max) };
}

function makeRng(seed) {
  let state = BigInt.asUintN(32, BigInt(seed || 1));
  return () => {
    state = BigInt.asUintN(32, state * 1664525n + 1013904223n);
    return Number(state) / 0x100000000;
  };
}

function sampleInt(rng, min, max) {
  const lo = Math.floor(Math.min(min, max));
  const hi = Math.floor(Math.max(min, max));
  return lo + Math.floor(rng() * (hi - lo + 1));
}

function choice(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function buildLoremText(chars, rng) {
  if (chars <= 0) return "";
  let out = "";
  let last = -1;
  while (out.length < chars + 80) {
    let index = Math.floor(rng() * loremSentenceCorpus.length);
    if (index === last) index = (index + 1) % loremSentenceCorpus.length;
    out += `${out ? " " : ""}${loremSentenceCorpus[index]}`;
    last = index;
  }
  return trimAtWord(out, chars);
}

function buildDemoVisibleText(chars, rng) {
  if (chars <= 0) return "";
  const blocks = [];
  while (blocks.join("\n\n").length < chars + 120) {
    const kind = sampleInt(rng, 0, 5);
    if (kind === 0) {
      blocks.push(buildLoremText(sampleInt(rng, 160, 360), rng));
    } else if (kind === 1) {
      blocks.push(`${buildLoremText(sampleInt(rng, 90, 180), rng)} Review the [${choice(rng, demoMarkdownLabels)}](${choice(rng, demoMarkdownURLs)}) entry for **${choice(rng, demoMarkdownEmphasis)}** output and _staged_ formatting transitions.`);
    } else if (kind === 2) {
      blocks.push(Array.from({ length: sampleInt(rng, 2, 5) }, (_, index) => `- ${demoMarkdownListItems[(sampleInt(rng, 0, demoMarkdownListItems.length - 1) + index) % demoMarkdownListItems.length]}`).join("\n"));
    } else if (kind === 3) {
      blocks.push(`> ${choice(rng, demoMarkdownQuoteCorpus)}\n>\n> ${buildLoremText(sampleInt(rng, 80, 160), rng)}`);
    } else if (kind === 4) {
      blocks.push(`Use \`${sanitizeToolName(choice(rng, demoMarkdownLabels))}\` when the client needs a smaller incremental patch.\n\n\`\`\`js\n${choice(rng, demoMarkdownCodeSnippets)}\n\`\`\``);
    } else {
      const headers = choice(rng, demoMarkdownTableHeaders);
      const rows = Array.from({ length: sampleInt(rng, 2, 4) }, () => choice(rng, demoMarkdownTableRows));
      blocks.push([
        `| ${headers.join(" | ")} |`,
        `| ${headers.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.join(" | ")} |`),
      ].join("\n"));
    }
  }
  return trimAtWord(blocks.join("\n\n"), chars);
}

function chunkText(text, rng, min, max) {
  const chunks = [];
  let offset = 0;
  while (offset < text.length) {
    const size = sampleInt(rng, Math.max(1, min), Math.max(min, max));
    chunks.push(text.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function sliceByStep(text, steps, step) {
  if (steps <= 1) return text;
  const start = Math.floor((text.length * step) / steps);
  const end = Math.floor((text.length * (step + 1)) / steps);
  return text.slice(start, end);
}

function splitCount(total, steps, step) {
  if (!total || total <= 0) return 0;
  const start = Math.floor((total * step) / steps);
  const end = Math.floor((total * (step + 1)) / steps);
  return end - start;
}

function buildDemoMessageMetadata(command, seed, step) {
  return {
    command,
    completion_tokens: 200 + step,
    model: "dummybridge-demo",
    prompt_tokens: 100 + step,
    seed,
    step,
  };
}

function trimAtWord(text, chars) {
  if (text.length <= chars) return text;
  const sliced = text.slice(0, chars);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${sliced.slice(0, lastSpace > chars * 0.75 ? lastSpace : chars).trimEnd()}.`;
}

function sanitizeToolName(name) {
  return String(name || "tool").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
}

function titleize(value) {
  return sanitizeToolName(value).split("_").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function resolveLogin(homeserverUrl) {
  if (process.env.MATRIX_ACCESS_TOKEN) {
    return { accessToken: process.env.MATRIX_ACCESS_TOKEN };
  }
  if (!process.env.MATRIX_USERNAME || !process.env.MATRIX_PASSWORD) {
    throw new Error("Missing MATRIX_ACCESS_TOKEN or MATRIX_USERNAME/MATRIX_PASSWORD");
  }
  return loginMatrix({
    homeserverUrl,
    initialDeviceDisplayName: "matrix-chat-sdk streaming smoke",
    password: process.env.MATRIX_PASSWORD,
    username: process.env.MATRIX_USERNAME,
  });
}

async function createSmokeRoom(homeserverUrl, accessToken, inviteUserId) {
  const encrypted = process.env.MATRIX_ENCRYPTED_ROOM !== "0";
  const response = await fetch(new URL("/_matrix/client/v3/createRoom", homeserverUrl), {
    body: JSON.stringify({
      invite: [inviteUserId],
      initial_state: encrypted
        ? [
            {
              content: {
                algorithm: "m.megolm.v1.aes-sha2",
                rotation_period_ms: 604800000,
                rotation_period_msgs: 100,
              },
              state_key: "",
              type: "m.room.encryption",
            },
          ]
        : [],
      is_direct: false,
      name: `matrix-chat-sdk streaming smoke ${new Date().toISOString()}`,
      preset: "private_chat",
      topic: "Live Matrix Chat SDK streaming smoke test",
    }),
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`Create room failed: HTTP ${response.status} ${JSON.stringify(data)}`);
  }
  return data.room_id;
}

async function* dummyAgentStream(text) {
  for await (const chunk of rawAgentStream(text)) {
    if (chunk.type === "reasoning-start" || chunk.type === "reasoning-delta" || chunk.type === "reasoning-end") {
      continue;
    }
    yield chunk;
  }
}

async function* rawAgentStream(text) {
  const command = parseSmokeCommand(text);
  if (command.kind === "lorem") {
    yield* streamLoremCommand(command);
    return;
  }
  if (command.kind === "tools") {
    yield* streamToolsCommand(command);
    return;
  }
  if (command.kind === "random") {
    yield* streamRandomCommand(command);
    return;
  }
  yield* streamFullDemo(text, {
    chars: text.includes("long") ? 6000 : 1800,
    reasoning: 900,
    steps: 2,
    sources: 3,
    documents: 2,
    files: 1,
    meta: true,
    data: "smoke-run",
    dataTransient: "plan-update",
    delayMin: Number(process.env.MATRIX_SMOKE_STREAM_DELAY_MS || DEFAULT_DELAY_MS),
    delayMax: Number(process.env.MATRIX_SMOKE_STREAM_DELAY_MS || DEFAULT_DELAY_MS),
    chunkMin: 48,
    chunkMax: 140,
    seed: 42,
    tools: defaultToolSpecs(text),
    finishReason: "stop",
    error: text.includes("error"),
  });
}

function parseSmokeCommand(text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const name = tokens[0]?.toLowerCase();
  if (name === "stream-lorem") {
    const chars = clamp(parseInt(tokens[1] || "4096", 10) || 4096, 1, 20000);
    return { kind: "lorem", ...parseCommonOptions(tokens.slice(2)), chars };
  }
  if (name === "stream-tools") {
    const chars = clamp(parseInt(tokens[1] || "4096", 10) || 4096, 1, 20000);
    const toolTokens = tokens.slice(2).filter((token) => !token.startsWith("--"));
    const optionTokens = tokens.slice(2).filter((token) => token.startsWith("--"));
    return {
      kind: "tools",
      ...parseCommonOptions(optionTokens),
      chars,
      tools: toolTokens.length ? toolTokens.map(parseToolToken) : defaultToolSpecs("tools"),
    };
  }
  if (name === "stream-random" || name === "stream-chaos") {
    return {
      kind: "random",
      ...parseCommonOptions(tokens.slice(1)),
      actions: readOptionInt(tokens, "actions", 32),
      chars: readOptionInt(tokens, "chars", 6000),
      profile: readOption(tokens, "profile", "balanced"),
      seed: readOptionInt(tokens, "seed", 12345),
    };
  }
  return { kind: "full" };
}

function parseCommonOptions(tokens) {
  const delay = readRangeOption(tokens, "delay-ms", DEFAULT_DELAY_MS, DEFAULT_DELAY_MS);
  const chunk = readRangeOption(tokens, "chunk-chars", 48, 160);
  return {
    abort: tokens.includes("--abort"),
    chunkMax: chunk.max,
    chunkMin: chunk.min,
    data: readOption(tokens, "data", "demo"),
    dataTransient: readOption(tokens, "data-transient", "demo-transient"),
    delayMax: delay.max,
    delayMin: delay.min,
    documents: readOptionInt(tokens, "documents", 2),
    error: tokens.includes("--error"),
    files: readOptionInt(tokens, "files", 1),
    finishReason: readOption(tokens, "finish", "stop"),
    meta: tokens.includes("--meta"),
    reasoning: readOptionInt(tokens, "reasoning", 1200),
    seed: readOptionInt(tokens, "seed", 42),
    sources: readOptionInt(tokens, "sources", 3),
    steps: readOptionInt(tokens, "steps", 2),
  };
}

async function* streamLoremCommand(command) {
  yield* streamFullDemo("stream-lorem", {
    ...command,
    tools: [],
  });
}

async function* streamToolsCommand(command) {
  yield* streamFullDemo("stream-tools", command);
}

async function* streamRandomCommand(command) {
  const rng = makeRng(command.seed);
  const toolPool = [
    { name: "search", delta: true, preliminary: true, provider: true },
    { name: "fetch", fail: true, provider: true },
    { name: "approval", deny: true },
    { name: "render_artifact", provider: true },
  ];
  const tools = [];
  for (let i = 0; i < Math.min(command.actions, 12); i++) {
    const spec = { ...toolPool[sampleInt(rng, 0, toolPool.length - 1)], tags: ["random", command.profile] };
    tools.push(spec);
  }
  yield* streamFullDemo("stream-random", {
    ...command,
    documents: command.profile === "artifacts" ? 6 : command.documents,
    files: command.profile === "artifacts" ? 4 : command.files,
    sources: command.profile === "artifacts" ? 6 : command.sources,
    steps: Math.max(command.steps, 4),
    tools,
  });
}

function parseToolToken(token, index) {
  const [name, ...tags] = token.split("#");
  return {
    approval: tags.includes("approval"),
    delta: tags.includes("delta"),
    deny: tags.includes("deny"),
    displayTitle: titleize(name),
    fail: tags.includes("fail"),
    inputError: tags.includes("inputerror"),
    name: name || `tool_${index + 1}`,
    preliminary: tags.includes("prelim"),
    provider: tags.includes("provider"),
    tags,
  };
}

function defaultToolSpecs(text) {
  return [
    { name: "lookup_room_context", delta: true, preliminary: true, provider: true, tags: ["context"] },
    { name: "approval_gate", deny: true, tags: ["approval"] },
    { name: "dummy_weather", fail: text.includes("error"), provider: true, tags: ["weather"] },
  ];
}

async function* emitDecorations(options, step, steps, pause) {
  if (options.meta) {
    yield { messageMetadata: buildDemoMessageMetadata("demo", options.seed, step + 1), type: "message-metadata" };
    await pause();
  }
  for (let i = 0; i < splitCount(options.sources, steps, step); i++) {
    yield {
      providerMetadata: { dummybridge: { step: step + 1, type: "source-url" }, siteName: "DummyBridge", site_name: "DummyBridge" },
      sourceId: `source-url-${step + 1}-${i + 1}`,
      title: `Demo Source ${step + 1}.${i + 1}`,
      type: "source-url",
      url: `https://dummybridge.local/source/${step + 1}-${i + 1}`,
    };
    await pause();
  }
  for (let i = 0; i < splitCount(options.documents, steps, step); i++) {
    yield {
      filename: `demo-doc-${step + 1}-${i + 1}.txt`,
      mediaType: "text/plain",
      providerMetadata: { dummybridge: { step: step + 1, type: "source-document" } },
      sourceId: `demo-doc-${step + 1}-${i + 1}`,
      title: `Demo Document ${step + 1}.${i + 1}`,
      type: "source-document",
    };
    await pause();
  }
  for (let i = 0; i < splitCount(options.files, steps, step); i++) {
    yield {
      mediaType: "application/octet-stream",
      providerMetadata: { dummybridge: { step: step + 1, type: "file" } },
      type: "file",
      url: `mxc://dummybridge/demo-file-${step + 1}-${i + 1}`,
    };
    await pause();
  }
  if (step === 0 && options.data) {
    yield { data: { mode: "persistent", stage: step + 1 }, id: options.data, type: `data-${options.data}` };
    await pause();
  }
  if (step === 0 && options.dataTransient) {
    yield { data: { mode: "transient", stage: step + 1 }, id: options.dataTransient, transient: true, type: `data-${options.dataTransient}` };
    await pause();
  }
}

async function* streamToolSpec(spec, sequence, pause, rng, options) {
  const toolCallId = `dummy-tool-${sequence}-${sanitizeToolName(spec.name)}`;
  const toolName = sanitizeToolName(spec.name);
  const input = { sequence, tags: spec.tags ?? [], tool: spec.name };
  yield {
    dynamic: true,
    providerExecuted: spec.provider === true,
    providerMetadata: { dummybridge: { tags: spec.tags ?? [] } },
    title: spec.displayTitle || titleize(spec.name),
    toolCallId,
    toolName,
    type: "tool-input-start",
  };
  await pause();
  if (spec.inputError) {
    yield {
      dynamic: true,
      errorText: "DummyBridge synthetic input error",
      input,
      providerExecuted: spec.provider === true,
      title: spec.displayTitle || titleize(spec.name),
      toolCallId,
      toolName,
      type: "tool-input-error",
    };
    await pause();
  } else if (spec.delta) {
    for (const chunk of chunkText(JSON.stringify(input), rng, options.chunkMin, options.chunkMax)) {
      yield { inputTextDelta: chunk, toolCallId, type: "tool-input-delta" };
      await pause();
    }
  }
  yield {
    dynamic: true,
    input,
    providerExecuted: spec.provider === true,
    title: spec.displayTitle || titleize(spec.name),
    toolCallId,
    toolName,
    type: "tool-input-available",
  };
  await pause();
  if (spec.preliminary) {
    yield { output: { status: "streaming", tool: spec.name }, preliminary: true, providerExecuted: spec.provider === true, toolCallId, type: "tool-output-available" };
    await pause();
  }
  if (spec.approval || spec.deny) {
    const approvalId = `approval-${sequence}-${sanitizeToolName(spec.name)}`;
    yield { approvalId, toolCallId, type: "tool-approval-request" };
    await pause();
    yield { approvalId, approved: !spec.deny, reason: spec.deny ? "Denied automatically by smoke test" : "Approved automatically by smoke test", toolCallId, type: "tool-approval-response" };
    await pause();
    if (spec.deny) {
      yield { toolCallId, type: "tool-output-denied" };
      await pause();
      return;
    }
  }
  if (spec.fail || spec.inputError) {
    yield { errorText: "DummyBridge synthetic tool failure", providerExecuted: spec.provider === true, toolCallId, type: "tool-output-error" };
    await pause();
    return;
  }
  yield {
    output: { sequence, status: "ok", tags: spec.tags ?? [], tool: spec.name },
    providerExecuted: spec.provider === true,
    toolCallId,
    type: "tool-output-available",
  };
  await pause();
}

async function* streamFullDemo(text, options) {
  const rng = makeRng(options.seed ?? 1);
  const pause = () => sleep(sampleInt(rng, options.delayMin, options.delayMax));
  const visible = buildDemoVisibleText(options.chars, rng);
  const reasoning = buildLoremText(options.reasoning, rng);
  const steps = Math.max(1, options.steps || 1);

  yield { messageMetadata: buildDemoMessageMetadata("beeper-streaming-smoke", options.seed ?? 1, 0), type: "message-metadata" };
  await pause();
  yield { id: "reasoning-smoke", type: "reasoning-start" };
  for (const chunk of chunkText(reasoning, rng, options.chunkMin, options.chunkMax)) {
    yield { delta: chunk, id: "reasoning-smoke", type: "reasoning-delta" };
    await pause();
  }
  yield { id: "reasoning-smoke", type: "reasoning-end" };
  await pause();

  yield { text: `I heard: \`${text}\`\n\n`, type: "markdown_text" };
  await pause();

  for (let step = 0; step < steps; step++) {
    yield { type: "start-step" };
    await pause();
    yield* emitDecorations(options, step, steps, pause);
    for (const chunk of chunkText(sliceByStep(visible, steps, step), rng, options.chunkMin, options.chunkMax)) {
      yield { text: chunk, type: "markdown_text" };
      await pause();
    }
    const tool = options.tools?.[step];
    if (tool) {
      yield* streamToolSpec(tool, step + 1, pause, rng, options);
    }
    yield { type: "finish-step" };
    await pause();
  }

  for (const tool of options.tools?.slice(steps) ?? []) {
    yield* streamToolSpec(tool, options.tools.indexOf(tool) + 1, pause, rng, options);
  }

  if (options.abort) {
    yield { reason: "DummyBridge synthetic abort", type: "abort" };
    return;
  }
  if (options.error) {
    yield { errorText: "DummyBridge synthetic error", type: "error" };
    yield { text: "\nDummyBridge synthetic error was emitted.", type: "markdown_text" };
    return;
  }
  yield {
    finishReason: options.finishReason || "stop",
    messageMetadata: { finish_reason: options.finishReason || "stop", model: "dummybridge-demo" },
    type: "finish",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
