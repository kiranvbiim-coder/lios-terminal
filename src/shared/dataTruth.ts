/**
 * Data Truth Layer: the pipeline that converts raw provider/private data into
 * trusted LiOS inputs. Every important number flowing through an engine passes
 * through this layer, which stamps a DataPassport on it recording source,
 * mapping, normalization, validation, conflict resolution, and freshness.
 *
 * The pipeline is: Connect → Map → Normalize → Validate → Resolve → Trace.
 *
 * Design rules:
 * - Raw provider data enters; passported, validated data exits.
 * - Multiple providers can supply the same contract field; conflict resolution
 *   picks one and records why.
 * - Every passport is deterministic: same inputs produce the same passport.
 * - AI never modifies passport data; AI can explain/interpret it.
 */
import crypto from "crypto";

// ─── Source Binding ───────────────────────────────────────────────────────

export type SourcePriority = "primary" | "secondary" | "fallback" | "manual_override";

export interface SourceBinding {
  contractFamily: string;
  field: string;
  connectorId: string;
  provider: string;
  priority: SourcePriority;
  mapping?: string;
  transformations?: string[];
}

// ─── Data Quality ─────────────────────────────────────────────────────────

export type DataQualityLevel = "high" | "medium" | "low" | "unverified" | "stale" | "conflict";

export interface DataQualityAssessment {
  level: DataQualityLevel;
  completeness: number;
  freshnessScore: number;
  conflictCount: number;
  warnings: string[];
}

// ─── Normalization ────────────────────────────────────────────────────────

export type NormalizationKind =
  | "currency_conversion"
  | "unit_conversion"
  | "date_normalization"
  | "fiscal_period_alignment"
  | "corporate_action_adjustment"
  | "identifier_resolution"
  | "none";

export interface NormalizationRecord {
  kind: NormalizationKind;
  field: string;
  fromValue: string;
  toValue: string;
  rule: string;
}

// ─── Conflict Resolution ──────────────────────────────────────────────────

export type ConflictResolutionStrategy =
  | "primary_source"
  | "latest_timestamp"
  | "highest_quality"
  | "manual_override"
  | "authoritative_filing";

export interface DataConflict {
  field: string;
  values: Array<{
    value: unknown;
    connectorId: string;
    provider: string;
    retrievedAt: string;
    quality: DataQualityLevel;
  }>;
  resolvedValue: unknown;
  strategy: ConflictResolutionStrategy;
  resolvedFrom: string;
  reason: string;
}

// ─── Data Passport ────────────────────────────────────────────────────────

export interface DataPassportEntry {
  field: string;
  value: unknown;
  source: {
    connectorId: string;
    provider: string;
    priority: SourcePriority;
  };
  retrievedAt: string;
  freshnessDays: number;
  currency?: string;
  unit?: string;
  period?: string;
  normalizations: NormalizationRecord[];
  conflict?: DataConflict;
}

export interface DataPassport {
  id: string;
  contractFamily: string;
  entityKey: string;
  entries: DataPassportEntry[];
  quality: DataQualityAssessment;
  snapshotHash: string;
  createdAt: string;
  /** If this passport was used as engine input, the engine's output hash */
  engineOutputHash?: string;
  /** Engine that consumed this passport */
  engineId?: string;
  /** Engine version */
  engineVersion?: string;
}

export interface CalculatedPassport {
  id: string;
  engineId: string;
  engineVersion: string;
  calculatedAt: string;
  inputs: Array<{ passportId: string; contractFamily: string; entityKey: string }>;
  assumptions: Array<{ key: string; value: unknown; source: string }>;
  outputHash: string;
  limitations: string[];
}

// ─── Pipeline Functions ───────────────────────────────────────────────────

function stableSerialize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSerialize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = stableSerialize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function stableHash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(stableSerialize(value))).digest("hex");
}

export function generatePassportId(): string {
  return `ppt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function computeSnapshotHash(entries: DataPassportEntry[]): string {
  return stableHash(entries.map((e) => ({ field: e.field, value: e.value, source: e.source.connectorId, retrievedAt: e.retrievedAt })));
}

export function assessDataQuality(entries: DataPassportEntry[], requiredFields: string[]): DataQualityAssessment {
  const warnings: string[] = [];
  const now = Date.now();

  const availableFields = new Set(entries.map((e) => e.field));
  const requiredMet = requiredFields.filter((f) => availableFields.has(f));
  const completeness = requiredFields.length > 0 ? requiredMet.length / requiredFields.length : 1;

  if (completeness < 1) {
    const missing = requiredFields.filter((f) => !availableFields.has(f));
    warnings.push(`Missing required fields: ${missing.join(", ")}`);
  }

  const maxAgeDays = 90;
  const staleEntries = entries.filter((e) => e.freshnessDays > maxAgeDays);
  if (staleEntries.length > 0) {
    warnings.push(`${staleEntries.length} field(s) are stale (>${maxAgeDays} days old)`);
  }

  const avgFreshness = entries.length > 0
    ? entries.reduce((sum, e) => sum + Math.max(0, 1 - e.freshnessDays / maxAgeDays), 0) / entries.length
    : 0;

  const conflictCount = entries.filter((e) => e.conflict).length;
  if (conflictCount > 0) {
    warnings.push(`${conflictCount} field(s) have source conflicts (resolved)`);
  }

  let level: DataQualityLevel;
  if (completeness >= 0.9 && avgFreshness >= 0.7 && conflictCount === 0) level = "high";
  else if (completeness >= 0.7 && avgFreshness >= 0.4) level = conflictCount > 0 ? "conflict" : "medium";
  else if (avgFreshness < 0.3) level = "stale";
  else level = "low";

  return { level, completeness, freshnessScore: avgFreshness, conflictCount, warnings };
}

export function resolveConflict(
  field: string,
  candidates: Array<{ value: unknown; connectorId: string; provider: string; retrievedAt: string; quality: DataQualityLevel; priority: SourcePriority }>,
  strategy: ConflictResolutionStrategy = "primary_source",
): DataConflict {
  const sorted = [...candidates].sort((a, b) => {
    const priorityOrder: Record<SourcePriority, number> = { manual_override: 0, primary: 1, secondary: 2, fallback: 3 };
    switch (strategy) {
      case "manual_override":
      case "primary_source":
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      case "latest_timestamp":
        return new Date(b.retrievedAt).getTime() - new Date(a.retrievedAt).getTime();
      case "highest_quality": {
        const qualityOrder: Record<DataQualityLevel, number> = { high: 0, medium: 1, low: 2, unverified: 3, stale: 4, conflict: 5 };
        return qualityOrder[a.quality] - qualityOrder[b.quality];
      }
      case "authoritative_filing":
        return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
  });

  const winner = sorted[0];
  return {
    field,
    values: candidates.map((c) => ({ value: c.value, connectorId: c.connectorId, provider: c.provider, retrievedAt: c.retrievedAt, quality: c.quality })),
    resolvedValue: winner.value,
    strategy,
    resolvedFrom: winner.connectorId,
    reason: `Selected ${winner.provider} (${strategy})`,
  };
}

export function buildPassportEntry(
  field: string,
  value: unknown,
  binding: SourceBinding,
  retrievedAt: string,
  normalizations: NormalizationRecord[] = [],
  conflict?: DataConflict,
): DataPassportEntry {
  const freshnessDays = Math.max(0, (Date.now() - new Date(retrievedAt).getTime()) / 86_400_000);
  return {
    field,
    value,
    source: { connectorId: binding.connectorId, provider: binding.provider, priority: binding.priority },
    retrievedAt,
    freshnessDays,
    normalizations,
    conflict,
  };
}

export function buildDataPassport(
  contractFamily: string,
  entityKey: string,
  entries: DataPassportEntry[],
  requiredFields: string[],
): DataPassport {
  return {
    id: generatePassportId(),
    contractFamily,
    entityKey,
    entries,
    quality: assessDataQuality(entries, requiredFields),
    snapshotHash: computeSnapshotHash(entries),
    createdAt: new Date().toISOString(),
  };
}

export function buildCalculatedPassport(
  engineId: string,
  engineVersion: string,
  inputPassports: DataPassport[],
  assumptions: Array<{ key: string; value: unknown; source: string }>,
  outputHash: string,
  limitations: string[] = [],
): CalculatedPassport {
  return {
    id: generatePassportId(),
    engineId,
    engineVersion,
    calculatedAt: new Date().toISOString(),
    inputs: inputPassports.map((p) => ({ passportId: p.id, contractFamily: p.contractFamily, entityKey: p.entityKey })),
    assumptions,
    outputHash,
    limitations,
  };
}

// ─── Freshness Scoring ────────────────────────────────────────────────────

export function computeFreshnessDays(retrievedAt: string | Date, now = new Date()): number {
  const retrieved = typeof retrievedAt === "string" ? new Date(retrievedAt) : retrievedAt;
  return Math.max(0, (now.getTime() - retrieved.getTime()) / 86_400_000);
}

export function isFresh(retrievedAt: string | Date, maxDays: number, now = new Date()): boolean {
  return computeFreshnessDays(retrievedAt, now) <= maxDays;
}

// ─── Validation Checks ───────────────────────────────────────────────────

export interface ValidationResult {
  valid: boolean;
  checks: Array<{ check: string; passed: boolean; detail?: string }>;
}

export function validateAccountingIdentity(
  totalAssets: number | null | undefined,
  totalLiabilities: number | null | undefined,
  totalEquity: number | null | undefined,
  tolerance = 0.01,
): ValidationResult {
  const checks: Array<{ check: string; passed: boolean; detail?: string }> = [];

  if (totalAssets == null || totalLiabilities == null || totalEquity == null) {
    checks.push({ check: "accounting_identity", passed: false, detail: "Missing required values for A = L + E check" });
    return { valid: false, checks };
  }

  const expected = totalLiabilities + totalEquity;
  const diff = Math.abs(totalAssets - expected);
  const relDiff = totalAssets !== 0 ? diff / Math.abs(totalAssets) : diff;
  const passed = relDiff <= tolerance;

  checks.push({
    check: "accounting_identity",
    passed,
    detail: passed
      ? `A=${totalAssets}, L+E=${expected}, diff=${diff.toFixed(2)} (${(relDiff * 100).toFixed(4)}%)`
      : `FAILED: A=${totalAssets} ≠ L+E=${expected}, diff=${diff.toFixed(2)} (${(relDiff * 100).toFixed(4)}%)`,
  });

  return { valid: passed, checks };
}

export function validateSignConsistency(
  revenue: number | null | undefined,
  operatingIncome: number | null | undefined,
): ValidationResult {
  const checks: Array<{ check: string; passed: boolean; detail?: string }> = [];

  if (revenue != null && revenue < 0) {
    checks.push({ check: "revenue_sign", passed: false, detail: `Revenue is negative: ${revenue}` });
  } else if (revenue != null) {
    checks.push({ check: "revenue_sign", passed: true });
  }

  if (revenue != null && operatingIncome != null && Math.abs(operatingIncome) > Math.abs(revenue) * 5) {
    checks.push({ check: "operating_income_magnitude", passed: false, detail: `Operating income magnitude (${operatingIncome}) exceeds 5x revenue (${revenue})` });
  } else if (revenue != null && operatingIncome != null) {
    checks.push({ check: "operating_income_magnitude", passed: true });
  }

  return { valid: checks.every((c) => c.passed), checks };
}
