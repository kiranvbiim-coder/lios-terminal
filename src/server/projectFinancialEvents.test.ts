import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { financialEventSchema, financialEventClassSchema } from "@shared/financialEventContracts";
import { p7ProjectDocumentSchema } from "@shared/p7ResearchContracts";
import { p7DocumentId, p7Hash } from "./p7ProjectIntelligence";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lios-financial-events-"));
process.env.LIMURIA_DATA_DIR = root;
const { projectFinancialEventProjection } = await import("./projectFinancialEvents");
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createArtifact, getArtifactVersion } = await import("./artifactStore");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { rebuildProjectIntelligence, listProjectIntelligenceSnapshots } = await import("./p7ProjectIntelligenceStore");
const { projectFinancialEventsTool } = await import("./projectFinancialEventsTool");
const { GovernedToolRegistry } = await import("./governedTools");

function document(sourceRef: string, event: unknown, body = "Source-declared financing event") {
  return p7ProjectDocumentSchema.parse({ schemaVersion: "1", id: p7DocumentId(1, "document", sourceRef), projectId: 1, sourceType: "document", sourceRef,
    title: sourceRef, body, contentHash: p7Hash({ event, body }), occurredAt: "2026-10-06T00:00:00Z", sourceRefs: [sourceRef], entityRefs: [], metadata: event === undefined ? {} : { financialEvent: event } });
}
const event = {
  id: "financing-1", eventClass: "financing", period: "FY2026", effectiveAt: "2026-10-01T00:00:00Z",
  entityRefs: ["lios:entity:1", "lios:entity:2"], sourceRefs: ["source:deal"],
  relationships: [{ fromRef: "lios:entity:1", toRef: "lios:entity:2", relation: "counterparty", impact: "unknown", sourceRefs: ["source:deal"] }],
};

test("financial events preserve source-separated disagreements and never infer events or impacts from prose", () => {
  const original = document("source:deal", event);
  const conflicting = document("source:other", { ...event, sourceRefs: ["source:other"], relationships: [{ ...event.relationships[0], impact: "negative", sourceRefs: ["source:other"] }] });
  const prose = document("source:prose", undefined, "Earnings guidance and regulatory deal news might have a positive impact.");
  const result = projectFinancialEventProjection([original, conflicting, prose]);
  assert.deepEqual(result.events.map(item => item.event.relationships[0].impact).sort(), ["negative", "unknown"]);
  assert.notEqual(result.events[0].ref, result.events[1].ref, "same event ID at different sources does not collapse opposing assertions");
  assert.equal(result.graph.edges.length, 2);
  assert.ok(result.graph.edges.every(edge => result.events.some(item => item.ref === edge.eventRef && item.contentHash === edge.contentHash)));
  assert.equal(projectFinancialEventProjection([prose]).status, "unknown");
  const filtered = projectFinancialEventProjection([original, conflicting], { allowedSourceRefs: ["source:deal"] });
  assert.equal(filtered.events.length, 1);
  assert.equal(filtered.graph.edges[0].impact, "unknown");
  assert.doesNotMatch(JSON.stringify(filtered), /source:other|negative/);
  assert.equal(projectFinancialEventProjection([original], { entityRef: "lios:entity:foreign" }).status, "unknown");
  const malformed = document("source:bad", { ...event, relationships: [{ ...event.relationships[0], sourceRefs: ["source:secret"] }] });
  const invalid = projectFinancialEventProjection([malformed]);
  assert.equal(invalid.status, "unknown");
  assert.equal(invalid.invalidDeclarations, 1);
  assert.equal(invalid.events.length, 0);
  const tooLarge = projectFinancialEventProjection([original], { maxOutputBytes: 1_024 });
  assert.equal(tooLarge.status, "unavailable");
  assert.equal(tooLarge.omittedEvents, 1);
  assert.equal(tooLarge.graph.edges.length, 0);
  const earlier = document("source:earlier", { ...event, effectiveAt: "2026-10-06T12:00:00+05:00" });
  const later = document("source:later", { ...event, effectiveAt: "2026-10-06T08:00:00Z" });
  assert.deepEqual(projectFinancialEventProjection([earlier, later]).events.map(item => item.sourceRef), ["source:later", "source:earlier"], "financial chronology compares actual instants, not clock-face strings");
});

test("canonical Timeline Artifacts persist all financial classes into scoped read-only event intelligence", async t => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(root, { recursive: true, force: true }); });
  const [owner] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test", role: "internal_analyst", name: "Owner" }).returning();
  const [other] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test", role: "internal_analyst", name: "Other" }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const project = await createProject(tenant, { name: "Financial events" });
  const events = financialEventClassSchema.options.map(eventClass => ({ id: eventClass, at: "2026-10-06T00:00:00Z", type: "research", title: `Source-declared ${eventClass}`, summary: `Explicit ${eventClass} source statement.`, sourceRefs: [`source:${eventClass}`],
    financialEvent: financialEventSchema.parse({ ...event, id: eventClass, eventClass, sourceRefs: [`source:${eventClass}`], relationships: [{ ...event.relationships[0], sourceRefs: [`source:${eventClass}`] }] }) }));
  const saved = await createArtifact(tenant, { projectId: project.id, title: "Financial chronology", content: artifactContentSchema.parse({ kind: "timeline", events }), sourceRefs: events.flatMap(item => item.sourceRefs) });
  await rebuildProjectIntelligence(tenant, project.id);
  const registry = new GovernedToolRegistry(); registry.register(projectFinancialEventsTool);
  const signal = new AbortController().signal;
  const call = { source: "agent" as const, tenant, userId: owner.id, projectId: project.id, requestId: crypto.randomUUID(), sourceScope: "my_data" as const };
  const snapshotsBefore = await listProjectIntelligenceSnapshots(tenant, project.id, 20);
  const result = await registry.invoke(projectFinancialEventsTool.id, { limit: 20 }, signal, call);
  const output = result.output as ReturnType<typeof projectFinancialEventProjection>;
  assert.deepEqual(new Set(output.events.map(item => item.event.eventClass)), new Set(financialEventClassSchema.options));
  assert.equal(output.graph.edges.length, 10);
  assert.ok(output.events.every(item => item.artifactRef === `${saved.artifact.id}@v1` && item.event.period === "FY2026" && item.truth.temporal.effectiveAt === "2026-10-01T00:00:00Z"));
  assert.ok(output.events.every(item => item.observedAt !== item.event.effectiveAt));
  assert.deepEqual(await listProjectIntelligenceSnapshots(tenant, project.id, 20), snapshotsBefore, "read-only tool does not lazily rebuild or create snapshots");
  const selected = await registry.invoke(projectFinancialEventsTool.id, { limit: 20 }, signal, { ...call, allowedSourceRefs: ["source:earnings"] });
  assert.deepEqual((selected.output as typeof output).events.map(item => item.event.eventClass), ["earnings"]);
  assert.doesNotMatch(JSON.stringify(selected), /source:guidance|source:rating/);
  await assert.rejects(registry.invoke(projectFinancialEventsTool.id, {}, signal, { ...call, sourceScope: "web" }), /Auto or My Data/);
  await assert.rejects(registry.invoke(projectFinancialEventsTool.id, {}, signal, { ...call, tenant: { ...tenant, userId: other.id }, userId: other.id }), /not found|not owned|access/i);
  const { createConversationToolCall, getConversationTool } = await import("./conversationRuntime");
  assert.ok(getConversationTool(projectFinancialEventsTool.id), "financial-event tool is registered in the canonical governed conversation registry");
  const { conversationRequestSchema } = await import("@shared/conversationRuntime");
  const privateCall = createConversationToolCall({
    tenant, scope: "project", projectId: project.id, chatId: null, history: [], emit: () => {},
    request: conversationRequestSchema.parse({ requestId: crypto.randomUUID(), message: "Review financial events.", transmissionPolicy: { allowResourceReferences: false } }),
  }, "agent", { resourceTransmissionAllowed: true });
  await assert.rejects(registry.invoke(projectFinancialEventsTool.id, {}, signal, privateCall), /transmission is disabled/, "server policy wins over a forged call override and prevents financial evidence disclosure");
  await closeDb(); await initDb();
  const reopened = await registry.invoke(projectFinancialEventsTool.id, { limit: 20 }, signal, call);
  assert.deepEqual((reopened.output as typeof output).events.map(item => item.ref), output.events.map(item => item.ref));
  const persisted = artifactContentSchema.parse((await getArtifactVersion(tenant, saved.artifact.id)).content);
  assert.equal(persisted.kind, "timeline");
  if (persisted.kind === "timeline") assert.equal(persisted.events[0].financialEvent?.eventClass, "earnings");
});
