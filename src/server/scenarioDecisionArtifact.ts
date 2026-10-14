import type { ScenarioActionInput, ScenarioActionResult } from "./scenarioActionEngine";
import { calculateScenarioActionCandidates } from "./scenarioActionEngine";
import { decisionSnapshotHash } from "./decisionEngine";

const DEFAULT_ACTION_ALTERNATIVES = ["hold", "reduce", "increase", "hedge", "defer"] as const;

/**
 * A scenario result is a recommendation candidate until a reviewer approves the
 * receipt version which contains it. Keeping that distinction in the persisted
 * JSON prevents a candidate from being mistaken for an executed order.
 */
export interface ScenarioDecisionArtifact {
  kind: "scenario_action_artifact";
  schemaVersion: 1;
  candidateStatus: "candidate";
  approvalRequired: true;
  approvedDecision: null;
  modelVersion: string;
  modelHash: string;
  scenarioInputs: ScenarioActionInput;
  actionAlternatives: ScenarioActionInput["actionAlternatives"];
  constraints: ScenarioActionInput["constraints"];
  candidateRanking: ScenarioActionResult["candidates"];
  recommendedAction: string | null;
  requiredEvidence: ScenarioActionResult["candidates"][number]["requiredEvidence"];
  sourceMetadata: ScenarioActionResult["source"];
  candidateHash: string;
}

export interface ScenarioDecisionArtifactInput {
  scenarioInputs: ScenarioActionInput;
  modelVersion?: string;
  modelHash?: string;
}

export interface ScenarioDecisionActor {
  id: number;
  role: string;
  organizationId: number | null;
}

export interface ScenarioDecisionOwner {
  ownerUserId: number;
  organizationId: number | null;
}

export function scenarioDecisionAccessError(actor: ScenarioDecisionActor, decision: ScenarioDecisionOwner): string | null {
  if (decision.organizationId !== null && actor.organizationId !== decision.organizationId) {
    return "Decision belongs to another organization.";
  }
  if (actor.role !== "internal_admin" && decision.ownerUserId !== actor.id) {
    return "Only the decision owner or an internal administrator can attach scenario candidates.";
  }
  return null;
}

/** Build the exact deterministic artifact that is stored in a receipt calculation. */
export function buildScenarioDecisionArtifact(input: ScenarioDecisionArtifactInput): {
  artifact: ScenarioDecisionArtifact;
  result: ScenarioActionResult;
} {
  const modelVersion = input.modelVersion?.trim() || "scenario-action-engine-v1";
  const result = calculateScenarioActionCandidates(input.scenarioInputs);
  const modelHash = input.modelHash?.trim() || decisionSnapshotHash({
    engine: "scenarioActionEngine",
    modelVersion,
  });
  const hashPayload = {
    schemaVersion: 1 as const,
    candidateStatus: "candidate" as const,
    approvalRequired: true as const,
    approvedDecision: null,
    modelVersion,
    modelHash,
    scenarioInputs: input.scenarioInputs,
    actionAlternatives: input.scenarioInputs.actionAlternatives ?? input.scenarioInputs.actions ?? [...DEFAULT_ACTION_ALTERNATIVES],
    constraints: input.scenarioInputs.constraints ?? {},
    candidateRanking: result.candidates,
    recommendedAction: result.recommendedAction,
    requiredEvidence: result.candidates.flatMap((candidate) => candidate.requiredEvidence),
    sourceMetadata: result.source,
  };
  const artifact: ScenarioDecisionArtifact = {
    kind: "scenario_action_artifact",
    schemaVersion: 1,
    candidateStatus: "candidate",
    approvalRequired: true,
    approvedDecision: null,
    modelVersion,
    modelHash,
    scenarioInputs: input.scenarioInputs,
    actionAlternatives: hashPayload.actionAlternatives,
    constraints: hashPayload.constraints,
    candidateRanking: hashPayload.candidateRanking,
    recommendedAction: hashPayload.recommendedAction,
    requiredEvidence: hashPayload.requiredEvidence,
    sourceMetadata: hashPayload.sourceMetadata,
    candidateHash: decisionSnapshotHash(hashPayload),
  };
  return { artifact, result };
}

export function scenarioArtifactCalculation(artifact: ScenarioDecisionArtifact): Record<string, unknown> {
  return {
    name: "Scenario action candidates",
    value: artifact.recommendedAction ?? "No feasible candidate",
    deterministicRef: `scenario-action:${artifact.candidateHash}`,
    modelVersion: artifact.modelVersion,
    kind: artifact.kind,
    candidateHash: artifact.candidateHash,
    scenarioActionArtifact: artifact,
  };
}

export function scenarioArtifactFromCalculations(
  calculations: unknown,
): ScenarioDecisionArtifact | null {
  if (!Array.isArray(calculations)) return null;
  for (const item of calculations) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const artifact = record.scenarioActionArtifact;
    if (!artifact || typeof artifact !== "object") continue;
    const candidate = artifact as Partial<ScenarioDecisionArtifact>;
    if (candidate.kind === "scenario_action_artifact" && candidate.schemaVersion === 1 && typeof candidate.candidateHash === "string") {
      return candidate as ScenarioDecisionArtifact;
    }
  }
  return null;
}

export interface ScenarioPipelineCalculation {
  name: "Scenario-to-action pipeline";
  deterministicRef: string;
  modelVersion: string;
  value: number;
  scenarioPipelineArtifact: Record<string, unknown> & {
    schemaVersion: 1;
    traceHash: string;
  };
}

export interface ValidatedScenarioPipelineCalculation {
  calculation: ScenarioPipelineCalculation;
  traceHash: string;
}

/**
 * Normalize the preview response (or its receipt calculation) and verify that
 * the trace has not been altered since the pipeline produced it.
 */
export function validateScenarioPipelineCalculation(input: unknown): ValidatedScenarioPipelineCalculation | null {
  if (!input || typeof input !== "object") return null;
  const envelope = input as Record<string, unknown>;
  const candidateValue = envelope.receiptCalculation && typeof envelope.receiptCalculation === "object"
    ? envelope.receiptCalculation
    : envelope;
  if (!candidateValue || typeof candidateValue !== "object") return null;
  const candidate = candidateValue as Record<string, unknown>;
  const artifactValue = candidate.scenarioPipelineArtifact ?? envelope.scenarioPipelineArtifact ?? envelope.trace;
  if (!artifactValue || typeof artifactValue !== "object" || Array.isArray(artifactValue)) return null;
  const artifact = artifactValue as Record<string, unknown>;
  if (artifact.schemaVersion !== 1 || typeof artifact.traceHash !== "string" || !/^[a-f0-9]{64}$/.test(artifact.traceHash)) return null;
  const deterministicRef = candidate.deterministicRef;
  if (typeof deterministicRef !== "string" || deterministicRef !== `scenario-pipeline:${artifact.traceHash}`) return null;
  const name = candidate.name ?? "Scenario-to-action pipeline";
  if (name !== "Scenario-to-action pipeline") return null;
  const modelVersion = candidate.modelVersion ?? "scenario-pipeline-v1";
  if (typeof modelVersion !== "string" || !modelVersion.trim()) return null;
  let value: number | null = typeof candidate.value === "number" && Number.isFinite(candidate.value) ? candidate.value : null;
  if (value === null) {
    const valuation = artifact.valuation;
    const delta = valuation && typeof valuation === "object" && !Array.isArray(valuation)
      ? (valuation as Record<string, unknown>).delta
      : undefined;
    if (typeof delta !== "number" || !Number.isFinite(delta)) return null;
    value = delta;
  }
  if (value === null) return null;
  const { traceHash: _traceHash, ...traceWithoutHash } = artifact;
  if (decisionSnapshotHash(traceWithoutHash) !== artifact.traceHash) return null;
  const envelopeTrace = envelope.trace;
  if (envelopeTrace && typeof envelopeTrace === "object" && !Array.isArray(envelopeTrace)) {
    const envelopeTraceRecord = envelopeTrace as Record<string, unknown>;
    if (envelopeTraceRecord.traceHash !== artifact.traceHash) return null;
  }
  const calculation: ScenarioPipelineCalculation = {
    name: "Scenario-to-action pipeline",
    deterministicRef,
    modelVersion,
    value,
    scenarioPipelineArtifact: artifact as ScenarioPipelineCalculation["scenarioPipelineArtifact"],
  };
  return { calculation, traceHash: artifact.traceHash };
}

export function scenarioPipelineCalculationFromCalculations(
  calculations: unknown,
  traceHash: string,
): ScenarioPipelineCalculation | null {
  if (!Array.isArray(calculations)) return null;
  for (const calculation of calculations) {
    const validated = validateScenarioPipelineCalculation(calculation);
    if (validated?.traceHash === traceHash) return validated.calculation;
  }
  return null;
}