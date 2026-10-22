import type { ConversationMode } from "./projectEntry";

export interface ChatSelectionAction {
  id: string;
  label: string;
  prompt: (selectedText: string) => string;
}

/** Retain the original specialist Project actions only in an explicitly selected Project. */
const PROJECT_SELECTION_ACTIONS: readonly ChatSelectionAction[] = [
  { id: "explain", label: "Explain", prompt: (text) => `Explain this selection in the current Project context:

“${text}”` },
  { id: "compare", label: "Compare", prompt: (text) => `Compare this selection with the most relevant peer, prior period, benchmark or scenario:

“${text}”` },
  { id: "model", label: "Model", prompt: (text) => `Model the financial implications of this selection using governed Project data and show assumptions:

“${text}”` },
  { id: "source", label: "Show source", prompt: (text) => `Show the source, provenance, observation/as-of dates and calculation path for this selection:

“${text}”` },
  { id: "alert", label: "Create alert", prompt: (text) => `Create a monitor or alert for the condition implied by this selection. Ask before any external action:

“${text}”` },
  { id: "report", label: "Add to report", prompt: (text) => `Add this selection and the relevant analysis to the current Project report or memo:

“${text}”` },
  { id: "ask", label: "Ask about this", prompt: (text) => `What should I know about this selection in the current Project context?

“${text}”` },
];

/** Ordinary and Temporary Chats stay universal; no implicit Project or ambient finance context. */
const GENERAL_SELECTION_ACTIONS: readonly ChatSelectionAction[] = [
  { id: "explain", label: "Explain", prompt: (text) => `Explain the selected text clearly. Separate what it says from assumptions and unknowns:

“${text}”` },
  { id: "compare", label: "Compare", prompt: (text) => `Compare the ideas or alternatives in this text. Identify useful trade-offs and missing context:

“${text}”` },
  { id: "source", label: "Check sources", prompt: (text) => `Identify which claims in this text need sources. Only use sources I permit; do not invent citations:

“${text}”` },
  { id: "report", label: "Draft from this", prompt: (text) => `Draft a clear, editable piece of work based on this text, distinguishing evidence from suggested content:

“${text}”` },
  { id: "ask", label: "Ask about this", prompt: (text) => `What should I understand about this text, and what is still uncertain?

“${text}”` },
];

export function selectionActionsForChatMode(mode: ConversationMode): readonly ChatSelectionAction[] {
  return mode === "project" ? PROJECT_SELECTION_ACTIONS : GENERAL_SELECTION_ACTIONS;
}

/** The composer is only staging an instruction. It never claims a source-right grant. */
export function activeObjectPromptForChatMode(
  mode: ConversationMode,
  selectedText: string,
  activeSymbol: string | undefined,
  activeView: string,
): string {
  if (mode === "project") {
    if (selectedText) return `Analyze this selection in the current Project context:

“${selectedText}”`;
    const target = activeSymbol ? `security ${activeSymbol}` : `active ${activeView} view`;
    return `Analyze this ${target}. Use the current Project context and any focused analytical object.`;
  }
  if (selectedText) return `Help me understand this selection. Distinguish evidence from assumptions and only use permitted sources:

“${selectedText}”`;
  const target = activeSymbol ? `security ${activeSymbol}` : `active ${activeView} view`;
  return `Help me understand the ${target}. Explain what's known, what remains uncertain, and use only sources I permit.`;
}
