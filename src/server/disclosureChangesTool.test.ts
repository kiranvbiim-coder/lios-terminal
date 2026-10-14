import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { p7ProjectDocumentSchema, type P7ProjectDocument } from "@shared/p7ResearchContracts";
import { p7DocumentId, p7Hash } from "./p7ProjectIntelligence";
import { buildDisclosureChangeIntelligence, disclosureChangesTool, type DisclosureKind } from "./disclosureChangesTool";

function parent(input: {
  projectId?: number;
  sourceRef: string;
  title?: string;
  body: string;
  kind: "filing" | "transcript" | "presentation" | "disclosure";
  occurredAt?: string | null;
  entityRefs?: string[];
  series?: string | null;
  materiality?: "material" | "not_material";
  publishedAt?: string | null;
  effectiveAt?: string | null;
}): P7ProjectDocument {
  const projectId = input.projectId ?? 1;
  return p7ProjectDocumentSchema.parse({
    schemaVersion: "1",
    id: p7DocumentId(projectId, input.kind === "filing" ? "filing" : "document", input.sourceRef),
    projectId,
    sourceType: input.kind === "filing" ? "filing" : "document",
    sourceRef: input.sourceRef,
    title: input.title ?? input.sourceRef,
    body: input.body,
    contentHash: p7Hash(input.body),
    occurredAt: input.occurredAt ?? null,
    sourceRefs: [],
    entityRefs: input.entityRefs ?? [],
    metadata: {
      ...(input.kind === "filing" ? {} : { disclosureKind: input.kind }),
      ...(input.series ? { disclosureSeries: input.series } : {}),
      ...(input.materiality ? { materiality: input.materiality } : {}),
      ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}),
      ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
    },
  });
}

function section(parentDoc: P7ProjectDocument, title: string, text: string, input: {
  materiality?: "material" | "not_material";
  startLine?: number;
} = {}): P7ProjectDocument {
  const sourceRef = parentDoc.sourceRef + "#section:" + p7Hash(title.toLowerCase()).slice(0, 12);
  return p7ProjectDocumentSchema.parse({
    schemaVersion: "1",
    id: p7DocumentId(parentDoc.projectId, "document", sourceRef),
    projectId: parentDoc.projectId,
    sourceType: "document",
    sourceRef,
    title: parentDoc.title + " · " + title,
    body: text,
    contentHash: p7Hash(text),
    occurredAt: parentDoc.occurredAt,
    sourceRefs: [parentDoc.sourceRef],
    entityRefs: parentDoc.entityRefs,
    metadata: {
      structureKind: "section",
      parentSourceRef: parentDoc.sourceRef,
      sectionTitle: title,
      startLine: input.startLine ?? 1,
      ...(input.materiality ? { materiality: input.materiality } : {}),
    },
  });
}

test("SI-03.28 prefers canonical section children, preserves declared materiality/clocks, and bounds permitted history", () => {
  const prior = parent({
    sourceRef: "filing:2026-q1",
    title: "Q1 filing",
    body: "PARENT PRIOR BODY MUST NOT DRIVE STRUCTURED DIFF",
    kind: "filing",
    occurredAt: "2026-04-30T12:00:00Z",
    publishedAt: "2026-04-30T10:00:00Z",
    effectiveAt: "2026-03-31T23:59:59Z",
    entityRefs: ["entity:acme"],
    series: "acme-quarterly",
  });
  const current = parent({
    sourceRef: "presentation:2026-q2",
    title: "Q2 IR presentation",
    body: "PARENT CURRENT BODY MUST NOT DRIVE STRUCTURED DIFF",
    kind: "presentation",
    occurredAt: "2026-07-31T12:00:00Z",
    publishedAt: "2026-07-31T10:00:00Z",
    effectiveAt: "2026-06-30T23:59:59Z",
    entityRefs: ["entity:acme"],
    series: "acme-quarterly",
  });
  const oldHistory = parent({
    sourceRef: "filing:2025-q4", body: "older", kind: "filing",
    occurredAt: "2026-02-01T00:00:00Z", entityRefs: ["entity:acme"], series: "acme-quarterly",
  });
  const permittedHistory = parent({
    sourceRef: "transcript:2026-q1", body: "call", kind: "transcript",
    occurredAt: "2026-05-01T00:00:00Z", entityRefs: ["entity:acme"], series: "acme-quarterly",
  });
  const hiddenHistory = parent({
    sourceRef: "disclosure:hidden", body: "hidden", kind: "disclosure",
    occurredAt: "2026-06-01T00:00:00Z", entityRefs: ["entity:acme"], series: "acme-quarterly",
  });
  const unrelated = parent({
    sourceRef: "filing:other", body: "other", kind: "filing",
    occurredAt: "2026-01-01T00:00:00Z", entityRefs: ["entity:other"], series: "other-series",
  });

  const documents = [
    prior,
    current,
    oldHistory,
    permittedHistory,
    hiddenHistory,
    unrelated,
    section(prior, "Overview", "Revenue grew.", { startLine: 1 }),
    section(prior, "Risk factors", "Legacy risk wording.", { materiality: "not_material", startLine: 5 }),
    section(prior, "Removed disclosure", "This was present.", { materiality: "not_material", startLine: 9 }),
    section(current, "Overview", "Revenue grew.", { startLine: 1 }),
    section(current, "Risk factors", "Updated source-declared material risk wording.", { materiality: "material", startLine: 5 }),
    section(current, "New disclosure", "New wording.", { startLine: 9 }),
  ];

  const result = buildDisclosureChangeIntelligence(documents, {
    priorSourceRef: prior.sourceRef,
    currentSourceRef: current.sourceRef,
    allowedSourceRefs: [prior.sourceRef, current.sourceRef, oldHistory.sourceRef, permittedHistory.sourceRef],
    historyLimit: 10,
  });

  assert.equal(result.prior.sectionMode, "structured_sections");
  assert.equal(result.current.sectionMode, "structured_sections");
  assert.equal(result.prior.truth.temporal.publishedAt, "2026-04-30T10:00:00Z");
  assert.equal(result.prior.truth.temporal.effectiveAt, "2026-03-31T23:59:59Z");
  assert.equal(result.prior.truth.temporal.observedAt, "2026-04-30T12:00:00Z");
  assert.equal(result.current.truth.temporal.publishedAt, "2026-07-31T10:00:00Z");

  const modified = result.changes.find((change) => change.title === "Risk factors");
  const added = result.changes.find((change) => change.title === "New disclosure");
  const removed = result.changes.find((change) => change.title === "Removed disclosure");
  assert.equal(modified?.kind, "modified");
  assert.equal(modified?.materiality, "material");
  assert.equal(added?.kind, "added");
  assert.equal(added?.materiality, "unknown");
  assert.equal(removed?.kind, "removed");
  assert.equal(removed?.materiality, "not_material");
  assert.equal(modified?.priorContentHash, prior.contentHash);
  assert.equal(modified?.currentContentHash, current.contentHash);
  assert.ok(modified?.evidenceRefs.some((ref) => ref.includes("#section:")));
  assert.doesNotMatch(JSON.stringify(result), /PARENT PRIOR BODY MUST NOT DRIVE|PARENT CURRENT BODY MUST NOT DRIVE/);

  assert.deepEqual(result.historicalContext.map((item) => item.sourceRef), [
    oldHistory.sourceRef,
    permittedHistory.sourceRef,
  ]);
  assert.doesNotMatch(JSON.stringify(result.historicalContext), /disclosure:hidden|filing:other/);
});

test("SI-03.28 parent-body fallback is explicit and never invents materiality", () => {
  const prior = parent({ sourceRef: "disclosure:a", body: "Old text", kind: "disclosure", occurredAt: "2026-01-01T00:00:00Z" });
  const current = parent({ sourceRef: "disclosure:b", body: "New text", kind: "disclosure", occurredAt: "2026-02-01T00:00:00Z" });
  const result = buildDisclosureChangeIntelligence([prior, current], {
    priorSourceRef: prior.sourceRef,
    currentSourceRef: current.sourceRef,
  });
  assert.equal(result.prior.sectionMode, "parent_body_fallback");
  assert.equal(result.current.sectionMode, "parent_body_fallback");
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].kind, "modified");
  assert.equal(result.changes[0].materiality, "unknown");
  assert.deepEqual(result.changes[0].evidenceRefs, [prior.sourceRef, current.sourceRef]);
});

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-disclosure-changes-"));
process.env.LIMURIA_DATA_DIR = root;
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument, listProjectIntelligenceSnapshots } = await import("./p7ProjectIntelligenceStore");
const { GovernedToolRegistry } = await import("./governedTools");

test("SI-03.28 governed tool is Project-scoped, allow-list aware, read-only, and restart durable", async (t) => {
  await initDb();
  t.after(async () => {
    await closeDb();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const [owner] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test",
    passwordHash: "test",
    name: "Owner",
    role: "internal_analyst",
  }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Disclosure changes" });
  const otherProject = await createProject(tenant, { name: "Other" });

  async function indexParent(projectId: number, sourceRef: string, body: string, occurredAt: string, kind: DisclosureKind, extra: Record<string, unknown> = {}) {
    return indexProjectDocument(tenant, {
      projectId,
      sourceType: kind === "filing" ? "filing" : "document",
      sourceRef,
      title: sourceRef,
      body,
      occurredAt,
      entityRefs: ["entity:acme"],
      metadata: {
        ...(kind === "filing" ? {} : { disclosureKind: kind }),
        disclosureSeries: "acme-quarterly",
        publishedAt: occurredAt,
        effectiveAt: occurredAt,
        ...extra,
      },
    });
  }

  const prior = await indexParent(project.id, "filing:a", "prior parent", "2026-01-01T00:00:00Z", "filing");
  const current = await indexParent(project.id, "presentation:b", "current parent", "2026-04-01T00:00:00Z", "presentation");
  const history = await indexParent(project.id, "transcript:history", "history", "2025-10-01T00:00:00Z", "transcript");
  await indexParent(project.id, "disclosure:hidden", "hidden", "2025-11-01T00:00:00Z", "disclosure");
  const foreign = await indexParent(otherProject.id, "filing:foreign", "foreign", "2026-02-01T00:00:00Z", "filing");

  for (const [parentDoc, title, body, materiality] of [
    [prior, "Risk", "Old risk", "not_material"],
    [current, "Risk", "New risk", "material"],
  ] as const) {
    await indexProjectDocument(tenant, {
      projectId: project.id,
      sourceType: "document",
      sourceRef: parentDoc.sourceRef + "#section:risk",
      title: parentDoc.title + " · Risk",
      body,
      occurredAt: parentDoc.occurredAt,
      sourceRefs: [parentDoc.sourceRef],
      entityRefs: parentDoc.entityRefs,
      metadata: {
        structureKind: "section",
        parentSourceRef: parentDoc.sourceRef,
        sectionTitle: title,
        startLine: 1,
        materiality,
      },
    });
  }

  const registry = new GovernedToolRegistry();
  registry.register(disclosureChangesTool);
  const signal = new AbortController().signal;
  const call = {
    source: "agent" as const,
    tenant,
    userId: owner.id,
    projectId: project.id,
    requestId: crypto.randomUUID(),
    sourceScope: "my_data" as const,
    resourceTransmissionAllowed: true,
    allowedSourceRefs: [prior.sourceRef, current.sourceRef, history.sourceRef],
  };
  const input = { priorSourceRef: prior.sourceRef, currentSourceRef: current.sourceRef, historyLimit: 10 };
  const snapshotsBefore = await listProjectIntelligenceSnapshots(tenant, project.id, 20);
  const result = await registry.invoke(disclosureChangesTool.id, input, signal, call);
  const output = result.output as ReturnType<typeof buildDisclosureChangeIntelligence>;
  assert.equal(output.changes.length, 1);
  assert.equal(output.changes[0].materiality, "material");
  assert.deepEqual(output.historicalContext.map((item) => item.sourceRef), [history.sourceRef]);
  assert.deepEqual(await listProjectIntelligenceSnapshots(tenant, project.id, 20), snapshotsBefore, "read-only tool must not rebuild or write Project Intelligence");

  await assert.rejects(registry.invoke(disclosureChangesTool.id, { priorSourceRef: prior.sourceRef, currentSourceRef: prior.sourceRef }, signal, call), /distinct/);
  await assert.rejects(registry.invoke(disclosureChangesTool.id, { priorSourceRef: prior.sourceRef, currentSourceRef: "missing" }, signal, call), /missing|outside/);
  await assert.rejects(registry.invoke(disclosureChangesTool.id, { priorSourceRef: prior.sourceRef, currentSourceRef: foreign.sourceRef }, signal, call), /missing|outside/);
  await assert.rejects(registry.invoke(disclosureChangesTool.id, input, signal, { ...call, allowedSourceRefs: [prior.sourceRef] }), /excluded|allow-list/);
  await assert.rejects(registry.invoke(disclosureChangesTool.id, input, signal, { ...call, sourceScope: "web" }), /Auto or My Data/);
  await assert.rejects(registry.invoke(disclosureChangesTool.id, input, signal, { ...call, resourceTransmissionAllowed: false }), /transmission is disabled/);

  await closeDb();
  await initDb();
  const reopened = await registry.invoke(disclosureChangesTool.id, input, signal, call);
  assert.deepEqual((reopened.output as typeof output).prior, output.prior);
  assert.deepEqual((reopened.output as typeof output).current, output.current);
  assert.deepEqual((reopened.output as typeof output).changes, output.changes);
});
