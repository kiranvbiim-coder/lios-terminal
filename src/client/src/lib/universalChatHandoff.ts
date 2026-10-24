import type { ViewMode } from "./terminalTypes";

/** Ephemeral navigation payload, never a second conversation or provider runtime. */
export interface UniversalChatHandoff {
  request: number;
  prompt: string | null;
}

/**
 * A Workbench question is staged for human review in the existing Chat editor.
 * A selected ticker is context *text*, not authorization to read a provider,
 * open a private file, or execute a tool.
 */
export function workbenchQuestionDraft(
  question: string | null | undefined,
  view: ViewMode,
  symbol?: string | null,
  asOfDate?: string | null,
): string | null {
  const prompt = question?.trim();
  if (!prompt) return null;
  const normalizedSymbol = (symbol ?? "").trim().toUpperCase();
  const scopedSymbol = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(normalizedSymbol) ? normalizedSymbol : null;
  const historicalDate = asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ? asOfDate : null;
  if (!scopedSymbol && !historicalDate) return prompt;
  return `${prompt}\n\nSelected Workbench context: ${scopedSymbol ?? "no security selected"} (${view})${historicalDate ? ` · as-known-on date: ${historicalDate}` : ""}. Use only authorized sources and flag missing evidence.`;
}

/** Keep any unsent Chat draft; no auto-submit, duplicate append or data mutation. */
export function stageUniversalChatQuestion(existing: string, incoming: string | null): string {
  const prompt = incoming?.trim();
  if (!prompt) return existing;
  if (existing.trim() === prompt || existing.endsWith(`\n\n${prompt}`)) return existing;
  return existing.trim() ? `${existing.replace(/\n+$/, "")}\n\n${prompt}` : prompt;
}
