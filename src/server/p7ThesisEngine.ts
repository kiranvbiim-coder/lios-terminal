import type { ArtifactContent } from "@shared/artifactContracts";
import type { P7Delta, P7ProjectDocument, P7ProjectSnapshot } from "@shared/p7ResearchContracts";

type Thesis = Extract<ArtifactContent, { kind: "thesis" }>;

type ThesisSignal = {
  type: "supports" | "contradicts" | "outcome_occurred" | "outcome_missed" | "catalyst_occurred" | "risk_materialized" | "invalidation_triggered" | "question_answered";
  targetId: string;
  note?: string;
};

function signalsFor(doc: P7ProjectDocument): ThesisSignal[] {
  const raw = Array.isArray(doc.metadata.thesisSignals) ? doc.metadata.thesisSignals : [];
  return raw.flatMap((value): ThesisSignal[] => {
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    const type = typeof row.type === "string" ? row.type : "";
    const targetId = typeof row.targetId === "string" ? row.targetId : "";
    const allowed = new Set(["supports","contradicts","outcome_occurred","outcome_missed","catalyst_occurred","risk_materialized","invalidation_triggered","question_answered"]);
    if (!allowed.has(type) || !targetId) return [];
    return [{ type: type as ThesisSignal["type"], targetId, note: typeof row.note === "string" ? row.note : undefined }];
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export type ThesisConvictionPosture = "unrated" | "strengthening" | "mixed" | "weakening" | "invalidated";

export type ThesisCounterThesisReview = {
  posture: ThesisConvictionPosture;
  baseCase: Array<{ claimId: string; text: string; evidenceRefs: string[] }>;
  counterCase: Array<{ claimId: string; text: string; evidenceRefs: string[]; status: "contradicted" | "invalidated" }>;
  unresolved: Array<{ claimId: string; text: string }>;
  invalidationRefs: string[];
  summary: string;
};

export function buildThesisCounterThesisReview(thesis: Thesis): ThesisCounterThesisReview {
  const baseCase = thesis.claims
    .filter((claim) => claim.evidenceRefs.length > 0)
    .map((claim) => ({
      claimId: claim.id,
      text: claim.text,
      evidenceRefs: unique(claim.evidenceRefs),
    }));
  const counterCase = thesis.claims
    .filter((claim) => claim.counterEvidenceRefs.length > 0 || claim.status === "invalidated")
    .map((claim) => ({
      claimId: claim.id,
      text: claim.text,
      evidenceRefs: unique(claim.counterEvidenceRefs),
      status: (claim.status === "invalidated" ? "invalidated" : "contradicted") as "contradicted" | "invalidated",
    }));
  const unresolved = thesis.claims
    .filter((claim) => claim.evidenceRefs.length === 0 && claim.counterEvidenceRefs.length === 0 && claim.status === "open")
    .map((claim) => ({ claimId: claim.id, text: claim.text }));
  const invalidationRefs = unique(thesis.invalidationConditions
    .filter((item) => item.triggered)
    .flatMap((item) => item.evidenceRefs));
  const invalidated = thesis.status === "invalidated"
    || thesis.claims.some((claim) => claim.status === "invalidated")
    || thesis.invalidationConditions.some((item) => item.triggered);

  const posture: ThesisConvictionPosture = invalidated
    ? "invalidated"
    : baseCase.length && counterCase.length
      ? "mixed"
      : baseCase.length
        ? "strengthening"
        : counterCase.length
          ? "weakening"
          : "unrated";

  const summary = posture === "invalidated"
    ? `Thesis invalidated by explicit invalidation state; ${baseCase.length} base-case claim(s), ${counterCase.length} counter-thesis claim(s), ${unresolved.length} unresolved claim(s).`
    : `Thesis posture ${posture}: ${baseCase.length} base-case claim(s), ${counterCase.length} counter-thesis claim(s), ${unresolved.length} unresolved claim(s).`;

  return { posture, baseCase, counterCase, unresolved, invalidationRefs, summary };
}

export function refreshThesisArtifact(input: {
  thesis: Thesis;
  documents: P7ProjectDocument[];
  snapshot: P7ProjectSnapshot;
  delta?: P7Delta | null;
  refreshedAt?: string;
}): { thesis: Thesis; changes: string[]; contradictions: string[]; review: ThesisCounterThesisReview } {
  const refreshedAt = input.refreshedAt ?? new Date().toISOString();
  const changes: string[] = [];
  const beforeReview = buildThesisCounterThesisReview(input.thesis);
  const contradictions: string[] = [];
  const docsBySignal = new Map<string, Array<{ doc: P7ProjectDocument; signal: ThesisSignal }>>();
  for (const doc of input.documents) {
    for (const signal of signalsFor(doc)) {
      const key = signal.type + ":" + signal.targetId;
      const list = docsBySignal.get(key) ?? [];
      list.push({ doc, signal });
      docsBySignal.set(key, list);
    }
  }

  const claims = input.thesis.claims.map((claim) => {
    const supports = docsBySignal.get("supports:" + claim.id) ?? [];
    const counters = docsBySignal.get("contradicts:" + claim.id) ?? [];
    const evidenceRefs = unique([...claim.evidenceRefs, ...supports.map(({ doc }) => doc.sourceRef)]);
    const counterEvidenceRefs = unique([...claim.counterEvidenceRefs, ...counters.map(({ doc }) => doc.sourceRef)]);
    const nextStatus = claim.status === "invalidated" ? "invalidated" : counterEvidenceRefs.length ? "contradicted" : evidenceRefs.length ? "supported" : "open";
    if (nextStatus !== claim.status) changes.push("Claim \"" + claim.text + "\" changed " + claim.status + " → " + nextStatus + ".");
    if (counterEvidenceRefs.length) {
      const notes = counters.map(({ signal, doc }) => signal.note || doc.title);
      contradictions.push("Claim \"" + claim.text + "\" has counter-evidence: " + notes.join("; "));
    }
    return { ...claim, status: nextStatus as typeof claim.status, evidenceRefs, counterEvidenceRefs, updatedAt: refreshedAt };
  });

  const expectedOutcomes = input.thesis.expectedOutcomes.map((item) => {
    const occurred = docsBySignal.get("outcome_occurred:" + item.id) ?? [];
    const missed = docsBySignal.get("outcome_missed:" + item.id) ?? [];
    const evidenceRefs = unique([
      ...item.evidenceRefs,
      ...occurred.map(({ doc }) => doc.sourceRef),
      ...missed.map(({ doc }) => doc.sourceRef),
    ]);
    const status = missed.length ? "missed" as const : occurred.length ? "occurred" as const : item.status;
    if (status !== item.status) changes.push("Expected outcome \"" + item.text + "\" changed " + item.status + " → " + status + ".");
    return { ...item, status, evidenceRefs };
  });

  const catalysts = input.thesis.catalysts.map((item) => {
    const hits = docsBySignal.get("catalyst_occurred:" + item.id) ?? [];
    const evidenceRefs = unique([...item.evidenceRefs, ...hits.map(({ doc }) => doc.sourceRef)]);
    const status = hits.length ? "occurred" as const : item.status;
    if (status !== item.status) changes.push("Catalyst \"" + item.text + "\" changed " + item.status + " → " + status + ".");
    return { ...item, status, evidenceRefs };
  });

  const risks = input.thesis.risks.map((item) => {
    const hits = docsBySignal.get("risk_materialized:" + item.id) ?? [];
    const evidenceRefs = unique([...item.evidenceRefs, ...hits.map(({ doc }) => doc.sourceRef)]);
    const status = hits.length ? "materialized" as const : item.status;
    if (status !== item.status) changes.push("Risk \"" + item.text + "\" changed " + item.status + " → " + status + ".");
    return { ...item, status, evidenceRefs };
  });

  const invalidationConditions = input.thesis.invalidationConditions.map((item) => {
    const hits = docsBySignal.get("invalidation_triggered:" + item.id) ?? [];
    const evidenceRefs = unique([...item.evidenceRefs, ...hits.map(({ doc }) => doc.sourceRef)]);
    const triggered = item.triggered || hits.length > 0;
    if (triggered && !item.triggered) changes.push("Invalidation condition triggered: \"" + item.text + "\".");
    return { ...item, triggered, evidenceRefs };
  });

  const openQuestions = input.thesis.openQuestions.map((item) => {
    const hits = docsBySignal.get("question_answered:" + item.id) ?? [];
    const evidenceRefs = unique([...item.evidenceRefs, ...hits.map(({ doc }) => doc.sourceRef)]);
    const status = hits.length ? "answered" as const : item.status;
    if (status !== item.status) changes.push("Question answered: \"" + item.text + "\".");
    return { ...item, status, evidenceRefs };
  });

  if (input.delta) {
    if (input.delta.added.length) changes.push(input.delta.added.length + " new indexed source(s) since the previous snapshot.");
    if (input.delta.changed.length) changes.push(input.delta.changed.length + " indexed source(s) changed since the previous snapshot.");
    if (input.delta.removed.length) changes.push(input.delta.removed.length + " indexed source(s) disappeared from the current Project index.");
  }

  const status = invalidationConditions.some((item) => item.triggered) || claims.some((claim) => claim.status === "invalidated")
    ? "invalidated" as const
    : input.thesis.status;

  const nextThesis: Thesis = {
    ...input.thesis,
    status,
    expectedOutcomes,
    claims,
    catalysts,
    risks,
    invalidationConditions,
    openQuestions,
    refresh: {
      lastRefreshedAt: refreshedAt,
      snapshotId: input.snapshot.id,
      contradictions,
      changes,
    },
  };
  const review = buildThesisCounterThesisReview(nextThesis);
  if (review.posture !== beforeReview.posture) {
    changes.push(`Thesis/counter-thesis posture changed ${beforeReview.posture} → ${review.posture}: ${review.baseCase.length} base-case, ${review.counterCase.length} counter-thesis, ${review.unresolved.length} unresolved claim(s).`);
    nextThesis.refresh.changes = changes;
  }

  return {
    thesis: nextThesis,
    changes,
    contradictions,
    review,
  };
}

export function appendThesisPostmortem(input: {
  thesis: Thesis;
  outcome: "validated" | "partially_validated" | "invalidated" | "closed";
  summary: string;
  whatWorked?: string[];
  whatFailed?: string[];
  evidenceRefs?: string[];
  at?: string;
}): Thesis {
  const summary = input.summary.trim();
  if (!summary) throw new Error("Thesis postmortem summary is required.");
  const at = input.at ?? new Date().toISOString();
  return {
    ...input.thesis,
    status: input.outcome === "invalidated" ? "invalidated" : input.outcome === "closed" ? "closed" : input.thesis.status,
    postmortems: [
      ...input.thesis.postmortems,
      {
        at,
        outcome: input.outcome,
        summary,
        whatWorked: unique(input.whatWorked ?? []),
        whatFailed: unique(input.whatFailed ?? []),
        evidenceRefs: unique(input.evidenceRefs ?? []),
      },
    ],
  };
}
