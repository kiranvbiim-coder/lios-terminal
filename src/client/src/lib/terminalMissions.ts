import type { ViewMode } from "./terminalTypes";
import { getTerminalCapability, isCapabilityVisible } from "./terminalCatalog";

export interface TerminalMissionStep {
  id: string;
  label: string;
  description: string;
  view: ViewMode;
  optional?: boolean;
}

export interface TerminalMission {
  id: string;
  label: string;
  description: string;
  outcome: string;
  estimatedMinutes: number;
  steps: readonly TerminalMissionStep[];
}

export interface TerminalMissionProgress {
  missionId: string;
  completedStepIds: string[];
  startedAt: number;
  completedAt: number | null;
}

const STORAGE_KEY = "limuria-terminal-missions-v1";

export const TERMINAL_MISSIONS: readonly TerminalMission[] = [
  { id: "value-company", label: "Value a company", description: "Learn the company-analysis grammar by moving from statements to intrinsic value and relative context.", outcome: "A reusable company valuation workspace", estimatedMinutes: 5, steps: [
    { id: "open-entity", label: "Open company", description: "Create a durable company context.", view: "entity" },
    { id: "review-financials", label: "Review financials", description: "Inspect historical income statement, balance sheet, and cash flow.", view: "financialstatements" },
    { id: "run-dcf", label: "Run DCF", description: "Open the valuation engine and inspect assumptions.", view: "valuation" },
    { id: "compare-peers", label: "Compare peers", description: "Challenge intrinsic value against market comparables.", view: "peercomp" },
  ] },
  { id: "stress-portfolio", label: "Stress-test a portfolio", description: "Understand exposures, dependency, and downside before monitoring risk limits.", outcome: "A portfolio risk review", estimatedMinutes: 6, steps: [
    { id: "open-portfolio", label: "Open portfolio", description: "Review holdings and exposures.", view: "portfolio" },
    { id: "inspect-correlation", label: "Inspect correlation", description: "Find concentration and diversification structure.", view: "correlation" },
    { id: "run-stress", label: "Run stress test", description: "Apply adverse scenarios to current exposures.", view: "portfoliostress" },
    { id: "monitor", label: "Set monitoring", description: "Open alerts for risk thresholds and changing conditions.", view: "alerts" },
  ] },
  { id: "compare-economies", label: "Compare economies", description: "Move from macro overview to comparable indicators, transformations, and policy scenarios.", outcome: "A structured macro comparison", estimatedMinutes: 7, steps: [
    { id: "macro", label: "Open macro dashboard", description: "Orient around growth, inflation, labor, and rates.", view: "macrodashboard" },
    { id: "indicators", label: "Explore indicators", description: "Select comparable official series.", view: "indicatorexplorer" },
    { id: "workbench", label: "Analyze series", description: "Transform and compare indicator behavior.", view: "indicatorworkbench" },
    { id: "policy", label: "Model policy", description: "Translate signals into an explicit scenario.", view: "econpolicyquant" },
  ] },
  { id: "logistics-scenario", label: "Build a logistics scenario", description: "Move from freight data to operating context and quantitative supply-chain modeling.", outcome: "A supply-chain scenario ready for delivery", estimatedMinutes: 7, steps: [
    { id: "data", label: "Review freight data", description: "Inspect underlying logistics indicators.", view: "supplychainindicators" },
    { id: "dashboard", label: "Open operations dashboard", description: "Diagnose capacity, cost, and network conditions.", view: "supplychaindashboard" },
    { id: "model", label: "Run supply-chain model", description: "Model network, inventory, routing, or capacity trade-offs.", view: "supplychainquant" },
    { id: "sheet", label: "Send to spreadsheet", description: "Package outputs in a reusable calculation surface.", view: "spreadsheet" },
  ] },
  { id: "source-backed-research", label: "Create source-backed research", description: "Learn the evidence-first path from company context to current evidence and a durable conclusion.", outcome: "A source-backed research workspace", estimatedMinutes: 8, steps: [
    { id: "entity", label: "Open entity", description: "Start with a durable company context.", view: "entity" },
    { id: "news", label: "Review current evidence", description: "Inspect relevant current events.", view: "news" },
    { id: "filings", label: "Check filings", description: "Verify primary-source disclosures.", view: "filingintel" },
    { id: "research", label: "Synthesize research", description: "Build a structured evidence-backed research object.", view: "research" },
  ] },
];

export function getVisibleTerminalMissions(isInternal: boolean): TerminalMission[] {
  return TERMINAL_MISSIONS
    .map((mission) => ({
      ...mission,
      steps: mission.steps.filter((step) => isCapabilityVisible(getTerminalCapability(step.view), isInternal)),
    }))
    .filter((mission) => mission.steps.length > 0);
}

function loadAllProgress(): Record<string, TerminalMissionProgress> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Record<string, TerminalMissionProgress>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}

function saveAllProgress(progress: Record<string, TerminalMissionProgress>): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

export function getMissionProgress(missionId: string): TerminalMissionProgress | null {
  return loadAllProgress()[missionId] ?? null;
}

export function startTerminalMission(missionId: string): TerminalMissionProgress {
  const all = loadAllProgress();
  const existing = all[missionId];
  if (existing) return existing;
  const progress: TerminalMissionProgress = { missionId, completedStepIds: [], startedAt: Date.now(), completedAt: null };
  all[missionId] = progress;
  saveAllProgress(all);
  return progress;
}

export function recordMissionView(view: ViewMode): TerminalMissionProgress[] {
  const all = loadAllProgress();
  let changed = false;
  const next: TerminalMissionProgress[] = [];
  for (const mission of TERMINAL_MISSIONS) {
    const current = all[mission.id];
    if (!current || current.completedAt) continue;
    const step = mission.steps.find((item) => item.view === view && !current.completedStepIds.includes(item.id));
    if (!step) continue;
    const completedStepIds = [...current.completedStepIds, step.id];
    const required = mission.steps.filter((item) => !item.optional).map((item) => item.id);
    const completedAt = required.every((id) => completedStepIds.includes(id)) ? Date.now() : null;
    all[mission.id] = { ...current, completedStepIds, completedAt };
    next.push(all[mission.id]);
    changed = true;
  }
  if (changed) saveAllProgress(all);
  return next;
}

export function resetTerminalMission(missionId: string): void {
  const all = loadAllProgress();
  delete all[missionId];
  saveAllProgress(all);
}

export function missionCompletionRatio(mission: TerminalMission, progress: TerminalMissionProgress | null): number {
  if (!progress) return 0;
  const required = mission.steps.filter((item) => !item.optional);
  if (!required.length) return 1;
  const completed = required.filter((item) => progress.completedStepIds.includes(item.id)).length;
  return completed / required.length;
}
