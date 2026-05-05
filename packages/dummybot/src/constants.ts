export const DEFAULT_CHUNK_MIN = 24;
export const DEFAULT_CHUNK_MAX = 96;

export const MAX_DEMO_CHARS = 8192;
export const MAX_DEMO_REASONING_CHARS = 8192;
export const MAX_DEMO_TOOL_SPECS = 16;
export const MAX_DEMO_STEPS = 32;
export const MAX_DEMO_COLLECTIONS = 16;
export const MAX_DEMO_RANDOM_ACTIONS = 64;
export const MAX_DEMO_CHAOS_TURNS = 16;
export const MAX_DEMO_CHAOS_ACTIONS = 64;
export const MAX_DEMO_DURATION_MS = 5 * 60 * 1000;
export const MAX_DEMO_DELAY_MS = 30 * 1000;
export const MAX_DEMO_CHUNK_CHARS = 512;
export const MAX_DEMO_STAGGER_MS = 30 * 1000;
export const MAX_DEMO_DURATION_SECONDS = MAX_DEMO_DURATION_MS / 1000;

export const LOREM_SENTENCES = [
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

export const MARKDOWN_LABELS = ["release notes", "ops runbook", "incident log", "design memo", "qa checklist", "support brief"];
export const MARKDOWN_URLS = [
  "https://dummybridge.local/docs/streaming",
  "https://dummybridge.local/docs/markdown",
  "https://dummybridge.local/runbooks/turns",
  "https://dummybridge.local/notes/demo-output",
  "https://dummybridge.local/reference/tooling",
];
export const MARKDOWN_EMPHASIS = ["high-signal", "operator-visible", "tool-safe", "incremental", "review-ready", "latency-sensitive"];
export const MARKDOWN_LIST_ITEMS = [
  "Confirm the seeded output changes shape between runs.",
  "Surface enough formatting to stress the renderer.",
  "Keep deltas readable while chunks arrive out of phase.",
  "Preserve stable output for deterministic test fixtures.",
  "Expose links, tables, and code blocks without extra flags.",
  "Keep the generated prose plausible enough for manual inspection.",
];
export const MARKDOWN_QUOTES = [
  "Streaming output should feel alive, not like the same paragraph repeated forever.",
  "Richer markdown gives the client something realistic to render while the turn is still open.",
  "Deterministic variety is more useful than perfect prose in a demo bridge.",
];
export const MARKDOWN_CODE = [
  'const preview = chunks.filter(Boolean).join("");',
  'writer.textDelta("| status | value |\\n| --- | --- |\\n");',
  "if (seeded) { return renderMarkdownBlocks(); }",
];
export const MARKDOWN_TABLE_HEADERS = [
  ["Metric", "Value", "Notes"],
  ["Phase", "Owner", "Status"],
  ["Artifact", "State", "Latency"],
];
export const MARKDOWN_TABLE_ROWS = [
  ["stream", "warming", "steady deltas"],
  ["renderer", "active", "accepts markdown"],
  ["tool call", "complete", "output persisted"],
  ["search step", "queued", "awaiting sources"],
  ["summary", "ready", "links attached"],
  ["review", "running", "formatting checks"],
];
