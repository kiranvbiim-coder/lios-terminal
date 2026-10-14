import assert from "node:assert/strict";
import test from "node:test";
import { p7ProjectDocumentSchema, type P7SourceType } from "@shared/p7ResearchContracts";
import { p7DocumentId, p7Hash } from "./p7ProjectIntelligence";
import { buildP7TimelineIntelligence } from "./p7TimelineIntelligence";

function doc(input: {
  sourceRef: string;
  occurredAt: string;
  sourceType?: P7SourceType;
  title?: string;
  body?: string;
  metadata?: Record<string, unknown>;
  sourceRefs?: string[];
  entityRefs?: string[];
}) {
  const sourceType = input.sourceType ?? "research_evidence";
  const title = input.title ?? input.sourceRef;
  const body = input.body ?? title;
  return p7ProjectDocumentSchema.parse({
    schemaVersion: "1",
    id: p7DocumentId(1, sourceType, input.sourceRef),
    projectId: 1,
    sourceType,
    sourceRef: input.sourceRef,
    title,
    body,
    contentHash: p7Hash({ title, body }),
    occurredAt: input.occurredAt,
    sourceRefs: input.sourceRefs ?? [],
    entityRefs: input.entityRefs ?? [],
    metadata: input.metadata ?? {},
    embedding: null,
  });
}

test("SI-03.18 classifies only explicit canonical timeline evidence and preserves lineage", () => {
  const timeline = buildP7TimelineIntelligence([
    doc({ sourceRef: "filing:10-k:2026", sourceType: "filing", occurredAt: "2026-10-01T10:00:00.000Z", title: "2026 10-K", sourceRefs: ["sec:accession:1"], entityRefs: ["entity:acme"] }),
    doc({ sourceRef: "ledger:decision", sourceType: "ledger_event", occurredAt: "2026-10-02T10:00:00.000Z", title: "decision.recorded", metadata: { eventType: "decision.recorded", decisionRef: "decision:42" } }),
    doc({ sourceRef: "evidence:transaction", occurredAt: "2026-10-03T10:00:00.000Z", title: "Confirmed transaction", metadata: { timelineEventType: "transaction", transactionRef: "transaction:acme-target", instrumentRefs: ["instrument:ACME"] } }),
    doc({ sourceRef: "ledger:state-change", sourceType: "ledger_event", occurredAt: "2026-10-04T10:00:00.000Z", title: "state.changed", metadata: { eventType: "state.changed", effectiveAt: "2026-10-04T09:00:00.000Z", relations: [{ type: "supersedes", targetRef: "state:prior" }] } }),
    doc({ sourceRef: "artifact:model@v2:event:1", sourceType: "artifact", occurredAt: "2026-10-05T10:00:00.000Z", title: "Model changed", metadata: { timelineEventType: "model_change", artifactId: "artifact:model", artifactKind: "valuation", modelRef: "model:acme", relations: [{ type: "changes", targetRef: "artifact:model@v1" }] } }),
    doc({ sourceRef: "resource:rumor", sourceType: "resource", occurredAt: "2026-10-06T10:00:00.000Z", title: "Commentary", body: "The note says ACME bought a target, but carries no structured transaction metadata." }),
  ]);

  assert.deepEqual(timeline.events.map((event) => event.kind), ["event", "change", "change", "transaction", "decision", "filing"]);
  assert.deepEqual(timeline.counts, { event: 1, change: 2, transaction: 1, decision: 1, filing: 1 });

  const transaction = timeline.events.find((event) => event.kind === "transaction");
  assert.equal(transaction?.transactionRef, "transaction:acme-target");
  assert.deepEqual(transaction?.instrumentRefs, ["instrument:ACME"]);

  const stateChange = timeline.events.find((event) => event.sourceRef === "ledger:state-change");
  assert.equal(stateChange?.effectiveAt, "2026-10-04T09:00:00.000Z");
  assert.deepEqual(stateChange?.changeLinks, [{ relation: "supersedes", targetRef: "state:prior" }]);

  const modelChange = timeline.events.find((event) => event.sourceRef === "artifact:model@v2:event:1");
  assert.deepEqual(modelChange?.artifactRefs, ["artifact:model"]);
  assert.ok(modelChange?.modelRefs.includes("model:acme"));
  assert.ok(modelChange?.modelRefs.includes("artifact:model"));
  assert.deepEqual(modelChange?.changeLinks, [{ relation: "changes", targetRef: "artifact:model@v1" }]);

  const generic = timeline.events.find((event) => event.sourceRef === "resource:rumor");
  assert.equal(generic?.kind, "event", "transaction semantics must never be inferred from prose");
  assert.equal(generic?.transactionRef, null);
  assert.equal(timeline.truncation.truncated, false);
});

test("SI-03.18 change and transaction semantics fail closed when structured evidence is absent", () => {
  const timeline = buildP7TimelineIntelligence([
    doc({ sourceRef: "ledger:generic", sourceType: "ledger_event", occurredAt: "2026-10-02T00:00:00.000Z", title: "execution.receipt", body: "Transaction completed and state changed.", metadata: { eventType: "execution.receipt" } }),
    doc({ sourceRef: "artifact:note", sourceType: "artifact", occurredAt: "2026-10-01T00:00:00.000Z", title: "Revision commentary", metadata: { timelineEventType: "note" } }),
  ]);
  assert.ok(timeline.events.every((event) => event.kind === "event"));
  assert.ok(timeline.events.every((event) => event.changeLinks.length === 0));
});

test("SI-03.18 bounded projection makes omitted timeline evidence explicit", () => {
  const documents = Array.from({ length: 5 }, (_, index) => doc({ sourceRef: `doc:${index}`, occurredAt: `2026-10-0${index + 1}T00:00:00.000Z` }));
  const timeline = buildP7TimelineIntelligence(documents, { maxEvents: 2 });
  assert.equal(timeline.events.length, 2);
  assert.equal(timeline.truncation.truncated, true);
  assert.equal(timeline.truncation.omittedEvents, 3);
  assert.deepEqual(timeline.events.map((event) => event.sourceRef), ["doc:4", "doc:3"]);
});
