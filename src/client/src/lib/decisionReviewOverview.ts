import type { ArtifactContent } from "@shared/artifactContracts";

type Decision = Extract<ArtifactContent, { kind: "decision" }>;

export interface DecisionReviewOverview {
  recommendation: string | null;
  alternative: { label: string; id: string } | null;
  selectedAlternativeMissing: boolean;
  evidence: { refsByKind: Array<{ kind: string; count: number }>; total: number };
  risk: { uncertainties: string[]; dissent: string[]; selectedAlternativeRisks: string[]; constraints: string[] };
  action: { proposed: string[]; recorded: number; blocked: number; completed: number };
  outcome: { status: "pending" | "observed" | "inconclusive"; summary: string } | null;
  gaps: string[];
}

const present = (text: string | null | undefined) => typeof text === "string" && text.trim() !== "";

/** A local read-only index of authored Decision fields. It does not read the
 * evidence store or a P4/P11 approval receipt and must never imply proof,
 * approval, execution or that a completed action really took place. */
export function decisionReviewOverview(content: Decision): DecisionReviewOverview {
  const alternatives = content.alternatives ?? [];
  const selectedAlternativeId = content.selectedAlternativeId ?? null;
  const alternative = alternatives.find(item => item.id === selectedAlternativeId) ?? null;
  const selectedAlternativeMissing = Boolean(selectedAlternativeId && !alternative);
  const refsByKind = (["sources", "models", "scenarios", "backtests", "monitors"] as const)
    .map(kind => ({ kind, count: (content.linkedRefs?.[kind] ?? []).filter(present).length }));
  const recommendation = present(content.recommendation) ? content.recommendation!.trim() : null;
  const risks = {
    uncertainties: (content.uncertainties ?? []).filter(present),
    dissent: (content.dissent ?? []).filter(present),
    selectedAlternativeRisks: (alternative?.risks ?? []).filter(present),
    constraints: (content.constraints ?? []).filter(present),
  };
  const actions = content.actions ?? [];
  const proposed = (content.nextActions ?? []).filter(present);
  const gaps: string[] = [];
  if (!recommendation) gaps.push("No authored recommendation recorded.");
  if (!alternative) gaps.push(selectedAlternativeMissing
    ? "Selected alternative ID is unresolved in this saved draft."
    : "No alternative has been selected.");
  if (!refsByKind.some(item => item.count > 0)) gaps.push("No authored evidence references recorded; claim support has not been established.");
  if (!Object.values(risks).some(items => items.length)) gaps.push("No uncertainties, dissent, constraints or selected-alternative risks recorded.");
  if (!proposed.length && !actions.length) gaps.push("No proposed next actions or authored tracking records.");
  return {
    recommendation,
    alternative: alternative ? { label: alternative.label, id: alternative.id } : null,
    selectedAlternativeMissing,
    evidence: { refsByKind, total: refsByKind.reduce((sum, item) => sum + item.count, 0) },
    risk: risks,
    action: {
      proposed,
      recorded: actions.length,
      blocked: actions.filter(item => item.status === "blocked").length,
      completed: actions.filter(item => item.status === "completed").length,
    },
    outcome: content.outcome ? { status: content.outcome.status, summary: content.outcome.summary } : null,
    gaps,
  };
}
