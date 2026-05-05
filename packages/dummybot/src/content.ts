import {
  LOREM_SENTENCES,
  MARKDOWN_CODE,
  MARKDOWN_EMPHASIS,
  MARKDOWN_LABELS,
  MARKDOWN_LIST_ITEMS,
  MARKDOWN_QUOTES,
  MARKDOWN_TABLE_HEADERS,
  MARKDOWN_TABLE_ROWS,
  MARKDOWN_URLS,
} from "./constants";
import { SeededRng } from "./rng";

interface SegmentSpec {
  weight: number;
  minLen: number;
  build: (rng: SeededRng, remaining: number) => string;
}

export function buildLoremText(chars: number, rng: SeededRng): string {
  if (chars <= 0) return "";
  let text = "";
  let lastIndex = -1;
  while (text.length < chars + 64) {
    let index = rng.intn(LOREM_SENTENCES.length);
    if (LOREM_SENTENCES.length > 1 && index === lastIndex) {
      index = (index + 1 + rng.intn(LOREM_SENTENCES.length - 1)) % LOREM_SENTENCES.length;
    }
    text += `${text ? " " : ""}${LOREM_SENTENCES[index]}`;
    lastIndex = index;
  }
  return trimLoremText(text, chars);
}

export function buildDemoVisibleText(chars: number, rng: SeededRng): string {
  if (chars <= 0) return "";
  const specs = demoVisibleSegmentSpecs();
  const blocks: string[] = [];
  let total = 0;
  const target = chars + Math.min(96, Math.max(24, Math.floor(chars / 6)));
  while (total < chars) {
    const remaining = target - total;
    let block = chooseDemoSegment(specs, rng, Math.max(remaining, 0));
    if (!block.trim()) block = buildLoremText(Math.min(Math.max(chars - total, 48), 160), forkRng(rng));
    blocks.push(block);
    total += block.length;
  }
  return trimDemoVisibleText(blocks.join("\n\n"), chars);
}

export function chunkText(text: string, rng: SeededRng, minChunk = 24, maxChunk = 96): string[] {
  if (!text.trim()) return [];
  if (minChunk <= 0) minChunk = 24;
  if (maxChunk < minChunk) maxChunk = minChunk;
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 0) {
    let size = minChunk;
    if (maxChunk > minChunk) size += rng.intn(maxChunk - minChunk + 1);
    if (size > rest.length) size = rest.length;
    chunks.push(rest.slice(0, size));
    rest = rest.slice(size);
  }
  return chunks;
}

export function splitCount(total: number, parts: number, index: number): number {
  if (total <= 0 || parts <= 0 || index < 0 || index >= parts) return 0;
  const base = Math.floor(total / parts);
  const remainder = total % parts;
  return index < remainder ? base + 1 : base;
}

export function sliceByStep(text: string, parts: number, index: number): string {
  if (parts <= 1 || !text) return text;
  let start = 0;
  for (let i = 0; i < index; i += 1) start += splitCount(text.length, parts, i);
  const length = splitCount(text.length, parts, index);
  if (start >= text.length || length <= 0) return "";
  return text.slice(start, Math.min(start + length, text.length));
}

export function sanitizeToolName(name: string): string {
  const cleaned = name.trim().toLowerCase().replaceAll(" ", "-").replaceAll("_", "-");
  return cleaned || "tool";
}

function demoVisibleSegmentSpecs(): SegmentSpec[] {
  return [
    {
      weight: 5,
      minLen: 48,
      build: (rng, remaining) => buildLoremText(Math.max(Math.min(72 + rng.intn(96), remaining > 0 ? remaining + 48 : 168), 48), forkRng(rng)),
    },
    {
      weight: 4,
      minLen: 96,
      build: (rng) => {
        const prefix = buildLoremText(72 + rng.intn(48), forkRng(rng));
        return `${prefix} Review the [${pick(MARKDOWN_LABELS, rng)}](${pick(MARKDOWN_URLS, rng)}) entry for **${pick(MARKDOWN_EMPHASIS, rng)}** output and _staged_ formatting transitions.`;
      },
    },
    {
      weight: 3,
      minLen: 96,
      build: (rng) => {
        const count = 2 + rng.intn(3);
        const lines: string[] = [];
        for (let i = 0; i < count; i += 1) {
          const item = MARKDOWN_LIST_ITEMS[(rng.intn(MARKDOWN_LIST_ITEMS.length) + i) % MARKDOWN_LIST_ITEMS.length];
          lines.push(`${rng.intn(4) === 0 ? "- [x]" : "-"} ${item}`);
        }
        return lines.join("\n");
      },
    },
    {
      weight: 2,
      minLen: 72,
      build: (rng) => `> ${pick(MARKDOWN_QUOTES, rng)}\n>\n> ${buildLoremText(48 + rng.intn(36), forkRng(rng))}`,
    },
    {
      weight: 2,
      minLen: 72,
      build: (rng) => `Use \`${sanitizeToolName(pick(MARKDOWN_LABELS, rng))}\` when the client needs a smaller incremental patch.\n\n\`\`\`js\n${pick(MARKDOWN_CODE, rng)}\n\`\`\``,
    },
    {
      weight: 2,
      minLen: 180,
      build: (rng) => {
        const header = pick(MARKDOWN_TABLE_HEADERS, rng);
        const lines = [`| ${header.join(" | ")} |`, "| --- | --- | --- |"];
        const rowCount = 2 + rng.intn(2);
        for (let i = 0; i < rowCount; i += 1) {
          const row = MARKDOWN_TABLE_ROWS[(rng.intn(MARKDOWN_TABLE_ROWS.length) + i) % MARKDOWN_TABLE_ROWS.length] ?? MARKDOWN_TABLE_ROWS[0]!;
          lines.push(`| ${row.join(" | ")} |`);
        }
        return lines.join("\n");
      },
    },
  ];
}

function chooseDemoSegment(specs: SegmentSpec[], rng: SeededRng, remaining: number): string {
  let candidates = specs.filter((spec) => remaining <= 0 || remaining >= spec.minLen / 2);
  if (!candidates.length) candidates = specs;
  const totalWeight = candidates.reduce((sum, spec) => sum + spec.weight, 0);
  let target = rng.intn(totalWeight);
  for (const spec of candidates) {
    target -= spec.weight;
    if (target < 0) return spec.build(rng, remaining);
  }
  return candidates[0]?.build(rng, remaining) ?? "";
}

function trimLoremText(value: string, limit: number): string {
  let text = value.trim();
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  if (limit < 24) return trimTrailingPunctuation(trimToWordBoundary(text.slice(0, limit)));
  const minCutoff = Math.max(1, Math.floor((limit * 3) / 4));
  for (let i = Math.min(limit, text.length); i >= minCutoff; i -= 1) {
    if ([".", "!", "?"].includes(text[i - 1] ?? "")) return text.slice(0, i).trim();
  }
  for (let i = Math.min(limit, text.length); i >= minCutoff; i -= 1) {
    if (text[i - 1] === " ") return trimTrailingPunctuation(text.slice(0, i).trim());
  }
  return trimTrailingPunctuation(text.slice(0, limit).trim());
}

function trimDemoVisibleText(value: string, limit: number): string {
  const text = value.trim();
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  const blocks = text.split("\n\n");
  if (blocks.length > 1) {
    const kept: string[] = [];
    let total = 0;
    for (const rawBlock of blocks) {
      const block = rawBlock.trim();
      if (!block) continue;
      const nextLen = total + block.length + (kept.length ? 2 : 0);
      if (nextLen > limit) break;
      kept.push(block);
      total = nextLen;
    }
    if (kept.length) return kept.join("\n\n");
  }
  return trimLoremText(text, limit);
}

function trimToWordBoundary(value: string): string {
  const text = value.trim();
  const index = text.lastIndexOf(" ");
  return index > 0 ? text.slice(0, index).trim() : text;
}

function trimTrailingPunctuation(value: string): string {
  return value.trim().replace(/[,;:]+$/u, "");
}

function pick<T>(items: T[], rng: SeededRng): T {
  return items[rng.intn(items.length)] as T;
}

function forkRng(rng: SeededRng): SeededRng {
  return new SeededRng(rng.int63());
}
