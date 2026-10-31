import type { TerminalUxSurface } from "./terminalUxEvents";

/**
 * Existing analytical overlays that previously opened only through keyboard
 * chords. One registry feeds every visible entry point (Discover, Tools menu)
 * so the labels, hints and destinations cannot drift apart.
 */
export const INTELLIGENCE_VIEWS = [
  { surface: "graph-explorer", label: "Relationship graph", hint: "Entities, sources and the links between them" },
  { surface: "impact-map", label: "Impact map", hint: "What a development touches across holdings and themes" },
  { surface: "scenario-workbench", label: "Scenarios", hint: "Change assumptions and compare outcomes" },
  { surface: "decision-center", label: "Decisions", hint: "Open decisions, their evidence and review state" },
  { surface: "trust-ledger", label: "Trust ledger", hint: "What each answer relied on and how reliable it was" },
  { surface: "evidence", label: "Evidence & sources", hint: "Provenance behind what is on screen" },
  { surface: "research-tray", label: "Research tray", hint: "Saved research you can return to" },
] as const satisfies readonly { surface: TerminalUxSurface; label: string; hint: string }[];

export type IntelligenceViewSurface = typeof INTELLIGENCE_VIEWS[number]["surface"];
