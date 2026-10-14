import type { AnalyticalOpenMode } from "./terminalActionContracts";
import type { ViewMode } from "./terminalTypes";
import { getTerminalCapability } from "./terminalCatalog";

export type ProposedUiAction =
  | { type: "open"; view: ViewMode; symbol?: string; mode: AnalyticalOpenMode }
  | { type: "focus-mode"; enabled: boolean }
  | { type: "research-pin"; view: ViewMode; symbol?: string; note?: string };

export interface UiActionProposal {
  id: string;
  title: string;
  rationale: string;
  source: "user" | "byoai" | "workflow";
  actions: ProposedUiAction[];
  createdAt: number;
}

export interface UiActionValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  previewLines: string[];
}

export interface UiActionLedgerEntry {
  proposalId: string;
  title: string;
  source: UiActionProposal["source"];
  actionCount: number;
  executedAt: number;
  result: "executed" | "cancelled" | "rejected";
}

const LEDGER_KEY = "limuria-terminal-ui-action-ledger-v1";

function id(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createUiActionProposal(input: Omit<UiActionProposal, "id" | "createdAt">): UiActionProposal {
  return { ...input, id: id(), createdAt: Date.now(), title: input.title.trim().slice(0, 120), rationale: input.rationale.trim().slice(0, 1200), actions: input.actions.slice(0, 20) };
}

export function validateUiActionProposal(proposal: UiActionProposal, isInternal: boolean): UiActionValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const previewLines: string[] = [];
  if (!proposal.actions.length) errors.push("Proposal contains no actions.");
  if (proposal.actions.length > 20) errors.push("Proposal exceeds the 20-action safety limit.");
  for (const [index, action] of proposal.actions.entries()) {
    if (action.type === "open" || action.type === "research-pin") {
      const capability = getTerminalCapability(action.view);
      if (capability.audience === "internal" && !isInternal) errors.push(`Step ${index + 1}: ${capability.label} is internal-only.`);
      if (capability.audience === "client" && isInternal) warnings.push(`Step ${index + 1}: ${capability.label} is client-oriented and may not exist in this build.`);
      const symbol = capability.symbolAware ? action.symbol?.trim().toUpperCase() : undefined;
      previewLines.push(action.type === "open"
        ? `Open ${symbol ? `${symbol} · ` : ""}${capability.label} (${action.mode})`
        : `Pin ${symbol ? `${symbol} · ` : ""}${capability.label} to Research Tray`);
    } else if (action.type === "focus-mode") {
      previewLines.push(`${action.enabled ? "Enter" : "Exit"} Focus Mode`);
    }
  }
  return { valid: errors.length === 0, errors, warnings, previewLines };
}

export function loadUiActionLedger(): UiActionLedgerEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(LEDGER_KEY) || "[]") as UiActionLedgerEntry[];
    return Array.isArray(parsed) ? parsed.sort((a, b) => b.executedAt - a.executedAt).slice(0, 200) : [];
  } catch { return []; }
}

export function recordUiActionLedger(proposal: UiActionProposal, result: UiActionLedgerEntry["result"]): void {
  if (typeof window === "undefined") return;
  const entry: UiActionLedgerEntry = { proposalId: proposal.id, title: proposal.title, source: proposal.source, actionCount: proposal.actions.length, executedAt: Date.now(), result };
  localStorage.setItem(LEDGER_KEY, JSON.stringify([entry, ...loadUiActionLedger()].slice(0, 200)));
}
