import { DETERMINISTIC_ENGINE_REGISTRY } from "./waveCContracts";
import type { StructuredConversationIntent } from "./conversationRuntime";

export type AskLiosIntent =
  | { kind: "compute"; engineId: (typeof DETERMINISTIC_ENGINE_REGISTRY)[number]["id"]; view: string }
  | { kind: "resolve"; ticker: string }
  | { kind: "chat" };

const ENGINE_HINTS: Array<{ engineId: (typeof DETERMINISTIC_ENGINE_REGISTRY)[number]["id"]; view: string; pattern: RegExp }> = [
  { engineId: "valuation.dcf", view: "valuation", pattern: /\b(dcf|wacc|terminal value)\b/i },
  { engineId: "options.greeks", view: "options", pattern: /\b(greeks?|black-?scholes|implied vol(?:atility)?)\b/i },
  { engineId: "fixed-income.duration", view: "fixedincome", pattern: /\b(duration|dv01)\b/i },
  { engineId: "portfolio.optimization", view: "optimizer", pattern: /\b(optimiz(?:e|ation|ing)?|efficient frontier)\b/i },
  { engineId: "portfolio.var", view: "advancedrisk", pattern: /\b(var|cvar|value at risk)\b/i },
  { engineId: "statistics.regression", view: "datastats", pattern: /\b(regress(?:ion)?|ols|r-?squared)\b/i },
  { engineId: "simulations.monte-carlo", view: "montecarlo", pattern: /\b(monte carlo|simulation)\b/i },
];

/** Decide the requested action before matching domain/model nouns; numbers and an active Artifact are not actions. */
export function classifyAskLiosAction(message: string): Pick<StructuredConversationIntent, "action" | "requiresDeterministicCompute"> | null {
  const text = message.trim().replaceAll("’", "'");
  // A calculation clause retains execution even when the person also asks for an explanation.
  if (/(?:^|[,:;.!?]\s*|\b(?:and|then)\s+)(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:run|calculate|compute|estimate|solve|build|evaluate|optimi[sz]e|price)\b/i.test(text)) {
    return { action: "calculate", requiresDeterministicCompute: true };
  }
  if (/\b(?:explain|define|describe|teach|why|what (?:does|do)|how (?:does|do|can|is|are|to)|difference between|meaning of|tell me about)\b/i.test(text)) {
    return { action: "explain", requiresDeterministicCompute: false };
  }
  const question = text.match(/\bwhat(?:'s| is| are| was)\s+([^?]+)/i)?.[1];
  if (question) {
    if (/\b(?:definition|meaning|difference|relationship|concept|intuition|formula|purpose|types?|kinds?|examples?)\b/i.test(question)) {
      return { action: "explain", requiresDeterministicCompute: false };
    }
    // Particular targets retain the governed quantity/input-gap path even with no figures supplied.
    if (/\b(?:for|of)\s+\S|'s\s+\S/i.test(question)) return null;
    return { action: "explain", requiresDeterministicCompute: false };
  }
  return null;
}

export function classifyAskLiosIntent(message: string): AskLiosIntent {
  const trimmed = message.trim();
  if (!trimmed) return { kind: "chat" };
  if (classifyAskLiosAction(trimmed)?.action === "explain") return { kind: "chat" };
  for (const hint of ENGINE_HINTS) {
    if (hint.pattern.test(trimmed)) return { kind: "compute", engineId: hint.engineId, view: hint.view };
  }
  const resolveMatch = trimmed.match(/\b(?:resolve|lookup|identify)\s+([A-Za-z]{1,6}(?:\.[A-Za-z]{1,3})?)\b/i);
  if (resolveMatch) return { kind: "resolve", ticker: resolveMatch[1].toUpperCase() };
  return { kind: "chat" };
}

export interface AskLiosDelegation {
  engineId: Extract<AskLiosIntent, { kind: "compute" }>["engineId"];
  engineLabel: string;
  view: string;
  message: string;
}

export function buildAskLiosDelegation(intent: Extract<AskLiosIntent, { kind: "compute" }>): AskLiosDelegation {
  const engine = DETERMINISTIC_ENGINE_REGISTRY.find((item) => item.id === intent.engineId);
  const engineLabel = engine?.label ?? intent.engineId;
  return {
    engineId: intent.engineId,
    engineLabel,
    view: intent.view,
    message: [
      `I won’t invent this calculation. ${engineLabel} is handled by LiOS’s deterministic engine.`,
      "LiOS should execute the governed engine when the required inputs are explicit. If inputs are missing, surface exactly what is required and a contextual workspace action rather than approximating the result.",
    ].join(" "),
  };
}

export function formatAskLiosDelegation(intent: Extract<AskLiosIntent, { kind: "compute" }>): string {
  const delegation = buildAskLiosDelegation(intent);
  return [
    delegation.message,
    `<<NAVIGATE: ${delegation.view}>>`,
  ].join("\n");
}

export const ASK_LIOS_SYSTEM_PREAMBLE = `You are Ask LiOS, the intelligence layer inside the LiOS Intelligence Terminal. Deterministic LiOS engines remain the calculator of record. Route to and invoke governed LiOS capabilities when the required inputs are available; do not make the user select modules manually. Never invent a numerical result that a LiOS engine can compute. If required inputs or evidence are missing, identify the exact gap and surface the governed next action instead of approximating or silently broadening scope.`;
