import { getCommandAliasView, parseCanonicalNavigation, parseTerminalCommand, type ParsedTerminalCommand } from "./terminalCommands";
import type { ViewMode } from "./terminalTypes";

const INTENT_ALIASES: Record<string, ViewMode> = {
  ANALYZE: "entity",
  ANALYSE: "entity",
  UNDERSTAND: "entity",
  VALUE: "valuation",
  VALUATE: "valuation",
  DCF: "valuation",
  FINANCIALS: "financialstatements",
  STATEMENTS: "financialstatements",
  FUNDAMENTALS: "companyfundamentals",
  COMPARE: "peercomp",
  PEERS: "peercomp",
  COMPS: "peercomp",
  RISK: "advancedrisk",
  STRESS: "portfoliostress",
  CHART: "chart",
  GRAPH: "chart",
  NEWS: "news",
  RESEARCH: "research",
  INVESTIGATE: "research",
  DECIDE: "decisionengine",
  MONITOR: "alerts",
  SCREEN: "screener",
  SCAN: "scanner",
  PORTFOLIO: "portfolio",
  MACRO: "macrodashboard",
  POLICY: "econpolicyquant",
};

function normalize(input: string): string {
  return input.trim().toUpperCase().replace(/\s+/g, " ");
}

export function getIntentAliasView(token: string | undefined): ViewMode | null {
  if (!token) return null;
  return INTENT_ALIASES[token.toUpperCase()] ?? getCommandAliasView(token);
}

export function parseFlexibleTerminalCommand(input: string): ParsedTerminalCommand | null {
  const raw = normalize(input);
  if (!raw) return null;
  if (parseCanonicalNavigation(raw)) return parseTerminalCommand(raw);
  const tokens = raw.split(" ");

  if (tokens.length >= 2) {
    const firstView = getIntentAliasView(tokens[0]);
    const secondView = getCommandAliasView(tokens[1]);
    if (firstView && !secondView && tokens.length === 2) {
      const symbol = tokens[1];
      return { raw, symbol, view: firstView };
    }
    if (secondView) return parseTerminalCommand(raw);

    // Do not coerce arbitrary prose into "<first word> QUOTE". Multi-word
    // natural language belongs to entity search / Ask LiOS unless it uses a
    // known intent or terminal function alias.
    return null;
  }

  return parseTerminalCommand(raw);
}
