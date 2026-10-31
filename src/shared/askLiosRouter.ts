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

/**
 * Chat → Workbench routing table: which analysis tool answers a request. Ordered most
 * specific first. Navigation only — the opened tool computes its own governed numbers.
 * Engine hints whose delegation target is a Settings › Advanced view are redirected to
 * the Workbench analysis tool that answers the same question.
 */
const ANALYSIS_VIEW_FOR_ENGINE_VIEW: Readonly<Record<string, string>> = { datastats: "assetpricing" };
const ANALYSIS_VIEW_HINTS: ReadonlyArray<{ view: string; pattern: RegExp }> = [
  ...ENGINE_HINTS.map(({ view, pattern }) => ({ view: ANALYSIS_VIEW_FOR_ENGINE_VIEW[view] ?? view, pattern })),
  { view: "peercomp", pattern: /\b(compare|comparison|versus|vs\.?|peers?|comps|comparables?|relative valuation)\b/i },
  { view: "news", pattern: /\b(news|headlines?|latest on|what happened (?:to|with))\b/i },
  { view: "valuation", pattern: /\b(valu(?:e|ation)|intrinsic|fair value|price target|undervalued|overvalued|worth buying)\b/i },
  { view: "financialstatements", pattern: /\b(financials?|financial statements?|income statement|balance sheet|cash ?flows?|revenues?|earnings|margins?|profitability|eps)\b/i },
  { view: "chart", pattern: /\b(chart|price (?:history|action|trend|performance)|technicals?|technical analysis|moving averages?|rsi|macd|candlesticks?)\b/i },
  { view: "portfolio", pattern: /\b(portfolio|holdings|allocation|my positions)\b/i },
];

/** Settings › Advanced (admin/data-plumbing) views; never a Chat analysis destination. */
const NON_ANALYSIS_VIEWS = new Set([
  "environment", "developer", "adminconsole", "enginereadiness", "coveragemap", "qualitygate", "connectors",
  "marketdatafabric", "universefabric", "crossassetfabric", "economicdatafabric", "datastats", "conflictdetector",
]);

/** Runtime capability ids that imply a Workbench tool when the request text does not. */
const CAPABILITY_VIEW: Readonly<Record<string, string>> = {
  "security.overview": "entity",
  "market.technical": "chart",
  "strategy.backtest": "backtesting",
};

const NOT_TICKERS = new Set([
  "A", "I", "AI", "AN", "AND", "ARE", "AS", "AT", "BE", "BY", "CAN", "CEO", "DCF", "DO", "EPS", "ETF", "FOR", "GDP", "HOW",
  "IN", "IS", "IT", "ME", "MY", "OF", "ON", "OR", "P", "PE", "THE", "TO", "US", "USA", "USD", "VAR", "VS", "WACC", "WHAT", "WHY",
]);

export interface AnalysisWorkbenchMatch {
  view: string;
  symbol: string | null;
}

export interface AnalysisWorkbenchMatchInput {
  message: string;
  /** Capabilities the runtime planned for this turn (plan event). */
  capabilities?: ReadonlyArray<{ id: string; parameters?: Record<string, unknown> }>;
  /** Symbols the runtime resolved for this turn, most relevant first. */
  resolvedSymbols?: readonly string[];
  /** Caller's availability check (audience, registered tools); unavailable candidates are skipped. */
  isAvailable?: (view: string) => boolean;
}

function explicitTicker(message: string): string | null {
  const dollar = message.match(/\$([A-Za-z][A-Za-z0-9.\-]{0,9})\b/);
  if (dollar) return dollar[1].toUpperCase();
  for (const token of message.match(/\b[A-Z][A-Z0-9.\-]{0,5}\b/g) ?? []) {
    if (!NOT_TICKERS.has(token)) return token;
  }
  return null;
}

/**
 * Decide which Workbench tool should open beside a Chat answer. Returns null for general
 * conversation and concept explanations ("what is a DCF?"), which stay in Chat, and never
 * returns a Settings › Advanced view.
 */
export function matchAnalysisWorkbenchView(input: AnalysisWorkbenchMatchInput): AnalysisWorkbenchMatch | null {
  const message = input.message.trim();
  if (!message || classifyAskLiosAction(message)?.action === "explain") return null;
  const plannedViews = (input.capabilities ?? [])
    .map((capability) => capability.parameters?.view)
    .filter((view): view is string => typeof view === "string" && /^[a-z0-9]{2,40}$/.test(view))
    .map((view) => ANALYSIS_VIEW_FOR_ENGINE_VIEW[view] ?? view);
  const candidates = [
    ...plannedViews,
    ...ANALYSIS_VIEW_HINTS.filter((hint) => hint.pattern.test(message)).map((hint) => hint.view),
    ...(input.capabilities ?? []).map((capability) => CAPABILITY_VIEW[capability.id]).filter((view): view is string => Boolean(view)),
  ];
  const view = candidates.find((candidate) => !NON_ANALYSIS_VIEWS.has(candidate) && (input.isAvailable?.(candidate) ?? true));
  if (!view) return null;
  const symbol = input.resolvedSymbols?.find((value) => /^[A-Z0-9][A-Z0-9.\-]{0,15}$/.test(value)) ?? explicitTicker(message);
  return { view, symbol };
}

export const ASK_LIOS_SYSTEM_PREAMBLE = `You are Ask LiOS, the intelligence layer inside the LiOS Intelligence Terminal. Deterministic LiOS engines remain the calculator of record. Route to and invoke governed LiOS capabilities when the required inputs are available; do not make the user select modules manually. Never invent a numerical result that a LiOS engine can compute. If required inputs or evidence are missing, identify the exact gap and surface the governed next action instead of approximating or silently broadening scope.`;
