import crypto from "node:crypto";
import type { DataStatus } from "@shared/dataStatus";
import {
  evidenceClaimSchema,
  evidenceConflictSchema,
  evidenceObservationSchema,
  trustManifestSchema,
  type EvidenceClaim,
  type EvidenceConflict,
  type EvidenceObservation,
  type MethodologyStep,
  type TrustConfidence,
  type TrustFreshness,
  type TrustManifest,
  type TrustQuality,
} from "@shared/trustContracts";
import type { ConversationSourceScope } from "@shared/conversationRuntime";
import type { RuntimeExecutionReceipt } from "@shared/runtimeContracts";
import type { CapabilityResolution } from "./capabilityBroker";

const FRESHNESS_SCORE: Record<TrustFreshness, number> = {
  current: 1,
  delayed: 0.88,
  daily: 0.8,
  feed: 0.78,
  schedule: 0.72,
  snapshot: 0.7,
  manual: 0.66,
  reference: 0.58,
  ai_generated: 0.35,
  unknown: 0.45,
};

const CONNECTOR_SCORE: Record<string, number> = {
  live_verified: 1,
  credential_configured: 0.86,
  adapter_available: 0.62,
  degraded: 0.45,
  rate_limited: 0.4,
  catalog_only: 0.3,
  disabled: 0.15,
};

function hash(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function qualityLabel(score: number): TrustQuality {
  if (score >= 0.82) return "high";
  if (score >= 0.58) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

function confidenceLabel(score: number): TrustConfidence {
  if (score >= 0.84) return "high";
  if (score >= 0.6) return "medium";
  if (score > 0) return "low";
  return "unknown";
}

export function trustFreshnessFromDataStatus(status: DataStatus | null | undefined): TrustFreshness {
  return status?.freshness ?? "unknown";
}

export function evidenceFromDataStatus(input: {
  sourceRef: string;
  providerId?: string | null;
  providerLabel?: string | null;
  status?: DataStatus | null;
  kind?: EvidenceObservation["kind"];
  connectorState?: string | null;
  access?: EvidenceObservation["access"];
  fields?: string[];
  value?: unknown;
  notes?: string[];
  observedAt?: string;
}): EvidenceObservation {
  const freshness = trustFreshnessFromDataStatus(input.status);
  const connectorScore = input.connectorState ? (CONNECTOR_SCORE[input.connectorState] ?? 0.5) : 0.7;
  const fallbackPenalty = input.status?.isFallback ? 0.14 : 0;
  const score = Math.max(0.05, FRESHNESS_SCORE[freshness] * 0.65 + connectorScore * 0.35 - fallbackPenalty);
  return evidenceObservationSchema.parse({
    evidenceId: crypto.randomUUID(),
    sourceRef: input.sourceRef,
    providerId: input.providerId ?? null,
    providerLabel: input.providerLabel ?? input.status?.provider ?? "LiOS source",
    kind: input.kind ?? "provider",
    observedAt: input.observedAt ?? new Date().toISOString(),
    asOf: normalizeAsOf(input.status?.asOf),
    freshness,
    quality: qualityLabel(score),
    confidence: confidenceLabel(score),
    connectorState: input.connectorState ?? null,
    isFallback: input.status?.isFallback ?? false,
    access: input.access ?? null,
    fields: input.fields ?? [],
    valueHash: input.value === undefined ? null : hash(input.value),
    notes: input.notes ?? [],
  });
}

function normalizeAsOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

export interface NumericObservation {
  field: string;
  sourceRef: string;
  value: number;
}

export function detectNumericEvidenceConflicts(
  observations: NumericObservation[],
  tolerancePct = 0.5,
): EvidenceConflict[] {
  const byField = new Map<string, NumericObservation[]>();
  for (const observation of observations) {
    if (!Number.isFinite(observation.value)) continue;
    const list = byField.get(observation.field) ?? [];
    list.push(observation);
    byField.set(observation.field, list);
  }

  const conflicts: EvidenceConflict[] = [];
  for (const [field, values] of byField) {
    if (values.length < 2) continue;
    const min = Math.min(...values.map((item) => item.value));
    const max = Math.max(...values.map((item) => item.value));
    const denominator = Math.max(Math.abs(min), Math.abs(max), Number.EPSILON);
    const relativeDifference = Math.abs(max - min) / denominator;
    const threshold = tolerancePct / 100;
    if (relativeDifference <= threshold) continue;
    conflicts.push(evidenceConflictSchema.parse({
      field,
      state: relativeDifference >= threshold * 4 ? "material" : "minor",
      sourceRefs: [...new Set(values.map((item) => item.sourceRef))],
      relativeDifference,
      summary: `${field} differs by ${(relativeDifference * 100).toFixed(2)}% across observed sources; LiOS preserved the disagreement instead of silently selecting a value.`,
    }));
  }
  return conflicts;
}

export function buildEvidenceClaim(input: {
  label: string;
  path: string;
  sourceRefs?: string[];
  receiptIds?: string[];
  formulaRefs?: string[];
  assumptionRefs?: string[];
  status?: EvidenceClaim["status"];
  confidence?: TrustConfidence;
  explanation: string;
}): EvidenceClaim {
  return evidenceClaimSchema.parse({
    claimId: crypto.randomUUID(),
    label: input.label,
    path: input.path,
    status: input.status ?? "supported",
    sourceRefs: input.sourceRefs ?? [],
    receiptIds: input.receiptIds ?? [],
    formulaRefs: input.formulaRefs ?? [],
    assumptionRefs: input.assumptionRefs ?? [],
    confidence: input.confidence ?? ((input.sourceRefs?.length ?? 0) ? "medium" : "low"),
    explanation: input.explanation,
  });
}

function scoreEvidence(evidence: EvidenceObservation[]): number {
  if (!evidence.length) return 0;
  const qualityScore: Record<TrustQuality, number> = { high: 1, medium: 0.7, low: 0.4, unknown: 0.25 };
  return evidence.reduce((sum, item) => sum + qualityScore[item.quality], 0) / evidence.length;
}

function aggregateFreshness(evidence: EvidenceObservation[]): TrustFreshness {
  if (!evidence.length) return "unknown";
  return [...evidence].sort((a, b) => FRESHNESS_SCORE[a.freshness] - FRESHNESS_SCORE[b.freshness])[0].freshness;
}

export function buildTrustManifest(input: {
  requestId: string;
  sourceScope: ConversationSourceScope;
  evidence?: EvidenceObservation[];
  claims?: EvidenceClaim[];
  conflicts?: EvidenceConflict[];
  conflictEvaluated?: boolean;
  methodology?: MethodologyStep[];
  receipts?: RuntimeExecutionReceipt[];
  receiptIds?: string[];
  assumptions?: TrustManifest["assumptions"];
  missing?: TrustManifest["missing"];
  warnings?: string[];
}): TrustManifest {
  const evidence = input.evidence ?? [];
  const claims = input.claims ?? [];
  const conflicts = input.conflicts ?? [];
  const receipts = input.receipts ?? [];
  const missing = input.missing ?? [];
  const supportedClaims = claims.filter((claim) => claim.status === "supported").length;
  const partialClaims = claims.filter((claim) => claim.status === "partial").length;
  const totalClaims = claims.length;
  const evidenceCoveragePct = totalClaims
    ? Math.round(((supportedClaims + partialClaims * 0.5) / totalClaims) * 10000) / 100
    : evidence.length
      ? 100
      : 0;

  const evidenceScore = scoreEvidence(evidence);
  const conflictPenalty = conflicts.some((item) => item.state === "material") ? 0.3 : conflicts.length ? 0.12 : 0;
  const missingPenalty = Math.min(0.4, missing.length * 0.08);
  const coverageFactor = evidenceCoveragePct / 100;
  const score = Math.max(0, evidenceScore * 0.65 + coverageFactor * 0.35 - conflictPenalty - missingPenalty);

  return trustManifestSchema.parse({
    schemaVersion: "1",
    trustId: crypto.randomUUID(),
    requestId: input.requestId,
    generatedAt: new Date().toISOString(),
    sourceScope: input.sourceScope,
    summary: {
      freshness: aggregateFreshness(evidence),
      quality: qualityLabel(score),
      confidence: confidenceLabel(score),
      conflictState: conflicts.some((item) => item.state === "material")
        ? "material"
        : conflicts.length
          ? "minor"
          : input.conflictEvaluated
            ? "none"
            : "not_evaluated_single_source",
      evidenceCoveragePct,
      sourceCount: new Set(evidence.map((item) => item.sourceRef)).size,
      receiptCount: new Set([...receipts.map((receipt) => receipt.id), ...(input.receiptIds ?? [])]).size,
      missingCount: missing.length,
    },
    evidence,
    claims,
    conflicts,
    methodology: input.methodology ?? [],
    assumptions: input.assumptions ?? [],
    missing,
    warnings: input.warnings ?? [],
  });
}


function relativeDifferenceFromConflictValues(values: Array<{ providerId: string; value: unknown }>): number | null {
  const numeric = values.map((item) => item.value).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (numeric.length < 2) return null;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const denominator = Math.max(Math.abs(min), Math.abs(max), Number.EPSILON);
  return Math.abs(max - min) / denominator;
}

/**
 * P3 bridge for the existing multi-provider capability broker.
 * financialStatementsBroker.ts already returns this exact CapabilityResolution
 * shape, so real provider disagreement can flow into Show Work without
 * inventing another conflict model.
 */
export function buildTrustManifestFromCapabilityResolution<T>(input: {
  requestId: string;
  sourceScope: ConversationSourceScope;
  resolution: CapabilityResolution<T>;
  receiptIds?: string[];
  methodology?: MethodologyStep[];
  assumptions?: TrustManifest["assumptions"];
}): TrustManifest {
  const { resolution } = input;
  const observedAt = (() => {
    const parsed = Date.parse(resolution.resolvedAt);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
  })();

  const evidence: EvidenceObservation[] = resolution.observations.map((observation) => evidenceObservationSchema.parse({
    evidenceId: crypto.randomUUID(),
    sourceRef: `provider:${observation.providerId}`,
    providerId: observation.providerId,
    providerLabel: observation.providerLabel,
    kind: "provider",
    observedAt,
    asOf: null,
    freshness: "unknown",
    quality: "unknown",
    confidence: "medium",
    connectorState: null,
    isFallback: resolution.authoritative?.providerId !== observation.providerId,
    access: null,
    fields: [],
    valueHash: hash(observation.value),
    notes: resolution.authoritative?.providerId === observation.providerId
      ? [resolution.authoritativeReason ?? "Selected as the authoritative observation by the capability resolver."]
      : ["Observed from an alternate provider during multi-provider conflict evaluation."],
  }));

  const conflicts: EvidenceConflict[] = resolution.conflicts.map((conflict) => evidenceConflictSchema.parse({
    field: conflict.key ? `${conflict.key}.${conflict.field}` : conflict.field,
    state: conflict.material === false ? "minor" : "material",
    sourceRefs: [...new Set(conflict.values.map((item) => `provider:${item.providerId}`))],
    relativeDifference: relativeDifferenceFromConflictValues(conflict.values),
    summary: `${conflict.field} disagrees across ${conflict.values.length} provider observation(s)${conflict.material === false ? " within the broker's non-material tolerance" : " and is material under the broker's domain rule"}. LiOS preserves the disagreement.`,
  }));

  const sourceRefs = evidence.map((item) => item.sourceRef);
  const authoritativeSourceRef = resolution.authoritative ? `provider:${resolution.authoritative.providerId}` : null;
  const claims: EvidenceClaim[] = [
    buildEvidenceClaim({
      label: `${resolution.capability} authoritative observation`,
      path: `capability.${resolution.capability}.authoritative`,
      status: resolution.authoritative ? (conflicts.some((item) => item.state === "material") ? "conflicted" : "supported") : "unsupported",
      sourceRefs: authoritativeSourceRef ? [authoritativeSourceRef] : [],
      receiptIds: input.receiptIds ?? [],
      confidence: resolution.authoritative ? (conflicts.some((item) => item.state === "material") ? "medium" : "high") : "low",
      explanation: resolution.authoritative
        ? (resolution.authoritativeReason ?? "The capability broker selected this provider from the observations that returned usable data.")
        : "No provider returned a usable authoritative observation.",
    }),
  ];

  const missing = resolution.authoritative ? [] : [{
    field: resolution.capability,
    reason: resolution.failures.length
      ? `No provider returned usable data; ${resolution.failures.length} provider attempt(s) failed.`
      : "No provider returned usable data.",
    recoveryActions: ["Connect or select another compatible provider", "Import user-owned data", "Retry the provider request"],
  }];

  return buildTrustManifest({
    requestId: input.requestId,
    sourceScope: input.sourceScope,
    evidence,
    claims,
    conflicts,
    conflictEvaluated: resolution.observations.length > 1,
    methodology: input.methodology ?? [],
    receiptIds: input.receiptIds ?? [],
    assumptions: input.assumptions ?? [],
    missing,
    warnings: resolution.failures.map((failure) => `${failure.providerId}: ${failure.message}`),
  });
}
