import type { ArtifactContent } from "@shared/artifactContracts";
import { buildThesisCounterThesisReview, type ThesisConvictionPosture } from "./p7ThesisEngine";

type Thesis = Extract<ArtifactContent, { kind: "thesis" }>;

export type LivingThesisVersion = {
  artifactId: string;
  version: number;
  contentHash: string;
  assumptionRefs: string[];
  content: Thesis;
};

export type LivingThesisItemChange = {
  id: string;
  change: "added" | "removed" | "changed";
  fields: string[];
};

export type LivingThesisReview = {
  current: {
    artifactRef: string;
    version: number;
    contentHash: string;
    status: Thesis["status"];
    summary: string;
    posture: ThesisConvictionPosture;
    assumptions: string[];
    claims: Thesis["claims"];
    expectedOutcomes: Thesis["expectedOutcomes"];
    catalysts: Thesis["catalysts"];
    risks: Thesis["risks"];
    invalidationConditions: Thesis["invalidationConditions"];
    openQuestions: Thesis["openQuestions"];
  };
  previous: {
    artifactRef: string;
    version: number;
    contentHash: string;
    status: Thesis["status"];
    posture: ThesisConvictionPosture;
  } | null;
  changedSinceLastReview: {
    baseline: boolean;
    changed: boolean;
    status: { from: Thesis["status"]; to: Thesis["status"] } | null;
    posture: { from: ThesisConvictionPosture; to: ThesisConvictionPosture } | null;
    assumptions: { added: string[]; removed: string[] };
    claims: LivingThesisItemChange[];
    expectedOutcomes: LivingThesisItemChange[];
    catalysts: LivingThesisItemChange[];
    risks: LivingThesisItemChange[];
    invalidationConditions: LivingThesisItemChange[];
    openQuestions: LivingThesisItemChange[];
  };
};

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function sameArray(left: readonly string[], right: readonly string[]): boolean {
  const a = uniqueSorted(left);
  const b = uniqueSorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function itemChanges<T extends { id: string }>(
  current: readonly T[],
  previous: readonly T[],
  fields: Array<{ name: string; value: (item: T) => unknown; array?: boolean }>,
): LivingThesisItemChange[] {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const previousById = new Map(previous.map((item) => [item.id, item]));
  const ids = [...new Set([...currentById.keys(), ...previousById.keys()])].sort((a, b) => a.localeCompare(b));
  return ids.flatMap((id): LivingThesisItemChange[] => {
    const now = currentById.get(id);
    const before = previousById.get(id);
    if (!before && now) return [{ id, change: "added", fields: fields.map((field) => field.name) }];
    if (before && !now) return [{ id, change: "removed", fields: fields.map((field) => field.name) }];
    if (!before || !now) return [];
    const changed = fields.filter((field) => {
      const left = field.value(before);
      const right = field.value(now);
      if (field.array) return !sameArray((left as string[]) ?? [], (right as string[]) ?? []);
      return JSON.stringify(left) !== JSON.stringify(right);
    }).map((field) => field.name);
    return changed.length ? [{ id, change: "changed", fields: changed }] : [];
  });
}

export function buildLivingThesisReview(input: {
  current: LivingThesisVersion;
  previous?: LivingThesisVersion | null;
}): LivingThesisReview {
  const currentReview = buildThesisCounterThesisReview(input.current.content);
  const previous = input.previous ?? null;
  const previousReview = previous ? buildThesisCounterThesisReview(previous.content) : null;

  const assumptions = uniqueSorted(input.current.assumptionRefs);
  const previousAssumptions = uniqueSorted(previous?.assumptionRefs ?? []);
  const changes = previous ? {
    baseline: false,
    changed: false,
    status: previous.content.status !== input.current.content.status
      ? { from: previous.content.status, to: input.current.content.status }
      : null,
    posture: previousReview && previousReview.posture !== currentReview.posture
      ? { from: previousReview.posture, to: currentReview.posture }
      : null,
    assumptions: {
      added: assumptions.filter((ref) => !previousAssumptions.includes(ref)),
      removed: previousAssumptions.filter((ref) => !assumptions.includes(ref)),
    },
    claims: itemChanges(input.current.content.claims, previous.content.claims, [
      { name: "text", value: (item) => item.text },
      { name: "status", value: (item) => item.status },
      { name: "confidence", value: (item) => item.confidence },
      { name: "evidenceRefs", value: (item) => item.evidenceRefs, array: true },
      { name: "counterEvidenceRefs", value: (item) => item.counterEvidenceRefs, array: true },
    ]),
    expectedOutcomes: itemChanges(input.current.content.expectedOutcomes, previous.content.expectedOutcomes, [
      { name: "text", value: (item) => item.text },
      { name: "status", value: (item) => item.status },
      { name: "dueAt", value: (item) => item.dueAt },
      { name: "evidenceRefs", value: (item) => item.evidenceRefs, array: true },
    ]),
    catalysts: itemChanges(input.current.content.catalysts, previous.content.catalysts, [
      { name: "text", value: (item) => item.text },
      { name: "status", value: (item) => item.status },
      { name: "dueAt", value: (item) => item.dueAt },
      { name: "evidenceRefs", value: (item) => item.evidenceRefs, array: true },
    ]),
    risks: itemChanges(input.current.content.risks, previous.content.risks, [
      { name: "text", value: (item) => item.text },
      { name: "status", value: (item) => item.status },
      { name: "evidenceRefs", value: (item) => item.evidenceRefs, array: true },
    ]),
    invalidationConditions: itemChanges(input.current.content.invalidationConditions, previous.content.invalidationConditions, [
      { name: "text", value: (item) => item.text },
      { name: "triggered", value: (item) => item.triggered },
      { name: "evidenceRefs", value: (item) => item.evidenceRefs, array: true },
    ]),
    openQuestions: itemChanges(input.current.content.openQuestions, previous.content.openQuestions, [
      { name: "text", value: (item) => item.text },
      { name: "status", value: (item) => item.status },
      { name: "evidenceRefs", value: (item) => item.evidenceRefs, array: true },
    ]),
  } : {
    baseline: true,
    changed: false,
    status: null,
    posture: null,
    assumptions: { added: [], removed: [] },
    claims: [],
    expectedOutcomes: [],
    catalysts: [],
    risks: [],
    invalidationConditions: [],
    openQuestions: [],
  };
  changes.changed = Boolean(
    changes.status || changes.posture || changes.assumptions.added.length || changes.assumptions.removed.length
    || changes.claims.length || changes.expectedOutcomes.length || changes.catalysts.length
    || changes.risks.length || changes.invalidationConditions.length || changes.openQuestions.length
  );

  return {
    current: {
      artifactRef: `${input.current.artifactId}@v${input.current.version}`,
      version: input.current.version,
      contentHash: input.current.contentHash,
      status: input.current.content.status,
      summary: input.current.content.summary,
      posture: currentReview.posture,
      assumptions,
      claims: input.current.content.claims,
      expectedOutcomes: input.current.content.expectedOutcomes,
      catalysts: input.current.content.catalysts,
      risks: input.current.content.risks,
      invalidationConditions: input.current.content.invalidationConditions,
      openQuestions: input.current.content.openQuestions,
    },
    previous: previous && previousReview ? {
      artifactRef: `${previous.artifactId}@v${previous.version}`,
      version: previous.version,
      contentHash: previous.contentHash,
      status: previous.content.status,
      posture: previousReview.posture,
    } : null,
    changedSinceLastReview: changes,
  };
}
