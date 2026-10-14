export interface ProjectConversationVisualState {
  messageCount: number;
  streaming: boolean;
  busy: boolean;
}

export function resolveProjectConversationVisualIntensity(
  state: ProjectConversationVisualState,
): "immersive" | "contextual" {
  return state.messageCount > 0 || state.streaming || state.busy ? "contextual" : "immersive";
}

export const PROJECT_STARTER_PROMPTS = [
  {
    id: "company-research",
    label: "Research a company",
    description: "Key developments, fundamentals, risks, and source gaps.",
    prompt: "Research [company or ticker] using available, cited sources. Summarize key developments, fundamentals, risks, and any data gaps.",
  },
  {
    id: "deterministic-valuation",
    label: "Build a valuation",
    description: "Start a deterministic model with visible inputs and assumptions.",
    prompt: "Build a deterministic DCF for [company or ticker]. Show sourced inputs, assumptions, and missing data; ask me before estimating anything that is unavailable.",
  },
  {
    id: "portfolio-risk",
    label: "Understand portfolio risk",
    description: "Review concentration and exposures using a source I choose.",
    prompt: "Review [my portfolio file or connected source] for concentration, exposures, and downside risks. Ask me to select the file or source before using private data.",
  },
] as const;

/**
 * Fills the `[company or ticker]` slot with the user's own most recent ticker so a starter is ready to
 * send. Only that slot is filled: portfolio/source slots are never guessed. Returns the prompt unchanged
 * when there is no usable ticker.
 */
export function fillStarterPrompt(prompt: string, recentSymbol: string | null | undefined): string {
  const symbol = (recentSymbol ?? "").trim().toUpperCase();
  if (!symbol || !/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(symbol)) return prompt;
  return prompt.replace("[company or ticker]", symbol);
}

/** Range of the first `[placeholder]` in a starter prompt, so the composer can pre-select it for typing over. */
export function findStarterPlaceholder(prompt: string): { start: number; end: number } | null {
  const match = /\[[^\]\n]+\]/.exec(prompt);
  return match ? { start: match.index, end: match.index + match[0].length } : null;
}
