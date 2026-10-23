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
): string | null {
  const prompt = question?.trim();
  if (!prompt) return null;
  const normalizedSymbol = (symbol ?? "").trim().toUpperCase();
  const scopedSymbol = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(normalizedSymbol) ? normalizedSymbol : null;
  return scopedSymbol
    ? `${prompt}\n\nSelected Workbench context: ${scopedSymbol} (${view}). Use only authorized sources and flag missing evidence.`
    : prompt;
}

/** Keep any unsent Chat draft; no auto-submit, duplicate append or data mutation. */
export function stageUniversalChatQuestion(existing: string, incoming: string | null): string {
  const prompt = incoming?.trim();
  if (!prompt) return existing;
  if (existing.trim() === prompt || existing.endsWith(`\n\n${prompt}`)) return existing;
  return existing.trim() ? `${existing.replace(/\n+$/, "")}\n\n${prompt}` : prompt;
}
