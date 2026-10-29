// Adapted speech preparation rules from OpenClaw c074824a27c96d3983043f9eeb33823cd1772d8c:
// src/tts/speech-text.ts and src/shared/text/strip-markdown.ts.
// Copyright (c) 2026 OpenClaw Foundation. MIT; full grant retained in THIRD_PARTY_NOTICES.md.
// LiOS uses its existing display parser, not donor Markdown IR, TTS directives or provider authority.
import { parseChatMarkdown, type Block, type Inline } from "./chatMarkdown";

const SCREEN_DETAIL = "I've put the detailed response on screen.";
const MAX_SPEECH_CHARACTERS = 4_000; // Same existing authenticated P12 route bound; never silently truncate.
export class ReplySpeechError extends Error {
  constructor(readonly reason: "too_long" | "unavailable") {
    super(reason === "too_long"
      ? "This reply is too long to read aloud. The complete answer remains on screen."
      : "Reply speech could not be played. The complete answer remains on screen; check Voice settings or retry.");
    this.name = "ReplySpeechError";
  }
}
export type PreparedReplySpeech = { kind: "speech" | "screen_detail"; text: string } | { kind: "empty" } | { kind: "too_long" };
const inlineText = (nodes: Inline[]): string => nodes.map(node => {
  switch (node.t) {
    case "text": case "code": return node.v;
    case "br": return "\n";
    case "cite": return node.raw; // A marker, not a synthesized/verified citation or inferred URL.
    default: return inlineText(node.c);
  }
}).join("");
function codeCharacters(blocks: Block[]): number {
  return blocks.reduce((total, block) => total + (block.t === "code" ? block.v.length
    : block.t === "quote" ? codeCharacters(block.c)
    : block.t === "list" ? block.items.reduce((sum, item) => sum + codeCharacters(item), 0) : 0), 0);
}
function blockText(blocks: Block[]): string {
  return blocks.map(block => {
    switch (block.t) {
      case "heading": case "p": return inlineText(block.c);
      case "code": return block.v;
      case "quote": return blockText(block.c);
      case "list": return block.items.map((item, i) => `${block.ordered ? `${block.start + i}. ` : ""}${blockText(item)}`).join("\n");
      case "table": {
        const headers = block.head.map(inlineText);
        return block.rows.map(row => row.map((cell, i) => `${headers[i] ? `${headers[i]}: ` : ""}${inlineText(cell)}`).join(". ")).join("\n");
      }
      case "hr": return "";
    }
  }).join("\n\n");
}
function cleanSpeechText(text: string): string {
  return text.split("\n").map(line => /^[\p{P}\p{S}\s]+$/u.test(line) ? "" : line
    .replace(/^[•◦▪‣⁃]\s+/u, "")
    .replace(/(?:[\p{So}\p{Sk}]\s*){2,}/gu, " ")
    .replace(/\.{4,}/g, "...")
    .replace(/([!?,;:])\1+/g, "$1")
    .replace(/[ \t]{2,}/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
export function prepareReplySpeech(text: string): PreparedReplySpeech {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  const blocks = parseChatMarkdown(trimmed);
  // Inclusive donor half-fenced-code rule; inline code never counts as a fenced program.
  if (codeCharacters(blocks) / trimmed.length >= 0.5) return { kind: "screen_detail", text: SCREEN_DETAIL };
  const projected = cleanSpeechText(blockText(blocks));
  if (!projected) return { kind: "empty" };
  if (projected.length > MAX_SPEECH_CHARACTERS) return { kind: "too_long" };
  return { kind: "speech", text: projected };
}

export async function playReplySpeech(text: string, signal: AbortSignal, preference?: {
  providerId?: string | null; voiceId?: string | null; rate?: number; localOnly?: boolean;
}): Promise<"played" | "empty" | "screen_detail"> {
  signal.throwIfAborted();
  const prepared = prepareReplySpeech(text);
  if (prepared.kind === "empty") return "empty";
  if (prepared.kind === "too_long") throw new ReplySpeechError("too_long");
  let url: string | undefined;
  let audio: HTMLAudioElement | undefined;
  try {
    const res = await fetch("/api/voice/speak", { method: "POST", credentials: "include", signal,
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: prepared.text, preference }) });
    signal.throwIfAborted();
    if (!res.ok || !res.headers.get("content-type")?.startsWith("audio/")) throw new ReplySpeechError("unavailable");
    const blob = await res.blob();
    signal.throwIfAborted();
    url = URL.createObjectURL(blob);
    audio = new Audio(url);
    await new Promise<void>((resolve, reject) => {
      const player = audio!;
      let settled = false;
      const finish = (error?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        player.onended = null;
        player.onerror = null;
        error ? reject(error) : resolve();
      };
      const abort = () => { player.pause(); finish(new DOMException("Reply speech stopped.", "AbortError")); };
      player.onended = () => finish();
      player.onerror = () => finish(new ReplySpeechError("unavailable"));
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) { abort(); return; }
      void player.play().catch(() => finish(new ReplySpeechError("unavailable")));
    });
    return prepared.kind === "screen_detail" ? "screen_detail" : "played";
  } catch {
    if (signal.aborted) throw new DOMException("Reply speech stopped.", "AbortError");
    throw new ReplySpeechError("unavailable");
  } finally {
    audio?.pause();
    if (audio) audio.removeAttribute("src");
    if (url) URL.revokeObjectURL(url);
  }
}
