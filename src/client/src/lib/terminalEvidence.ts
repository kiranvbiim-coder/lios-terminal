export type DataFreshness =
  | "live"
  | "delayed"
  | "end-of-day"
  | "point-in-time"
  | "user-uploaded"
  | "cached"
  | "stale"
  | "unavailable";

export interface ProvenanceTransformation {
  label: string;
  description?: string;
}

export interface ProvenanceRecord {
  id: string;
  label: string;
  source: string;
  provider?: string;
  retrievedAt?: string;
  effectiveAt?: string;
  freshness: DataFreshness;
  transformations: ProvenanceTransformation[];
  assumptions: string[];
  quality: "verified" | "normal" | "warning" | "unavailable";
  conflicts: string[];
  fallbackSource?: string;
  sourceUrl?: string;
}

export interface CalculationReceipt {
  id: string;
  label: string;
  engine: string;
  engineVersion?: string;
  modelVersion?: string;
  createdAt: string;
  inputs: Readonly<Record<string, string | number | boolean | null>>;
  parameters: Readonly<Record<string, string | number | boolean | null>>;
  outputs: Readonly<Record<string, string | number | boolean | null>>;
  diagnostics: string[];
  warnings: string[];
  reproducibilityId: string;
}

export interface EvidenceSnapshot {
  provenance: ProvenanceRecord[];
  receipts: CalculationReceipt[];
}

type EvidenceListener = (snapshot: EvidenceSnapshot) => void;

const EMPTY_SNAPSHOT: EvidenceSnapshot = { provenance: [], receipts: [] };
let snapshot: EvidenceSnapshot = EMPTY_SNAPSHOT;
const listeners = new Set<EvidenceListener>();

function emit(): void {
  const next = getEvidenceSnapshot();
  for (const listener of listeners) listener(next);
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function getEvidenceSnapshot(): EvidenceSnapshot {
  return {
    provenance: snapshot.provenance.map((item) => ({
      ...item,
      transformations: item.transformations.map((step) => ({ ...step })),
      assumptions: [...item.assumptions],
      conflicts: [...item.conflicts],
    })),
    receipts: snapshot.receipts.map((item) => ({
      ...item,
      inputs: { ...item.inputs },
      parameters: { ...item.parameters },
      outputs: { ...item.outputs },
      diagnostics: [...item.diagnostics],
      warnings: [...item.warnings],
    })),
  };
}

export function subscribeEvidence(listener: EvidenceListener): () => void {
  listeners.add(listener);
  listener(getEvidenceSnapshot());
  return () => listeners.delete(listener);
}

export function replacePanelEvidence(next: Partial<EvidenceSnapshot>): void {
  snapshot = {
    provenance: uniqueById(next.provenance ?? []),
    receipts: uniqueById(next.receipts ?? []),
  };
  emit();
}

export function publishProvenance(record: ProvenanceRecord): void {
  snapshot = {
    ...snapshot,
    provenance: [record, ...snapshot.provenance.filter((item) => item.id !== record.id)].slice(0, 50),
  };
  emit();
}

export function publishCalculationReceipt(receipt: CalculationReceipt): void {
  snapshot = {
    ...snapshot,
    receipts: [receipt, ...snapshot.receipts.filter((item) => item.id !== receipt.id)].slice(0, 50),
  };
  emit();
}

export function clearEvidence(): void {
  snapshot = EMPTY_SNAPSHOT;
  emit();
}

export const FRESHNESS_LABELS: Record<DataFreshness, string> = {
  live: "Live",
  delayed: "Delayed",
  "end-of-day": "End of day",
  "point-in-time": "Point in time",
  "user-uploaded": "User uploaded",
  cached: "Cached",
  stale: "Stale",
  unavailable: "Unavailable",
};

export function createReproducibilityId(parts: readonly (string | number | boolean | null | undefined)[]): string {
  // A deterministic lightweight identifier for UI receipts. This is not a
  // cryptographic integrity proof; engines may replace it with their own hash.
  const input = parts.map((part) => String(part ?? "")).join("|");
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `lios-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
