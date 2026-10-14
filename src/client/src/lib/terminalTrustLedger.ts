import type { CalculationReceipt, DataFreshness, EvidenceSnapshot, ProvenanceRecord } from "./terminalEvidence";

export interface TrustLedgerComponent {
  id: "source-presence" | "freshness" | "quality" | "receipt-presence" | "reproducibility";
  label: string;
  score: number;
  detail: string;
}

export interface TrustLedgerSnapshot {
  coverageScore: number;
  grade: "strong" | "moderate" | "limited" | "insufficient";
  components: TrustLedgerComponent[];
  sourceCount: number;
  receiptCount: number;
  warningCount: number;
  conflictCount: number;
  unavailableCount: number;
  gaps: string[];
  freshness: Record<DataFreshness, number>;
}

const FRESHNESS_WEIGHT: Record<DataFreshness, number> = {
  live: 100,
  delayed: 80,
  "end-of-day": 72,
  "point-in-time": 100,
  "user-uploaded": 82,
  cached: 55,
  stale: 20,
  unavailable: 0,
};

function average(values: readonly number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function qualityScore(record: ProvenanceRecord): number {
  if (record.quality === "verified") return 100;
  if (record.quality === "normal") return 80;
  if (record.quality === "warning") return 35;
  return 0;
}

function reproducibilityScore(receipts: readonly CalculationReceipt[]): number {
  if (!receipts.length) return 0;
  return receipts.filter((receipt) => Boolean(receipt.reproducibilityId?.trim())).length / receipts.length * 100;
}

function grade(score: number): TrustLedgerSnapshot["grade"] {
  if (score >= 85) return "strong";
  if (score >= 65) return "moderate";
  if (score >= 35) return "limited";
  return "insufficient";
}

export function buildTrustLedger(evidence: EvidenceSnapshot): TrustLedgerSnapshot {
  const sources = evidence.provenance;
  const receipts = evidence.receipts;
  const sourcePresence = sources.length ? 100 : 0;
  const freshnessScore = average(sources.map((source) => FRESHNESS_WEIGHT[source.freshness]));
  const sourceQuality = average(sources.map(qualityScore));
  const receiptPresence = receipts.length ? 100 : 0;
  const reproducibility = reproducibilityScore(receipts);
  const warningCount = receipts.reduce((sum, receipt) => sum + receipt.warnings.length, 0);
  const conflictCount = sources.reduce((sum, source) => sum + source.conflicts.length, 0);
  const unavailableCount = sources.filter((source) => source.quality === "unavailable" || source.freshness === "unavailable").length;

  const components: TrustLedgerComponent[] = [
    { id: "source-presence", label: "SOURCE PRESENCE", score: sourcePresence, detail: sources.length ? `${sources.length} provenance records published.` : "No provenance records published by this surface." },
    { id: "freshness", label: "FRESHNESS COVERAGE", score: freshnessScore, detail: sources.length ? "Weighted from explicit freshness metadata." : "Freshness cannot be assessed without provenance." },
    { id: "quality", label: "SOURCE QUALITY FLAGS", score: sourceQuality, detail: sources.length ? "Uses explicit verified/normal/warning/unavailable flags." : "No source quality flags available." },
    { id: "receipt-presence", label: "CALCULATION RECEIPTS", score: receiptPresence, detail: receipts.length ? `${receipts.length} calculation receipts published.` : "No calculation receipt published by this surface." },
    { id: "reproducibility", label: "REPRODUCIBILITY IDS", score: reproducibility, detail: receipts.length ? `${receipts.filter((receipt) => Boolean(receipt.reproducibilityId?.trim())).length}/${receipts.length} receipts have reproducibility IDs.` : "No receipts available for reproducibility coverage." },
  ];

  let coverageScore = average(components.map((component) => component.score));
  coverageScore = Math.max(0, coverageScore - Math.min(20, warningCount * 2) - Math.min(20, conflictCount * 3) - Math.min(25, unavailableCount * 5));

  const gaps: string[] = [];
  if (!sources.length) gaps.push("Surface has not published provenance.");
  if (!receipts.length) gaps.push("Surface has not published a calculation receipt.");
  if (sources.some((source) => source.freshness === "stale")) gaps.push("One or more sources are explicitly stale.");
  if (unavailableCount) gaps.push(`${unavailableCount} source records are unavailable.`);
  if (warningCount) gaps.push(`${warningCount} calculation warnings are present.`);
  if (conflictCount) gaps.push(`${conflictCount} source conflicts are recorded.`);
  if (receipts.some((receipt) => !receipt.reproducibilityId?.trim())) gaps.push("One or more calculation receipts lack a reproducibility ID.");

  const freshness = Object.fromEntries(Object.keys(FRESHNESS_WEIGHT).map((key) => [key, 0])) as Record<DataFreshness, number>;
  for (const source of sources) freshness[source.freshness] += 1;

  return {
    coverageScore: Math.round(coverageScore),
    grade: grade(coverageScore),
    components,
    sourceCount: sources.length,
    receiptCount: receipts.length,
    warningCount,
    conflictCount,
    unavailableCount,
    gaps,
    freshness,
  };
}
