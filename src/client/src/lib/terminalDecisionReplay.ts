import type { WorkspaceState } from "./terminalTypes";
import type { EvidenceSnapshot } from "./terminalEvidence";

export interface DecisionReplaySnapshot {
  id: string;
  title: string;
  symbol: string;
  capturedAt: number;
  asOf: string;
  workspace: WorkspaceState;
  evidence: EvidenceSnapshot;
  assumptions: Record<string, string | number | boolean | null>;
  conclusion: string;
  monitoringTriggers: string[];
}

const STORAGE_KEY = "limuria-terminal-decision-replay-v1";
const EVENT_NAME = "lios:decision-replay";

function id(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadAll(): DecisionReplaySnapshot[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]") as DecisionReplaySnapshot[];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveAll(items: readonly DecisionReplaySnapshot[]): void {
  if (typeof window === "undefined") return;
  const next = [...items].sort((a, b) => b.capturedAt - a.capturedAt).slice(0, 80);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
}

export function captureDecisionReplay(input: Omit<DecisionReplaySnapshot, "id" | "capturedAt" | "symbol"> & { symbol?: string }): DecisionReplaySnapshot {
  const snapshot: DecisionReplaySnapshot = {
    ...input,
    id: id(),
    capturedAt: Date.now(),
    symbol: (input.symbol ?? "").trim().toUpperCase(),
    workspace: JSON.parse(JSON.stringify(input.workspace)) as WorkspaceState,
    evidence: JSON.parse(JSON.stringify(input.evidence)) as EvidenceSnapshot,
    assumptions: { ...input.assumptions },
    conclusion: input.conclusion.trim().slice(0, 2400),
    monitoringTriggers: input.monitoringTriggers.map((item) => item.trim()).filter(Boolean).slice(0, 30),
  };
  saveAll([snapshot, ...loadAll()]);
  return snapshot;
}

export function loadDecisionReplays(): DecisionReplaySnapshot[] {
  return loadAll().map((item) => ({ ...item, workspace: JSON.parse(JSON.stringify(item.workspace)) as WorkspaceState, evidence: JSON.parse(JSON.stringify(item.evidence)) as EvidenceSnapshot, assumptions: { ...item.assumptions }, monitoringTriggers: [...item.monitoringTriggers] }));
}

export function removeDecisionReplay(snapshotId: string): void {
  saveAll(loadAll().filter((item) => item.id !== snapshotId));
}

export function subscribeDecisionReplays(listener: (items: DecisionReplaySnapshot[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => listener(loadDecisionReplays());
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
