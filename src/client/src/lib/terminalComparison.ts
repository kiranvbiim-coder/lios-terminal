import type { CalculationReceipt } from "./terminalEvidence";
import type { AnalyticalSnapshot, AnalyticalChange } from "./terminalChangeIntelligence";
import { diffAnalyticalSnapshots } from "./terminalChangeIntelligence";

export type ComparisonSlotId = "A" | "B";

export interface ComparisonSlot {
  id: ComparisonSlotId;
  snapshot: AnalyticalSnapshot | null;
}

export interface ModelParameterDiff {
  key: string;
  before: string | number | boolean | null | undefined;
  after: string | number | boolean | null | undefined;
  changed: boolean;
}

export interface ModelReceiptDiff {
  label: string;
  inputs: ModelParameterDiff[];
  parameters: ModelParameterDiff[];
  outputs: ModelParameterDiff[];
  warningsAdded: string[];
  warningsRemoved: string[];
}

const STORAGE_KEY = "limuria-terminal-comparison-v1";
const EVENT_NAME = "lios:comparison";

function loadRaw(): Record<ComparisonSlotId, AnalyticalSnapshot | null> {
  if (typeof window === "undefined") return { A: null, B: null };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<Record<ComparisonSlotId, AnalyticalSnapshot | null>>;
    return { A: parsed.A ?? null, B: parsed.B ?? null };
  } catch { return { A: null, B: null }; }
}

export function loadComparisonSlots(): ComparisonSlot[] {
  const raw = loadRaw();
  return [{ id: "A", snapshot: raw.A }, { id: "B", snapshot: raw.B }];
}

export function setComparisonSlot(id: ComparisonSlotId, snapshot: AnalyticalSnapshot | null): void {
  if (typeof window === "undefined") return;
  const raw = loadRaw();
  raw[id] = snapshot;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: loadComparisonSlots() }));
}

export function clearComparisonSlots(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: loadComparisonSlots() }));
}

export function compareSlots(): AnalyticalChange[] {
  const raw = loadRaw();
  return raw.A && raw.B ? diffAnalyticalSnapshots(raw.A, raw.B) : [];
}

export function subscribeComparison(listener: (slots: ComparisonSlot[]) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (event: Event) => {
    if (event instanceof CustomEvent && Array.isArray(event.detail)) listener(event.detail as ComparisonSlot[]);
    else listener(loadComparisonSlots());
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}

function sectionDiff(
  before: Readonly<Record<string, string | number | boolean | null>>,
  after: Readonly<Record<string, string | number | boolean | null>>,
): ModelParameterDiff[] {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort().map((key) => ({
    key,
    before: before[key],
    after: after[key],
    changed: before[key] !== after[key],
  }));
}

export function diffCalculationReceipts(before: CalculationReceipt, after: CalculationReceipt): ModelReceiptDiff {
  return {
    label: `${before.label} → ${after.label}`,
    inputs: sectionDiff(before.inputs, after.inputs),
    parameters: sectionDiff(before.parameters, after.parameters),
    outputs: sectionDiff(before.outputs, after.outputs),
    warningsAdded: after.warnings.filter((warning) => !before.warnings.includes(warning)),
    warningsRemoved: before.warnings.filter((warning) => !after.warnings.includes(warning)),
  };
}
