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
    id: "explain-topic",
    label: "Explore any topic",
    description: "Understand an idea, write text, or work through a question.",
    prompt: "Explain [topic or question] in plain language. Distinguish facts from uncertainty and tell me if a source or more context is needed.",
  },
  {
    id: "owned-file",
    label: "Work with a file",
    description: "Summarize a file I choose, with citations and visible gaps.",
    prompt: "Summarize [a file I choose] using only its contents, with citations and visible evidence gaps. Ask me to attach or select the file before using it.",
  },
  {
    id: "deterministic-valuation",
    label: "Build a valuation",
    description: "Use explicit inputs and the existing financial engines.",
    prompt: "Build a deterministic DCF for [company or ticker]. Show sourced inputs, assumptions, and missing data; ask me before estimating anything that is unavailable.",
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

/** PR #102: ordinary Chat is universal; Temporary never invites retained files. */
const QUICK_CHAT_STARTER_PROMPTS = [
  { id: "explore-topic", label: "Explore a topic", description: "Understand an idea and compare viewpoints.", prompt: "Help me understand [topic]. Explain the main ideas clearly, distinguish evidence from assumptions, and identify questions worth investigating." },
  { id: "create-work", label: "Create something", description: "Draft a document or practical plan.", prompt: "Help me create [a report, document, or plan]. Start with a clear structure and ask only for the missing details necessary to make it useful." },
  { id: "analyze-file", label: "Work with a file", description: "Discuss a document in this saved Chat.", prompt: "Help me analyze [a document or dataset] after I attach it to this Chat. Describe what the file actually supports and flag any missing evidence." },
] as const;

const TEMPORARY_CHAT_STARTER_PROMPTS = [
  QUICK_CHAT_STARTER_PROMPTS[0],
  QUICK_CHAT_STARTER_PROMPTS[1],
  { id: "think-through", label: "Think through a decision", description: "Compare options without saving the conversation.", prompt: "Help me think through [a decision]. Compare the practical trade-offs, identify missing information, and suggest a next step." },
] as const;

export function starterPromptsForChatMode(mode: "project" | "quick" | "temporary"): ReadonlyArray<{ id: string; label: string; description: string; prompt: string }> {
  return mode === "project" ? PROJECT_STARTER_PROMPTS : mode === "temporary" ? TEMPORARY_CHAT_STARTER_PROMPTS : QUICK_CHAT_STARTER_PROMPTS;
}
