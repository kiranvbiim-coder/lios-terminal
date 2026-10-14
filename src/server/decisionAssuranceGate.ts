import type { ModelAssuranceArtifact, OutputCriticality } from "@shared/modelAssurance";
import type { ModelAssuranceResult } from "./modelAssurance";
import { verifyConfiguredModelAssuranceArtifact } from "./modelAssuranceIntegrity";

export const DECISION_ASSURANCE_GATE_VERSION = "1.2.0";

export type AssuranceReasonCode =
  | "ASSURANCE_MISSING"
  | "ASSURANCE_BLOCKED"
  | "ASSURANCE_RESEARCH_ONLY"
  | "ASSURANCE_REVIEW_REQUIRED"
  | "ASSURANCE_DECISION_GRADE_REQUIRED"
  | "ASSURANCE_INSTITUTIONAL_REQUIRED"
  | "ASSURANCE_SCORE_TOO_LOW"
  | "ASSURANCE_COMPONENT_TOO_LOW"
  | "ASSURANCE_HAS_BLOCKERS"
  | "ASSURANCE_EVIDENCE_EXPIRED"
  | "ASSURANCE_VALIDATION_ARTIFACT_MISSING"
  | "ASSURANCE_INPUT_SNAPSHOT_MISSING"
  | "ASSURANCE_CHALLENGER_MISSING"
  | "ASSURANCE_REPRODUCIBILITY_INVALID"
  | "ASSURANCE_INTERNAL_INCONSISTENCY"
  | "ASSURANCE_SIGNATURE_INVALID";

export interface DecisionAssurancePolicy {
  criticality: OutputCriticality;
  minimumBand: ModelAssuranceResult["band"];
  minimumScore: number;
  minimumComponentScore: number;
  allowWarnings: boolean;
}

export interface DecisionAssuranceGateResult {
  permitted: boolean;
  criticality: OutputCriticality;
  gateVersion: string;
  reasonCodes: AssuranceReasonCode[];
  reasons: string[];
}

const BAND_RANK: Record<ModelAssuranceResult["band"], number> = {
  blocked: 0,
  research_only: 1,
  review_required: 2,
  decision_grade: 3,
  institutional: 4,
};

const CRITICAL_EVIDENCE = new Set([
  "known_answer",
  "cross_engine",
  "provider_reconciliation",
  "out_of_sample",
]);

export const DEFAULT_DECISION_ASSURANCE_POLICIES: Record<OutputCriticality, DecisionAssurancePolicy> = {
  exploratory: {
    criticality: "exploratory",
    minimumBand: "research_only",
    minimumScore: 0,
    minimumComponentScore: 0,
    allowWarnings: true,
  },
  internal_analysis: {
    criticality: "internal_analysis",
    minimumBand: "review_required",
    minimumScore: 62,
    minimumComponentScore: 45,
    allowWarnings: true,
  },
  client_advisory: {
    criticality: "client_advisory",
    minimumBand: "decision_grade",
    minimumScore: 84,
    minimumComponentScore: 70,
    allowWarnings: true,
  },
  material_decision: {
    criticality: "material_decision",
    minimumBand: "institutional",
    minimumScore: 93,
    minimumComponentScore: 85,
    allowWarnings: false,
  },
};

function reasonForBand(required: ModelAssuranceResult["band"]): AssuranceReasonCode {
  switch (required) {
    case "institutional": return "ASSURANCE_INSTITUTIONAL_REQUIRED";
    case "decision_grade": return "ASSURANCE_DECISION_GRADE_REQUIRED";
    case "review_required": return "ASSURANCE_REVIEW_REQUIRED";
    case "research_only": return "ASSURANCE_RESEARCH_ONLY";
    case "blocked": return "ASSURANCE_BLOCKED";
  }
}

export function criticalityForDecision(
  materiality: "routine" | "material" | "critical",
  organizationId: number | null | undefined,
): OutputCriticality {
  if (materiality === "critical") return "material_decision";
  if (materiality === "material") return organizationId ? "client_advisory" : "material_decision";
  return organizationId ? "client_advisory" : "internal_analysis";
}

export function evaluateDecisionAssurance(
  assurance: ModelAssuranceResult,
  criticality: OutputCriticality,
  policy: DecisionAssurancePolicy = DEFAULT_DECISION_ASSURANCE_POLICIES[criticality],
): DecisionAssuranceGateResult {
  const reasonCodes: AssuranceReasonCode[] = [];
  const reasons: string[] = [];

  if (assurance.blockers.length > 0 || assurance.band === "blocked") {
    reasonCodes.push("ASSURANCE_HAS_BLOCKERS");
    reasons.push(`Assurance has unresolved blocker(s): ${assurance.blockers.join("; ") || "blocked assurance band"}`);
  }

  if (BAND_RANK[assurance.band] < BAND_RANK[policy.minimumBand]) {
    reasonCodes.push(reasonForBand(policy.minimumBand));
    reasons.push(`Output criticality ${criticality} requires ${policy.minimumBand} assurance or better; received ${assurance.band}`);
  }

  if (assurance.score < policy.minimumScore) {
    reasonCodes.push("ASSURANCE_SCORE_TOO_LOW");
    reasons.push(`Assurance score ${assurance.score} is below required ${policy.minimumScore}`);
  }

  const lowComponents = Object.entries(assurance.components)
    .filter(([, score]) => score < policy.minimumComponentScore)
    .map(([name, score]) => `${name}=${score}`);
  if (lowComponents.length > 0) {
    reasonCodes.push("ASSURANCE_COMPONENT_TOO_LOW");
    reasons.push(`Assurance component floor ${policy.minimumComponentScore} not met: ${lowComponents.join(", ")}`);
  }

  if (!policy.allowWarnings && assurance.warnings.length > 0) {
    reasonCodes.push("ASSURANCE_INSTITUTIONAL_REQUIRED");
    reasons.push(`Material decisions require warning-free assurance; found ${assurance.warnings.length} warning(s)`);
  }

  return {
    permitted: reasonCodes.length === 0,
    criticality,
    gateVersion: DECISION_ASSURANCE_GATE_VERSION,
    reasonCodes: [...new Set(reasonCodes)],
    reasons,
  };
}

function artifactToAssuranceResult(
  artifact: ModelAssuranceArtifact,
  evaluatedAt: string,
): ModelAssuranceResult {
  const blockers = [...artifact.blockers];
  const warnings = [...artifact.warnings];
  const evaluatedAtMs = Date.parse(evaluatedAt);

  if (!Number.isFinite(evaluatedAtMs)) blockers.push("Assurance evaluation time is invalid");
  if (!artifact.validationReportHash) blockers.push("Validation report digest is missing");
  if (!artifact.deterministic && artifact.seed == null) blockers.push("Stochastic model is missing a reproducibility seed");
  if (artifact.evidence.length === 0) blockers.push("No validation evidence is attached");

  for (const evidence of artifact.evidence) {
    if (!evidence.passed) blockers.push(`Validation evidence failed: ${evidence.kind}`);
    if (evidence.expiresAt && Number.isFinite(evaluatedAtMs) && Date.parse(evidence.expiresAt) <= evaluatedAtMs) {
      const message = `Validation evidence expired: ${evidence.kind} (${evidence.expiresAt})`;
      if (CRITICAL_EVIDENCE.has(evidence.kind)) blockers.push(message);
      else warnings.push(message);
    }
  }

  if (artifact.band === "institutional") {
    if (!artifact.uncertainty.quantified) blockers.push("Institutional assurance requires quantified uncertainty");
    if (!artifact.challenger.required || !artifact.challenger.passed || !artifact.challenger.artifactHash) {
      blockers.push("Institutional assurance requires a passed independent challenger artifact");
    }
    if (!artifact.inputSnapshotHash) blockers.push("Institutional assurance requires an immutable input snapshot digest");
  }

  const minimumByBand: Partial<Record<ModelAssuranceArtifact["band"], { score: number; component: number }>> = {
    institutional: { score: 93, component: 85 },
    decision_grade: { score: 84, component: 70 },
    review_required: { score: 62, component: 45 },
  };
  const declaredMinimum = minimumByBand[artifact.band];
  if (declaredMinimum) {
    const weakest = Math.min(...Object.values(artifact.components));
    if (artifact.score < declaredMinimum.score || weakest < declaredMinimum.component) {
      blockers.push(`Declared ${artifact.band} band is inconsistent with its score/component floors`);
    }
  }

  return {
    modelId: artifact.modelId,
    score: artifact.score,
    band: blockers.length > 0 ? "blocked" : artifact.band,
    components: artifact.components,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

export function evaluateAssuranceArtifactForDecision(
  artifact: ModelAssuranceArtifact | null | undefined,
  criticality: OutputCriticality,
  evaluatedAt: string,
): DecisionAssuranceGateResult {
  if (!artifact) {
    return {
      permitted: false,
      criticality,
      gateVersion: DECISION_ASSURANCE_GATE_VERSION,
      reasonCodes: ["ASSURANCE_MISSING"],
      reasons: [`${criticality} output requires an attached model assurance artifact`],
    };
  }

  const assurance = artifactToAssuranceResult(artifact, evaluatedAt);
  const result = evaluateDecisionAssurance(assurance, criticality);
  const additionalCodes: AssuranceReasonCode[] = [];
  const additionalReasons: string[] = [];

  if (assurance.blockers.some((item) => item.includes("expired"))) {
    additionalCodes.push("ASSURANCE_EVIDENCE_EXPIRED");
  }
  if (assurance.blockers.some((item) => item.includes("Validation report digest"))) {
    additionalCodes.push("ASSURANCE_VALIDATION_ARTIFACT_MISSING");
  }
  if (assurance.blockers.some((item) => item.includes("input snapshot"))) {
    additionalCodes.push("ASSURANCE_INPUT_SNAPSHOT_MISSING");
  }
  if (assurance.blockers.some((item) => item.includes("challenger"))) {
    additionalCodes.push("ASSURANCE_CHALLENGER_MISSING");
  }
  if (assurance.blockers.some((item) => item.includes("reproducibility seed"))) {
    additionalCodes.push("ASSURANCE_REPRODUCIBILITY_INVALID");
  }
  if (assurance.blockers.some((item) => item.includes("inconsistent with its score/component floors"))) {
    additionalCodes.push("ASSURANCE_INTERNAL_INCONSISTENCY");
  }

  // The public receipt schema requires integrity metadata. When present, the
  // decision gate verifies the exact artifact payload against the configured
  // Ed25519 public key. This prevents an authenticated author from promoting a
  // fabricated high-score JSON artifact to decision-grade merely by supplying
  // structurally valid hashes and labels.
  if ((artifact as ModelAssuranceArtifact & { integrity?: unknown }).integrity) {
    const verification = verifyConfiguredModelAssuranceArtifact(artifact);
    if (!verification.valid) {
      additionalCodes.push("ASSURANCE_SIGNATURE_INVALID");
      additionalReasons.push(`Assurance signature verification failed: ${verification.reason ?? "invalid signature"}`);
    }
  }

  for (const code of additionalCodes) {
    if (code !== "ASSURANCE_SIGNATURE_INVALID") {
      additionalReasons.push(`Assurance artifact integrity check failed: ${code}`);
    }
  }

  return {
    ...result,
    permitted: result.permitted && additionalCodes.length === 0,
    reasonCodes: [...new Set([...result.reasonCodes, ...additionalCodes])],
    reasons: [...result.reasons, ...additionalReasons],
  };
}

export class DecisionAssuranceError extends Error {
  readonly code = "LIOS_DECISION_ASSURANCE_REJECTED";
  readonly statusCode = 422;
  readonly gate: DecisionAssuranceGateResult;

  constructor(gate: DecisionAssuranceGateResult) {
    super(`Decision output rejected by assurance gate: ${gate.reasons.join(" | ")}`);
    this.name = "DecisionAssuranceError";
    this.gate = gate;
  }
}

export function enforceDecisionAssurance(
  assurance: ModelAssuranceResult,
  criticality: OutputCriticality,
  policy?: DecisionAssurancePolicy,
): DecisionAssuranceGateResult {
  const result = evaluateDecisionAssurance(assurance, criticality, policy);
  if (!result.permitted) throw new DecisionAssuranceError(result);
  return result;
}
