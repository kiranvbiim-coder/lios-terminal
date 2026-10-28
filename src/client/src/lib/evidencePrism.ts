import type { EvidenceClaim, EvidenceObservation, TrustManifest } from "@shared/trustContracts";
import { recordedIsoTimestamp } from "./recordedIsoTimestamp";

/**
 * A read-only projection of one recorded P3 claim. Do not imply that status
 * "supported" verifies a reference, grants data rights, or supplies units.
 */
export interface PrismSource {
  ref: string;
  observations: readonly EvidenceObservation[];
}

export interface PrismAssumption {
  ref: string;
  record: TrustManifest["assumptions"][number] | null;
}

export interface PrismClaimInspection {
  claim: EvidenceClaim;
  sources: PrismSource[];
  assumptions: PrismAssumption[];
  receiptIds: readonly string[];
  formulaRefs: readonly string[];
  /** The P3 claim and observation contracts have no numerical unit field. */
  unit: null;
  missingSourceCount: number;
  missingAssumptionCount: number;
}

export function inspectEvidenceClaim(manifest: TrustManifest, claimId: string): PrismClaimInspection | null {
  const claim = manifest.claims.find(item => item.claimId === claimId);
  if (!claim) return null;
  // Exact refs, not provider display names, fuzzy labels or model-created URLs.
  const sources: PrismSource[] = [...new Set(claim.sourceRefs)].map(ref => ({
    ref,
    observations: manifest.evidence.filter(item => item.sourceRef === ref),
  }));
  const assumptions: PrismAssumption[] = [...new Set(claim.assumptionRefs)].map(ref => ({
    ref,
    record: manifest.assumptions.find(item => item.ref === ref) ?? null,
  }));
  return {
    claim,
    sources,
    assumptions,
    receiptIds: [...new Set(claim.receiptIds)],
    formulaRefs: [...new Set(claim.formulaRefs)],
    unit: null,
    missingSourceCount: sources.filter(source => source.observations.length === 0).length,
    missingAssumptionCount: assumptions.filter(assumption => !assumption.record).length,
  };
}

/** Data rights are a recorded provider state, not a permission inferred by the UI. */
export function describeObservationRights(observation: EvidenceObservation): string {
  const access = observation.access;
  if (!access) return "Access/entitlement not recorded — no usage grant established";
  const state = access.state.replaceAll("_", " ");
  const level = access.servedTier ? ` · served tier ${access.servedTier.replaceAll("_", " ")}` : "";
  const upgrade = access.entitlementRequired === true ? " · entitlement required" :
    access.entitlementRequired === false ? " · entitlement not flagged as required" : " · entitlement not assessed";
  const note = access.reason ? ` · ${access.reason}` : "";
  return `Recorded access: ${state}${level}${upgrade}${note}`;
}

/** Render unknown values as unknown. This is NOT a serializer for private assumption objects. */
export function readableAssumptionValue(value: unknown): string {
  if (typeof value === "string") return value.length > 160 ? `${value.slice(0, 160)}…` : value;
  if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return String(value);
  if (value === null) return "null (recorded)";
  return "Structured value recorded; inspect the governed Artifact for detail";
}


/**
 * B05/B06 read-only evidence time slice of the CURRENT P3 manifest. This does
 * not restore earlier claims/permissions, claim status or provider contents.
 * Invalid/ambiguous timestamps never pass the historical filter.
 */
export function inspectEvidenceClaimObservedBy(
  manifest: TrustManifest,
  claimId: string,
  observedBy: string | null,
): PrismClaimInspection | null {
  const inspected = inspectEvidenceClaim(manifest, claimId);
  if (!inspected || !observedBy) return inspected;
  const cutoff = recordedIsoTimestamp(observedBy);
  if (!cutoff) return null;
  const cutoffMs = Date.parse(cutoff);
  const sources = inspected.sources.map(source => ({
    ...source,
    observations: source.observations.filter(observation => {
      const recorded = recordedIsoTimestamp(observation.observedAt);
      return !!recorded && Date.parse(recorded) <= cutoffMs;
    }),
  }));
  return {
    ...inspected, sources,
    missingSourceCount: sources.filter(source => source.observations.length === 0).length,
  };
}

/** Only offered time choices from exact recorded observations within this P3 manifest. */
export function claimObservedTimeChoices(manifest: TrustManifest, claimId: string): string[] {
  const inspected = inspectEvidenceClaim(manifest, claimId);
  if (!inspected) return [];
  return [...new Set(inspected.sources.flatMap(source => source.observations)
    .map(observation => recordedIsoTimestamp(observation.observedAt))
    .filter((value): value is string => !!value))].sort();
}
