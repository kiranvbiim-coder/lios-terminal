/**
 * Query-term extraction for owner-scoped memory search over contiguous CJK text.
 *
 * Mechanism adapted from OpenClaw packages/memory-host-sdk/src/host/query-expansion.ts `tokenize`/`extractKeywords`
 * (c074824a27c96d3983043f9eeb33823cd1772d8c, MIT, Copyright (c) 2026 OpenClaw Foundation): contiguous Han/Kana/Hangul
 * runs have no word boundaries, so they are matched by overlapping bigrams (a single character stays a unigram), while
 * ASCII/other-script words keep their normal tokens. LiOS applies the terms to its own canonical rows only; no
 * donor stop-word tables, index, store or embedding is imported.
 */
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu;
const WORD = /[\p{L}\p{N}_-]+/gu;
// Particles/copulas that carry no retrieval meaning on their own (a bigram containing one is still kept).
const SINGLE_CHAR_STOP = new Set([..."的了是在和与の、はがをにでともな은는이가을를에의와과"]);
export const MAX_MEMORY_TERMS = 32;

export interface MemoryQueryTerms {
  /** Non-CJK words, unchanged from the pre-existing tokenization. */
  words: string[];
  /** Overlapping CJK bigrams (or a lone non-stop character), deduplicated and bounded. */
  cjk: string[];
}

export function hasCjk(text: string): boolean {
  return CJK_CHAR.test(text);
}

export function extractMemoryQueryTerms(query: string): MemoryQueryTerms {
  const lowered = query.toLowerCase();
  const words = (lowered.replace(CJK_RUN, " ").match(WORD) ?? []).slice(0, MAX_MEMORY_TERMS);
  const cjk: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => { if (!seen.has(term) && cjk.length < MAX_MEMORY_TERMS) { seen.add(term); cjk.push(term); } };
  for (const run of lowered.match(CJK_RUN) ?? []) {
    const chars = [...run];
    if (chars.length === 1) { if (!SINGLE_CHAR_STOP.has(chars[0]!)) add(chars[0]!); continue; }
    for (let i = 0; i + 1 < chars.length; i++) add(chars[i]! + chars[i + 1]!);
  }
  return { words, cjk };
}

/** Escapes LIKE metacharacters so a query term can only match literally. */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}
