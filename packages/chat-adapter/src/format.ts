import {
  BaseFormatConverter,
  isCardElement,
  markdownToPlainText,
  parseMarkdown,
  stringifyMarkdown,
} from "chat";
import type { AdapterPostableMessage } from "chat";
import type { Root } from "mdast";
import { HTMLElement, NodeType, parse as parseHTML, type Node as HTMLNode } from "node-html-parser";
import { marked } from "marked";
import type { MatrixMentions } from "better-matrix-js";

export interface RenderedMatrixMessage {
  body: string;
  formattedBody?: string;
  mentions?: MatrixMentions;
}

export class MatrixFormatConverter extends BaseFormatConverter {
  fromAst(ast: Root): string {
    return stringifyMarkdown(ast);
  }

  toAst(markdown: string): Root {
    return parseMarkdown(markdown);
  }

  fromMatrixHTML(html: string): Root {
    return parseMarkdown(this.htmlToMarkdown(html));
  }

  htmlToMarkdown(html: string): string {
    const root = parseHTML(html);
    return normalizeMarkdownSpacing(renderHTMLNodesToMarkdown(root.childNodes));
  }

  renderPostableMessage(message: AdapterPostableMessage): RenderedMatrixMessage {
    if (typeof message === "string") {
      return this.renderPlainText(message);
    }
    if (isCardElement(message)) {
      assertMatrixSafeCard(message);
      return this.renderMarkdown(this.cardToFallbackText(message));
    }
    if ("raw" in message) {
      return this.renderPlainText(message.raw);
    }
    if ("markdown" in message) {
      return this.renderMarkdown(message.markdown);
    }
    if ("ast" in message) {
      return this.renderMarkdown(stringifyMarkdown(message.ast));
    }
    if ("card" in message) {
      assertMatrixSafeCard(message.card);
      return this.renderMarkdown(message.fallbackText ?? this.cardToFallbackText(message.card));
    }
    throw new Error("Invalid Matrix postable message");
  }

  protected mention(userId: string): string {
    return `@${matrixLocalpart(userId)}`;
  }

  private renderPlainText(text: string): RenderedMatrixMessage {
    const rendered = replaceMentionPlaceholders(escapeMarkdownText(text));
    if (rendered.userIds.length === 0) {
      return { body: text };
    }
    return {
      body: markdownToPlainText(rendered.markdown),
      formattedBody: markdownToMatrixHTML(rendered.markdown),
      mentions: { userIds: rendered.userIds },
    };
  }

  private renderMarkdown(markdown: string): RenderedMatrixMessage {
    const rendered = replaceMentionPlaceholders(markdown);
    const result: RenderedMatrixMessage = {
      body: markdownToPlainText(rendered.markdown),
      formattedBody: markdownToMatrixHTML(rendered.markdown),
    };
    if (rendered.userIds.length > 0) {
      result.mentions = { userIds: rendered.userIds };
    }
    return result;
  }
}

function assertMatrixSafeCard(card: unknown): void {
  if (hasUnsupportedCardInteractivity(card)) {
    throw new Error("Matrix adapter does not support interactive Chat SDK cards/actions. Send plain text or a non-interactive card fallback.");
  }
}

function hasUnsupportedCardInteractivity(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const type = value.type;
  if (
    type === "actions" ||
    type === "button" ||
    type === "link-button" ||
    type === "select" ||
    type === "radio_select" ||
    type === "text_input"
  ) {
    return true;
  }
  return Array.isArray(value.children) && value.children.some(hasUnsupportedCardInteractivity);
}

function markdownToMatrixHTML(markdown: string): string {
  return marked.parse(markdown, {
    async: false,
    breaks: true,
    gfm: true,
  }) as string;
}

function replaceMentionPlaceholders(markdown: string): { markdown: string; userIds: string[] } {
  const userIds = new Set<string>();
  const transformed = markdown.replace(/<@\(?(?<userId>@[^>\s)]+:[^>\s)]+)\)?>/gu, (_match, userId: string) => {
    userIds.add(userId);
    const label = escapeMarkdownLinkText(`@${matrixLocalpart(userId)}`);
    return `[${label}](https://matrix.to/#/${encodeURIComponent(userId)})`;
  });
  return { markdown: transformed, userIds: [...userIds] };
}

function renderHTMLNodesToMarkdown(nodes: HTMLNode[]): string {
  return nodes.map(renderHTMLNodeToMarkdown).join("");
}

function renderHTMLNodeToMarkdown(node: HTMLNode): string {
  if (node.nodeType === NodeType.TEXT_NODE) {
    return node.text;
  }
  if (!(node instanceof HTMLElement)) {
    return "";
  }
  const tagName = node.tagName.toLowerCase();
  const children = renderHTMLNodesToMarkdown(node.childNodes);
  switch (tagName) {
    case "mx-reply":
      return "";
    case "html":
    case "body":
    case "span":
      return children;
    case "br":
      return "\n";
    case "p":
    case "div":
      return children.trim() ? `${children.trim()}\n\n` : "";
    case "strong":
    case "b":
      return children ? `**${children}**` : "";
    case "em":
    case "i":
      return children ? `*${children}*` : "";
    case "del":
    case "s":
      return children ? `~~${children}~~` : "";
    case "code":
      return node.parentNode instanceof HTMLElement && node.parentNode.tagName.toLowerCase() === "pre"
        ? children
        : `\`${children}\``;
    case "pre": {
      const code = children.replace(/\n+$/u, "");
      return code ? `\n\`\`\`\n${code}\n\`\`\`\n\n` : "";
    }
    case "blockquote": {
      const quoted = children.trim();
      return quoted
        ? `${quoted
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")}\n\n`
        : "";
    }
    case "ul":
      return `${node.childNodes
        .map((child: HTMLNode) => renderListItem(child, null))
        .filter(Boolean)
        .join("\n")}\n\n`;
    case "ol":
      return `${node.childNodes
        .map((child: HTMLNode, index: number) => renderListItem(child, index + 1))
        .filter(Boolean)
        .join("\n")}\n\n`;
    case "a":
      return renderLink(node, children);
    case "img":
      return node.getAttribute("alt")?.trim() || "image";
    default:
      return children;
  }
}

function renderListItem(node: HTMLNode, ordinal: number | null): string {
  if (!(node instanceof HTMLElement) || node.tagName.toLowerCase() !== "li") {
    return "";
  }
  const content = normalizeMarkdownSpacing(renderHTMLNodesToMarkdown(node.childNodes));
  if (!content) {
    return "";
  }
  return `${ordinal === null ? "-" : `${ordinal}.`} ${content}`;
}

function renderLink(node: HTMLElement, children: string): string {
  const href = node.getAttribute("href")?.trim();
  const text = children || node.text;
  if (!href) {
    return text;
  }
  const userId = parseMatrixToUserId(href);
  if (userId) {
    return text || `@${matrixLocalpart(userId)}`;
  }
  return `[${escapeMarkdownLinkText(text || href)}](${href})`;
}

function parseMatrixToUserId(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.hostname !== "matrix.to") {
    return null;
  }
  const rawPath = url.hash.startsWith("#/") ? url.hash.slice(2) : url.hash;
  const firstSegment = rawPath.split("/")[0];
  if (!firstSegment) {
    return null;
  }
  const identifier = decodeURIComponent(firstSegment);
  return identifier.startsWith("@") ? identifier : null;
}

function normalizeMarkdownSpacing(markdown: string): string {
  return markdown.replace(/\n{3,}/gu, "\n\n").trim();
}

function escapeMarkdownText(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|>]/gu, "\\$&");
}

function escapeMarkdownLinkText(text: string): string {
  return text.replace(/[[\]\\]/gu, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function matrixLocalpart(userId: string): string {
  const withoutSigil = userId.startsWith("@") ? userId.slice(1) : userId;
  return withoutSigil.split(":")[0] || withoutSigil;
}
