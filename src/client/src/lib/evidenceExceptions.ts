import type { EvidenceObservation, TrustManifest } from "@shared/trustContracts";

/**
 * Display-only reading of the current manifest's recorded state.
 * This never rechecks credentials, grants rights or proves a live revocation.
 */
export type RecordedAccessLevel = "blocked" | "restricted" | "unknown" | "recorded";

export interface RecordedAccessAssessment {
  level: RecordedAccessLevel;
  label: string;
}

const BLOCKED_STATES = new Set([
  "revoked", "access_revoked", "entitlement_revoked", "permission_revoked",
  "entitlement_denied", "policy_denied", "denied", "unauthorized", "forbidden",
  "expired", "disabled", "blocked",
]);
const RESTRICTED_STATES = new Set([
  "limited", "restricted", "rate_limited", "quota_exhausted", "degraded",
  "unreachable", "unavailable",
]);
const UNKNOWN_STATES = new Set(["unknown", "not_evaluated", "unverified", "unchecked"]);

function normalizeState(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function recordedSourceAccess(observation: EvidenceObservation): RecordedAccessAssessment {
  const state = observation.access?.state ? normalizeState(observation.access.state) : null;
  const connector = observation.connectorState ? normalizeState(observation.connectorState) : null;
  if (state && BLOCKED_STATES.has(state)) {
    return { level: "blocked", label: `Recorded source access: ${state.replaceAll("_", " ")}` };
  }
  if (connector === "disabled") {
    return { level: "blocked", label: "Recorded connector state: disabled" };
  }
  if (state && RESTRICTED_STATES.has(state)) {
    return { level: "restricted", label: `Recorded source access: ${state.replaceAll("_", " ")}` };
  }
  if (observation.access?.entitlementRequired === true) {
    return { level: "restricted", label: "Recorded entitlement requirement — access may be limited" };
  }
  if (connector && ["rate_limited", "degraded"].includes(connector)) {
    return { level: "restricted", label: `Recorded connector state: ${connector.replaceAll("_", " ")}` };
  }
  if (!state || UNKNOWN_STATES.has(state)) {
    return { level: "unknown", label: "Source access/entitlement not confirmed in this manifest" };
  }
  // A state named "allowed" is only a historical record; no live grant is inferred.
  return { level: "recorded", label: `Recorded source access: ${state.replaceAll("_", " ")} (not a live rights check)` };
}

export interface EvidenceConflictReview {
  field: string;
  state: "minor" | "material";
  summary: string;
  differencePct: number | null;
  sourceRefs: string[];
  /** One source can have multiple observations; never choose one silently. */
  sources: Array<{ ref: string; observations: EvidenceObservation[] }>;
}

export interface EvidenceUnknownReview {
  claimId: string;
  label: string;
  status: "supported" | "partial" | "unsupported" | "conflicted";
  message: string;
}

export interface EvidenceAccessReview {
  ref: string;
  observation: EvidenceObservation;
  assessment: RecordedAccessAssessment;
}

export interface EvidenceExceptionReview {
  conflicts: EvidenceConflictReview[];
  unknown: EvidenceUnknownReview[];
  access: EvidenceAccessReview[];
  recoveryActions: string[];
}

/** Only joins by exact manifest sourceRefs; no fuzzy labels or inferred provider IDs. */
export function reviewEvidenceExceptions(manifest: TrustManifest): EvidenceExceptionReview {
  const byRef = new Map<string, EvidenceObservation[]>();
  for (const observation of manifest.evidence) {
    const group = byRef.get(observation.sourceRef) ?? [];
    group.push(observation);
    byRef.set(observation.sourceRef, group);
  }

  const conflicts = manifest.conflicts.map(conflict => {
    const sourceRefs = [...new Set(conflict.sourceRefs)];
    return {
      field: conflict.field,
      state: conflict.state,
      summary: conflict.summary,
      differencePct: conflict.relativeDifference === null ? null : conflict.relativeDifference * 100,
      sourceRefs,
      sources: sourceRefs.map(ref => ({ ref, observations: byRef.get(ref) ?? [] })),
    };
  });

  const unknown: EvidenceUnknownReview[] = [];
  const referenceSet = new Set(manifest.evidence.map(item => item.sourceRef));
  for (const claim of manifest.claims) {
    const referenced = [...new Set(claim.sourceRefs)];
    const unresolved = referenced.filter(ref => !referenceSet.has(ref));
    if (claim.status === "unsupported") {
      unknown.push({ claimId: claim.claimId, label: claim.label, status: claim.status, message: "Claim unsupported in the recorded trust manifest" });
    } else if (claim.status === "conflicted" && !manifest.conflicts.some(conflict => conflict.sourceRefs.some(ref => referenced.includes(ref)))) {
      unknown.push({ claimId: claim.claimId, label: claim.label, status: claim.status, message: "Claim marked conflicted; matching conflict detail was not recorded" });
    } else if (claim.status === "partial") {
      unknown.push({ claimId: claim.claimId, label: claim.label, status: claim.status, message: "Claim only partially supported by recorded evidence" });
    }
    if (unresolved.length) {
      unknown.push({
        claimId: claim.claimId, label: claim.label, status: claim.status,
        message: `${unresolved.length} referenced source${unresolved.length === 1 ? "" : "s"} missing from the recorded evidence`,
      });
    } else if (claim.status === "supported" && !referenced.length && !claim.receiptIds.length) {
      unknown.push({ claimId: claim.claimId, label: claim.label, status: claim.status, message: "No source reference or receipt recorded to inspect this support claim" });
    }
  }

  const access: EvidenceAccessReview[] = manifest.evidence.flatMap(observation => {
    const assessment = recordedSourceAccess(observation);
    // We surface explicit denial, restrictions and unassessed access, never
    // promote a missing check to a verified grant.
    return assessment.level === "recorded" ? [] : [{
      ref: observation.sourceRef, observation, assessment,
    }];
  });
  const recoveryActions = [...new Set(manifest.missing.flatMap(item => item.recoveryActions))];
  return { conflicts, unknown, access, recoveryActions };
}

/** A small truthful summary for the always-visible limitations banner. */
export function sourceExceptionCaveats(review: EvidenceExceptionReview): string[] {
  const lines: string[] = [];
  for (const problem of review.unknown) lines.push(`${problem.label}: ${problem.message}.`);
  for (const item of review.access) {
    if (item.assessment.level === "blocked" || item.assessment.level === "restricted") {
      lines.push(`${item.observation.providerLabel}: ${item.assessment.label}. Recheck entitlement before reuse.`);
    }
  }
  return [...new Set(lines)];
}
