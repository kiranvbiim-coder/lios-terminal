export interface ChatSelectionAction { id: string; label: string; prompt: (text: string) => string }
type Mode = "project" | "quick" | "temporary";
const action = (id: string, label: string, instruction: string): ChatSelectionAction => ({ id, label, prompt: text => `${instruction}\n\n“${text}”` });
/** PR #102: specialist actions require an explicitly selected Project. All actions stage only. */
const project = [
  action("explain", "Explain", "Explain this selection in the current Project context:"),
  action("compare", "Compare", "Compare this selection with the most relevant peer, prior period, benchmark or scenario:"),
  action("model", "Model", "Model the financial implications of this selection using governed Project data and show assumptions:"),
  action("source", "Show source", "Show the source, provenance, observation/as-of dates and calculation path for this selection:"),
  action("alert", "Create alert", "Create a monitor or alert for the condition implied by this selection. Ask before any external action:"),
  action("report", "Add to report", "Add this selection and the relevant analysis to the current Project report or memo:"),
  action("ask", "Ask about this", "What should I know about this selection in the current Project context?"),
];
const general = [
  action("explain", "Explain", "Explain the selected text clearly. Separate what it says from assumptions and unknowns:"),
  action("compare", "Compare", "Compare the ideas or alternatives in this text. Identify useful trade-offs and missing context:"),
  action("source", "Check sources", "Identify which claims in this text need sources. Only use sources I permit; do not invent citations:"),
  action("report", "Draft from this", "Draft a clear, editable piece of work based on this text, distinguishing evidence from suggested content:"),
  action("ask", "Ask about this", "What should I understand about this text, and what is still uncertain?"),
];
export function selectionActionsForChatMode(mode: Mode): readonly ChatSelectionAction[] { return mode === "project" ? project : general; }
export function activeObjectPromptForChatMode(mode: Mode, text: string, symbol: string | undefined, view: string): string {
  if (text) return mode === "project" ? `Analyze this selection in the current Project context:\n\n“${text}”` : `Help me understand this selection. Distinguish evidence from assumptions and only use permitted sources:\n\n“${text}”`;
  const target = symbol ? `security ${symbol}` : `active ${view} view`;
  return mode === "project" ? `Analyze this ${target}. Use the current Project context and any focused analytical object.` : `Help me understand the ${target}. Explain what's known, what remains uncertain, and use only sources I permit.`;
}
