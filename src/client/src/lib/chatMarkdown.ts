/**
 * Safe, dependency-free Markdown for chat answers (saved and streaming).
 *
 * This module is pure: text in, a small typed tree out. It never produces HTML, never throws, and tolerates
 * partial streaming input (unterminated fences/emphasis/links/directives) without crashing or flashing raw
 * machine syntax. Rendering lives in components/terminal/ChatMarkdown.tsx and builds React elements only.
 */
import type { ConversationRuntimeEvent } from "@shared/conversationRuntime";
import { humanizeSourceRef } from "./runtimeTraceSummary";

export type Inline =
  | { t: "text"; v: string }
  | { t: "br" }
  | { t: "strong"; c: Inline[] }
  | { t: "em"; c: Inline[] }
  | { t: "del"; c: Inline[] }
  | { t: "code"; v: string }
  /** `href` is always already validated by `safeHref`; unsafe links never become link nodes. */
  | { t: "link"; href: string; c: Inline[] }
  /** A citation candidate. It is only rendered as an affordance when it resolves to a real source. */
  | { t: "cite"; raw: string; nums: number[]; name: string | null };

export type Align = "left" | "center" | "right" | null;

export type Block =
  | { t: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; c: Inline[] }
  | { t: "p"; c: Inline[] }
  | { t: "code"; lang: string | null; v: string; open: boolean }
  | { t: "list"; ordered: boolean; start: number; items: Block[][] }
  | { t: "quote"; c: Block[] }
  | { t: "table"; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { t: "hr" };

export interface ChatCitationSource {
  /** Stable reference as recorded by the runtime (a sourceRef or evidence reference). */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Only present for http(s) references. */
  href?: string | null;
  /** Citation number only when the runtime explicitly assigned one to this source. Numeric markers never resolve without it. */
  index?: number;
}

const MAX_DEPTH = 6;
const DIRECTIVE_RE = /<<[A-Za-z][A-Za-z0-9_]*:[^>\n]*>>/g;
const PARTIAL_DIRECTIVE_RE = /<<(?:[A-Za-z][A-Za-z0-9_]{0,31}(?::[^>\n]*)?)?>?$/;
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Removes machine directives (`<<NAVIGATE:...>>`, `<<WORKSPACE_*:...>>`) and, while streaming, a trailing unfinished
 * one. Fenced code is user-visible content and is never altered: directives inside a fence stay, blank lines inside a
 * fence are not collapsed.
 */
export function stripMachineDirectives(text: string, streaming = false): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let prose: string[] = [];
  let fence: { char: string; length: number } | null = null;
  const flushProse = (last: boolean) => {
    if (!prose.length) return;
    let chunk = prose.join("\n").replace(DIRECTIVE_RE, "");
    if (last && streaming) chunk = chunk.replace(PARTIAL_DIRECTIVE_RE, "");
    out.push(chunk.replace(/\n{3,}/g, "\n\n"));
    prose = [];
  };
  for (const line of lines) {
    if (fence) {
      out.push(line);
      const closing = FENCE_LINE_RE.exec(line);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length && !line.slice(closing[0].length).trim()) fence = null;
      continue;
    }
    const opening = FENCE_LINE_RE.exec(line);
    if (opening) {
      flushProse(false);
      fence = { char: opening[1][0], length: opening[1].length };
      out.push(line);
      continue;
    }
    prose.push(line);
  }
  flushProse(true);
  return out.join("\n").replace(/^\s*\n/, "").replace(/\s+$/, (trailing) => (fence ? trailing.replace(/\n+$/, "") : ""));
}

/** Only http(s) and mailto links with no embedded credentials are ever allowed to become clickable. */
export function safeHref(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 2048) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s<>"]/.test(value)) return null;
  if (!/^(?:https?:\/\/|mailto:)/i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol === "mailto:") return url.pathname ? url.href : null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Inline                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

interface InlineContext {
  streaming: boolean;
  inLink: boolean;
}

const ESCAPABLE = new Set(["\\", "`", "*", "_", "{", "}", "[", "]", "(", ")", "#", "+", "-", ".", "!", "|", "~", "<", ">"]);
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isAlnum = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

function findClosingBacktickRun(src: string, from: number, run: number): number {
  let index = src.indexOf("`".repeat(run), from);
  while (index !== -1) {
    if (src[index - 1] !== "`" && src[index + run] !== "`") return index;
    index = src.indexOf("`".repeat(run), index + 1);
  }
  return -1;
}

/** Index of the `]` matching the `[` at `open`, or -1. Skips escapes and code spans. */
function findClosingBracket(src: string, open: number): number {
  let depth = 0;
  const limit = Math.min(src.length, open + 2000);
  for (let i = open; i < limit; i++) {
    const ch = src[i];
    if (ch === "\\") { i++; continue; }
    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const end = findClosingBacktickRun(src, i + run, run);
      if (end !== -1) { i = end + run - 1; continue; }
      i += run - 1;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Parses `(url "title")` starting at the `(`. Returns the url and the index just after `)`, or null. */
function parseLinkDestination(src: string, open: number): { url: string; end: number } | null {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\n") return null;
    if (ch === "\\") { i++; continue; }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        const inner = src.slice(open + 1, i).trim();
        const url = inner.startsWith("<") && inner.includes(">") ? inner.slice(1, inner.indexOf(">")) : inner.split(/\s+/)[0] ?? "";
        return { url, end: i + 1 };
      }
    }
  }
  return null;
}

function expandCitationNumbers(label: string): number[] | null {
  if (!/^\s*\d{1,3}(?:\s*(?:,|;|[-–])\s*\d{1,3})*\s*$/.test(label)) return null;
  const numbers: number[] = [];
  const parts = label.split(/\s*[,;]\s*/);
  for (const part of parts) {
    const range = /^\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*$/.exec(part);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      if (to < from || to - from > 20) return null;
      for (let n = from; n <= to; n++) numbers.push(n);
    } else {
      const n = Number(part.trim());
      if (!Number.isInteger(n)) return null;
      numbers.push(n);
    }
  }
  return numbers.length && numbers.length <= 20 ? numbers : null;
}

function trimUrlTail(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1];
    if (last && /[.,;:!?'"*_]/.test(last)) { out = out.slice(0, -1); continue; }
    if (last === ")" && !out.includes("(")) { out = out.slice(0, -1); continue; }
    if (last === "]" || last === "}") { out = out.slice(0, -1); continue; }
    return out;
  }
}

export function parseInline(src: string, context: InlineContext = { streaming: false, inLink: false }, depth = 0): Inline[] {
  const noCloser: Record<string, true> = {};
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) { out.push({ t: "text", v: buffer }); buffer = ""; }
  };
  if (depth > MAX_DEPTH) return src ? [{ t: "text", v: src }] : [];

  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    if (ch === "\\" && i + 1 < src.length && ESCAPABLE.has(src[i + 1])) {
      buffer += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === "\n") { flush(); out.push({ t: "br" }); i++; continue; }

    if (ch === "`") {
      let run = 1;
      while (src[i + run] === "`") run++;
      const end = findClosingBacktickRun(src, i + run, run);
      if (end === -1) {
        if (context.streaming) { flush(); out.push({ t: "code", v: src.slice(i + run).replace(/\n/g, " ") }); return out; }
        buffer += "`".repeat(run);
        i += run;
        continue;
      }
      let value = src.slice(i + run, end).replace(/\n/g, " ");
      if (value.length > 1 && value.startsWith(" ") && value.endsWith(" ") && value.trim()) value = value.slice(1, -1);
      flush();
      out.push({ t: "code", v: value });
      i = end + run;
      continue;
    }

    if (ch === "!" && src[i + 1] === "[") {
      // Images are never fetched or rendered. Show their alt text as inert text.
      const close = findClosingBracket(src, i + 1);
      if (close !== -1 && src[close + 1] === "(") {
        const destination = parseLinkDestination(src, close + 1);
        if (destination) {
          buffer += src.slice(i + 2, close);
          i = destination.end;
          continue;
        }
      }
      buffer += ch;
      i++;
      continue;
    }

    if (ch === "[" && !context.inLink) {
      const close = findClosingBracket(src, i);
      if (close === -1) {
        // Streaming: `[label` or `[1` is still arriving; do not flash the bracket.
        if (context.streaming && !src.slice(i + 1).includes("\n")) { i++; continue; }
        buffer += ch;
        i++;
        continue;
      }
      const label = src.slice(i + 1, close);
      if (src[close + 1] === "(") {
        const destination = parseLinkDestination(src, close + 1);
        if (destination) {
          const href = safeHref(destination.url);
          const children = parseInline(label, { ...context, inLink: true }, depth + 1);
          flush();
          // Unsafe destinations (javascript:, data:, relative, ...) leave only the inert label.
          if (href) out.push({ t: "link", href, c: children }); else out.push(...children);
          i = destination.end;
          continue;
        }
        if (context.streaming && !src.slice(close + 2).includes(")")) {
          // `[label](https://exa` is still arriving: show just the label.
          flush();
          out.push(...parseInline(label, { ...context, inLink: true }, depth + 1));
          return out;
        }
      }
      const nums = expandCitationNumbers(label);
      const named = /^\s*(?:source|sources|src|ref)\s*:\s*(.+?)\s*$/i.exec(label);
      if (nums || named) {
        flush();
        out.push({ t: "cite", raw: src.slice(i, close + 1), nums: nums ?? [], name: nums ? null : named![1] });
        i = close + 1;
        continue;
      }
      buffer += ch;
      i++;
      continue;
    }

    if (ch === "<") {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(src.slice(i, i + 2100));
      if (auto && !context.inLink) {
        const href = safeHref(auto[1]);
        if (href) {
          flush();
          out.push({ t: "link", href, c: [{ t: "text", v: auto[1] }] });
          i += auto[0].length;
          continue;
        }
      }
      buffer += ch; // raw HTML is plain text, never markup
      i++;
      continue;
    }

    if ((ch === "h" || ch === "H") && !context.inLink && !isAlnum(src[i - 1]) && /^https?:\/\//i.test(src.slice(i, i + 8))) {
      const match = /^https?:\/\/[^\s<]+/i.exec(src.slice(i, i + 2100));
      if (match) {
        const url = trimUrlTail(match[0]);
        const href = safeHref(url);
        if (href) {
          flush();
          out.push({ t: "link", href, c: [{ t: "text", v: url }] });
          i += url.length;
          continue;
        }
      }
    }

    if ((ch === "*" || ch === "_" || ch === "~") && depth < MAX_DEPTH) {
      const double = src[i + 1] === ch;
      const delimiter = double ? ch + ch : ch;
      const width = delimiter.length;
      const canOpen = ch === "~"
        ? double && !isSpace(src[i + width])
        : !isSpace(src[i + width]) && (ch === "*" || !isAlnum(src[i - 1]));
      if (canOpen && (ch !== "~" || double)) {
        let close = -1;
        if (noCloser[delimiter]) { buffer += delimiter; i += width; continue; }
        let j = i + width;
        while (j < src.length) {
          if (src[j] === "\\") { j += 2; continue; }
          if (src[j] === "`") {
            let run = 1;
            while (src[j + run] === "`") run++;
            const end = findClosingBacktickRun(src, j + run, run);
            j = end === -1 ? j + run : end + run;
            continue;
          }
          if (src.startsWith(delimiter, j)) {
            if (!double && src[j + 1] === ch) { j += 2; continue; } // part of a `**` run
            const afterOk = ch === "_" && !double ? !isAlnum(src[j + 1]) : true;
            if (!isSpace(src[j - 1]) && afterOk && j > i + width) { close = j; break; }
          }
          j++;
        }
        if (close === -1) noCloser[delimiter] = true;
        if (close !== -1) {
          const children = parseInline(src.slice(i + width, close), context, depth + 1);
          flush();
          out.push({ t: ch === "~" ? "del" : double ? "strong" : "em", c: children });
          i = close + width;
          continue;
        }
        if (context.streaming && ch !== "~") {
          // Unclosed emphasis while streaming: format to the end rather than flashing literal markers.
          const children = parseInline(src.slice(i + width), context, depth + 1);
          flush();
          out.push({ t: double ? "strong" : "em", c: children });
          return out;
        }
      }
    }

    buffer += ch;
    i++;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------------------------------------ */
/* Blocks                                                                                            */
/* ------------------------------------------------------------------------------------------------ */

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const LIST_RE = /^( {0,12})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const TABLE_DELIMITER_RE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

const leadingSpaces = (line: string) => line.length - line.trimStart().length;

function splitTableRow(line: string): string[] {
  let body = line.trim();
  if (body.startsWith("|")) body = body.slice(1);
  if (body.endsWith("|") && !body.endsWith("\\|")) body = body.slice(0, -1);
  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && body[i + 1] === "|") { cell += "|"; i++; continue; }
    if (ch === "`") inCode = !inCode;
    if (ch === "|" && !inCode) { cells.push(cell.trim()); cell = ""; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function startsInterruptingBlock(line: string): boolean {
  if (FENCE_RE.test(line) || HEADING_RE.test(line) || HR_RE.test(line) || QUOTE_RE.test(line)) return true;
  const list = LIST_RE.exec(line);
  return !!list && (!/\d/.test(list[2][0]) || parseInt(list[2], 10) === 1);
}

function tableStartsAt(lines: string[], index: number, streaming: boolean): boolean {
  const header = lines[index];
  const delimiter = lines[index + 1];
  if (header === undefined || delimiter === undefined || !header.includes("|") || !delimiter.includes("-")) return false;
  if (TABLE_DELIMITER_RE.test(delimiter) && splitTableRow(header).length === splitTableRow(delimiter).length) return true;
  // Streaming: the delimiter row may itself be only partially received (`|---|`, `|---|--`).
  return streaming && index + 1 === lines.length - 1 && /^[\s|:-]+$/.test(delimiter) && splitTableRow(delimiter).length <= splitTableRow(header).length;
}

function parseTable(lines: string[], start: number, streaming: boolean, inline: InlineContext): [Block, number] {
  const head = splitTableRow(lines[start]);
  const delimiterCells = TABLE_DELIMITER_RE.test(lines[start + 1]) ? splitTableRow(lines[start + 1]) : [];
  const align: Align[] = head.map((_, column) => {
    const cell = delimiterCells[column] ?? "";
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    return left && right ? "center" : right ? "right" : left ? "left" : null;
  });
  const rows: Inline[][][] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !FENCE_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) && !QUOTE_RE.test(lines[i])) {
    const cells = splitTableRow(lines[i]);
    rows.push(head.map((_, column) => parseInline(cells[column] ?? "", inline, 1)));
    i++;
  }
  return [{ t: "table", align, head: head.map((cell) => parseInline(cell, inline, 1)), rows }, i];
}

function parseList(lines: string[], start: number, depth: number, streaming: boolean): [Block, number] {
  const first = LIST_RE.exec(lines[start])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2][0]);
  const startNumber = ordered ? parseInt(first[2], 10) : 1;
  const items: string[][] = [];
  let current: string[] | null = null;
  const dedent = new RegExp(`^ {0,${baseIndent + 2}}`);
  let i = start;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      let k = i + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      if (k >= lines.length) break;
      const next = lines[k];
      const nextMatch = LIST_RE.exec(next);
      const nextIndent = leadingSpaces(next);
      if (nextMatch && nextIndent - baseIndent >= 0 && nextIndent - baseIndent < 2 && /\d/.test(nextMatch[2][0]) === ordered) { i = k; continue; }
      if (nextIndent >= baseIndent + 2 && current) { current.push(""); i++; continue; }
      break;
    }
    const match = LIST_RE.exec(line);
    const indent = leadingSpaces(line);
    if (match && indent < baseIndent) break;
    if (match && indent - baseIndent < 2) {
      if (/\d/.test(match[2][0]) !== ordered) break;
      current = [match[3]];
      items.push(current);
      i++;
      continue;
    }
    if (!current) break;
    if (indent >= baseIndent + 2) {
      current.push(line.replace(dedent, ""));
      i++;
      continue;
    }
    // Lazy continuation of the current item's paragraph.
    if (current.length && current[current.length - 1].trim() && !startsInterruptingBlock(line)) {
      current.push(line.trim());
      i++;
      continue;
    }
    break;
  }
  return [{ t: "list", ordered, start: startNumber, items: items.map((item, index) => parseBlockLines(item, depth + 1, streaming && index === items.length - 1)) }, i];
}

function parseBlocksRaw(lines: string[], depth: number, streaming: boolean, starts?: number[]): Block[] {
  const blocks: Block[] = [];
  const inline: InlineContext = { streaming, inLink: false };
  if (depth > MAX_DEPTH) {
    const text = lines.join("\n").trim();
    return text ? [{ t: "p", c: [{ t: "text", v: text }] }] : [];
  }
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    starts?.push(i);

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      let j = i + 1;
      let closed = false;
      const closing = new RegExp(`^ {0,3}${marker[0] === "`" ? "`" : "~"}{${marker.length},}[ \\t]*$`);
      while (j < lines.length) {
        if (closing.test(lines[j])) { closed = true; j++; break; }
        body.push(lines[j]);
        j++;
      }
      blocks.push({ t: "code", lang: fence[2] || null, v: body.join("\n"), open: !closed });
      i = j;
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({ t: "heading", level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, c: parseInline(heading[2], inline, 1) });
      i++;
      continue;
    }

    if (HR_RE.test(line)) { blocks.push({ t: "hr" }); i++; continue; }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) { quoted.push(QUOTE_RE.exec(lines[i])![1]); i++; }
      blocks.push({ t: "quote", c: parseBlockLines(quoted, depth + 1, streaming) });
      continue;
    }

    if (tableStartsAt(lines, i, streaming)) {
      const [table, next] = parseTable(lines, i, streaming, inline);
      blocks.push(table);
      i = next;
      continue;
    }

    if (LIST_RE.test(line)) {
      const [list, next] = parseList(lines, i, depth, streaming);
      blocks.push(list);
      i = next;
      continue;
    }

    const paragraph: string[] = [line.trimEnd()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsInterruptingBlock(lines[i]) && !tableStartsAt(lines, i, streaming)) {
      paragraph.push(lines[i].trimEnd());
      i++;
    }
    blocks.push({ t: "p", c: parseInline(paragraph.join("\n").trim(), inline, 0) });
  }
  return blocks;
}

/**
 * Streaming leniency (open fences, unclosed emphasis, half-received links and tables) applies only to the FINAL block.
 * Earlier blocks are finished and are parsed strictly, so a stray marker there stays literal and never reshapes
 * the rest of the answer. Each block is parsed once plus one re-parse of the tail, so the cost stays linear.
 */
function parseBlockLines(lines: string[], depth: number, streaming: boolean): Block[] {
  if (!streaming) return parseBlocksRaw(lines, depth, false);
  const starts: number[] = [];
  const blocks = parseBlocksRaw(lines, depth, false, starts);
  if (!blocks.length) return blocks;
  if (starts.length !== blocks.length) return parseBlocksRaw(lines, depth, true);
  return [...blocks.slice(0, -1), ...parseBlocksRaw(lines.slice(starts[starts.length - 1]), depth, true)];
}

/** Parses assistant text into a safe tree. Total: never throws, always returns blocks. */
export function parseChatMarkdown(text: string, options: { streaming?: boolean } = {}): Block[] {
  const streaming = options.streaming === true;
  const cleaned = stripMachineDirectives(text, streaming).replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  if (!cleaned) return [];
  try {
    return parseBlockLines(cleaned.split("\n"), 0, streaming);
  } catch {
    return [{ t: "p", c: [{ t: "text", v: cleaned }] }];
  }
}

/* ------------------------------------------------------------------------------------------------ */
/* Citations                                                                                         */
/* ------------------------------------------------------------------------------------------------ */

const normalizeCitationKey = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Resolves a citation candidate against the run's real sources. All-or-nothing: if any referenced source does
 * not exist the marker stays plain text, so the UI never implies evidence that LiOS does not hold.
 */
export function resolveCitation(cite: Extract<Inline, { t: "cite" }>, sources: readonly ChatCitationSource[]): Array<{ number: number; source: ChatCitationSource }> | null {
  if (!sources.length) return null;
  if (cite.nums.length) {
    // A bare [n] means nothing unless the runtime explicitly numbered its sources.
    const resolved: Array<{ number: number; source: ChatCitationSource }> = [];
    for (const number of cite.nums) {
      const matches = sources.filter((candidate) => candidate.index === number);
      const source = matches.length === 1 ? matches[0] : null;
      if (!source) return null;
      resolved.push({ number, source });
    }
    return resolved;
  }
  if (!cite.name) return null;
  const wanted = normalizeCitationKey(cite.name);
  if (!wanted) return null;
  // Exact normalized label / id / humanized-id equality only. No substring or fuzzy matching.
  const exactIds = sources.filter((source) => normalizeCitationKey(source.id) === wanted);
  if (exactIds.length === 1) return [{ number: exactIds[0].index ?? sources.indexOf(exactIds[0]) + 1, source: exactIds[0] }];
  if (exactIds.length > 1) return null;
  const matches = sources.filter((source) => [source.label, humanizeSourceRef(source.id) ?? ""].some((candidate) => normalizeCitationKey(candidate) === wanted));
  if (matches.length !== 1) return null;
  return [{ number: matches[0].index ?? sources.indexOf(matches[0]) + 1, source: matches[0] }];
}

/**
 * Only recorded absolute http(s) URL IDs may be opened as evidence links.
 * A provider handle paired with a website or unrelated URL is not a citation.
 * Shared by the inline Markdown chips and the Show work source inspector.
 */
export function inspectableSourceHref(source: ChatCitationSource): string | null {
  if (!source.href) return null;
  const original = safeHref(source.id);
  const recorded = safeHref(source.href);
  return original && recorded && original === recorded && /^https?:\/\//i.test(original) ? original : null;
}

/**
 * Bounded source references observed in the current request's latest plan.
 * A stale plan, a prior request or another run's trust record must not
 * become evidence for this answer. Without a plan, the latest source-bearing
 * request is authoritative; explicit requestId always wins.
 */
export function collectCitationSources(events: readonly ConversationRuntimeEvent[], requestId?: string | null): ChatCitationSource[] {
  const targetRequest = requestId ?? [...events].reverse().find(
    (event) => event.type === "plan" || event.type === "trust" || event.type === "tool_result",
  )?.requestId;
  if (!targetRequest) return [];
  let latestPlanAt = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "plan" && events[i].requestId === targetRequest) {
      latestPlanAt = i;
      break;
    }
  }
  const sources: ChatCitationSource[] = [];
  const add = (id: string, providerLabel: string | null) => {
    if (sources.length >= 50) return;
    const href = /^https?:\/\//i.test(id.trim()) ? safeHref(id) : null;
    const label = providerLabel || (href ? new URL(href).hostname.replace(/^www\./, "") : humanizeSourceRef(id));
    if (!label || sources.some((source) => source.id === id)) return;
    sources.push({ id, label, href });
  };
  for (const event of events.slice(latestPlanAt + 1)) {
    if (event.requestId !== targetRequest) continue;
    if (event.type === "trust" && event.manifest.requestId === targetRequest) {
      for (const evidence of event.manifest.evidence) add(evidence.sourceRef, evidence.providerLabel);
    } else if (event.type === "tool_result") {
      for (const ref of event.sourceRefs ?? []) add(ref, null);
    }
  }
  return sources;
}

/** Saved answers resolve only their own retained sources, never a later run's events. */
export function savedMessageCitationSources(metadata: unknown): ChatCitationSource[] {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const rows = (metadata as Record<string, unknown>).citationSources;
  if (!Array.isArray(rows)) return [];
  const sources = new Map<string, ChatCitationSource>();
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const item = row as Record<string, unknown>;
    if (typeof item.id !== "string" || item.id.length > 2000 || typeof item.label !== "string" || item.label.length > 2000) continue;
    if (!sources.has(item.id)) sources.set(item.id, { id: item.id, label: item.label, href: /^https?:\/\//i.test(item.id) ? safeHref(item.id) : null });
  }
  return [...sources.values()];
}
