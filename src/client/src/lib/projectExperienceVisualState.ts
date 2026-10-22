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

/**
 * TC: the first signed-in Chat is universal, not a finance-only Project.
 * Specialist finance starters remain available when a user explicitly opens a Project Chat.
 * Temporary Chat never invites an upload that cannot be retained safely.
 */
export const QUICK_CHAT_STARTER_PROMPTS = [
  {
    id: "explore-topic",
    label: "Explore a topic",
    description: "Understand an idea, compare viewpoints and see what remains uncertain.",
    prompt: "Help me understand [topic]. Explain the main ideas clearly, distinguish evidence from assumptions, and identify questions worth investigating.",
  },
  {
    id: "create-work",
    label: "Create something",
    description: "Draft a report, document or practical plan you can refine.",
    prompt: "Help me create [a report, document, or plan]. Start with a clear structure and ask only for the missing details necessary to make it useful.",
  },
  {
    id: "analyze-file",
    label: "Work with a file",
    description: "Attach a document or dataset to discuss it in this saved Chat.",
    prompt: "Help me analyze [a document or dataset] after I attach it to this Chat. Describe what the file actually supports and flag any missing evidence.",
  },
] as const;

export const TEMPORARY_CHAT_STARTER_PROMPTS = [
  QUICK_CHAT_STARTER_PROMPTS[0],
  QUICK_CHAT_STARTER_PROMPTS[1],
  {
    id: "think-through",
    label: "Think through a decision",
    description: "Compare options and trade-offs without saving the conversation.",
    prompt: "Help me think through [a decision]. Compare the practical trade-offs, identify missing information, and suggest a next step.",
  },
] as const;

export type ConversationStarterMode = "project" | "quick" | "temporary";
export function starterPromptsForChatMode(
  mode: ConversationStarterMode,
): ReadonlyArray<{ id: string; label: string; description: string; prompt: string }> {
  return mode === "project" ? PROJECT_STARTER_PROMPTS : mode === "temporary" ? TEMPORARY_CHAT_STARTER_PROMPTS : QUICK_CHAT_STARTER_PROMPTS;
}
