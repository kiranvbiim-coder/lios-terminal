import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import { createServer } from "node:http";
import { eq } from "drizzle-orm";
import {
  decisionArtifactApprovalInspectionSchema, decisionArtifactApprovalLinkInputSchema,
  decisionArtifactContentSchema, type DecisionArtifactApprovalLinkInput,
} from "@shared/artifactContracts";
import type { UnsignedModelAssuranceArtifact } from "@shared/modelAssurance";
import type { TenantContext } from "./tenantContext";
import type { GovernedToolCall } from "./governedTools";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-decision-object-"));
process.env.LIOS_DATA_ROOT = dataDir;
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
// DB/data-root modules capture configuration on load; these imports intentionally
// follow the isolated Home assignment to exercise the real persistence boundary.
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, decisionCases, decisionReceiptVersions, decisionApprovals, researchInvestigations,
  artifactInteractionReceipts, projectLedgerEvents } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { createArtifact, createArtifactVersion, createArtifactProposal, decideArtifactProposal, getArtifact,
  getArtifactVersion, forkArtifact, listArtifactInteractionReceipts } = await import("./artifactStore");
const { decisionSnapshotHash } = await import("./decisionEngine");
const { hashLedgerValue } = await import("./ledgerStore");
const { generateAssuranceSigningKeyPair, signModelAssuranceArtifact } = await import("./modelAssuranceIntegrity");
const { getDecisionObjectArtifactApproval, getDecisionObjectArtifactApprovalLinkSnapshot, linkDecisionObjectArtifactApproval,
  unlinkDecisionObjectArtifactApproval, listDecisionObjectArtifactApprovalOptions } = await import("./decisionObjectArtifact");
const { registerArtifactRoutes } = await import("./artifactRoutes");
const { artifactInspectTool, artifactMaintenanceTool } = await import("./artifactMaintenance");
const { createArtifactPackage, importArtifactPackage } = await import("./artifactPackage");

test("decision lifecycle optional authored fields preserve historical hashes and exact new text", () => {
  const historical = decisionArtifactContentSchema.parse({ kind: "decision", objective: "Existing objective" });
  for (const field of ["recommendation", "dissent", "actions", "outcome", "followUp", "caseRef"]) {
    assert.equal(Object.hasOwn(historical, field), false);
  }
  assert.equal(hashLedgerValue(decisionArtifactContentSchema.parse(historical)), hashLedgerValue(historical));
  const authored = decisionArtifactContentSchema.parse({ ...historical, recommendation: "  Keep 1.2300 / =SUM(A1:A2)  ", dissent: ["  Analyst concern  "],
    actions: [{ id: "review", description: "  Owner review  ", assignee: "  Operations  ", dueAt: "2026-10-20T09:00:00+05:30" }],
    outcome: { summary: "  Observed value  " }, followUp: [{ id: "check", description: "  Recheck  " }] });
  assert.equal(authored.recommendation, "  Keep 1.2300 / =SUM(A1:A2)  ");
  assert.deepEqual(authored.dissent, ["  Analyst concern  "]);
  assert.equal(authored.actions?.[0].description, "  Owner review  ");
  assert.equal(authored.actions?.[0].status, "planned");
  assert.equal(authored.actions?.[0].assignee, "  Operations  ");
  assert.equal(authored.followUp?.[0].status, "open");
  assert.equal(authored.outcome?.status, "pending");
  for (const authority of ["approval", "decisionApprovalLink", "serverApprovalId", "approvedReceiptVersionId"]) {
    assert.equal(decisionArtifactContentSchema.safeParse({ ...historical, [authority]: { outcome: "approved" } }).success, false);
    assert.equal(decisionArtifactApprovalLinkInputSchema.safeParse({ baseVersion: 1, baseHash: "a".repeat(64), decisionId: 1, receiptVersionId: 1, receiptHash: "b".repeat(64), [authority]: 1 }).success, false);
  }
  assert.equal(decisionArtifactContentSchema.safeParse({ ...historical, dissent: ["x".repeat(10_001)] }).success, false);
  assert.equal(decisionArtifactContentSchema.safeParse({ ...historical, actions: [{ id: "bad", description: "Bad", dueAt: "tomorrow" }] }).success, false);
});

test("owned decision Artifact review references remain exact, live, version-bound and durable", { timeout: 120_000 }, async t => {
  await initDb();
  const priorKey = process.env.LIOS_ASSURANCE_PUBLIC_KEY;
  const signing = generateAssuranceSigningKeyPair();
  process.env.LIOS_ASSURANCE_PUBLIC_KEY = signing.publicKeyPem;
  t.after(async () => {
    await closeDb();
    if (priorKey === undefined) delete process.env.LIOS_ASSURANCE_PUBLIC_KEY;
    else process.env.LIOS_ASSURANCE_PUBLIC_KEY = priorKey;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const [owner, foreign, reviewer, secondReviewer] = await getDb().insert(users).values([
    { name: "Owner", role: "internal_analyst" as const }, { name: "Foreign", role: "internal_analyst" as const },
    { name: "Reviewer", role: "internal_compliance" as const }, { name: "Second reviewer", role: "internal_admin" as const },
  ].map(item => ({ ...item, email: `${crypto.randomUUID()}@test.invalid`, passwordHash: "test", organizationId: null }))).returning();
  const ctx: TenantContext = { userId: owner.id, organizationId: null, role: owner.role };
  const foreignCtx: TenantContext = { userId: foreign.id, organizationId: null, role: foreign.role };
  const project = await createProject(ctx, { name: "Decision lifecycle" });
  const body = decisionArtifactContentSchema.parse({ kind: "decision", objective: "Select launch approach", recommendation: "Run bounded pilot",
    dissent: ["Demand remains uncertain", "  Preserve 1.2300 exactly  "], assumptions: { demand: "1.2300", formulaText: "=B2*B3" },
    alternatives: [{ id: "pilot", label: "Pilot", expectedOutcomes: ["Measured uptake"], risks: ["Limited reach"], tradeoffs: ["Slower roll-out"] }],
    selectedAlternativeId: "pilot", actions: [{ id: "pilot-action", description: "Schedule owned pilot", status: "planned", assignee: "Operations", dueAt: "2026-10-20T10:00:00.000Z", sourceRefs: ["https://example.test/plan"], artifactRefs: [] }],
    outcome: { summary: "No observations yet", status: "pending", observedAt: null, sourceRefs: [], artifactRefs: [] },
    followUp: [{ id: "pilot-review", description: "Review adoption", status: "open", dueAt: "2026-11-01T10:00:00.000Z", sourceRefs: [], artifactRefs: [] }],
    linkedRefs: { sources: ["https://example.test/evidence"] } });
  const retained = await createArtifact(ctx, { projectId: project.id, title: "Launch decision", content: body, sourceRefs: ["https://example.test/evidence"] });
  const now = new Date();
  const unsigned: UnsignedModelAssuranceArtifact = {
    schemaVersion: "1.0", modelId: "decision.fixture", modelVersion: "1", engineVersion: "fixture-1", riskTier: "tier_1_material",
    validationLevel: "known_answer", band: "institutional", score: 96,
    components: { validation: 98, dataQuality: 96, evidence: 95, reproducibility: 100 },
    inputSnapshotHash: "a".repeat(64), validationReportHash: "b".repeat(64), providerIds: ["owned-reference"],
    evidence: [{ kind: "known_answer", passed: true, independent: true, artifactHash: "c".repeat(64), validatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), validator: "reference-test", referenceIds: ["test-known-answer"] }],
    blockers: [], warnings: [], uncertainty: { quantified: true, method: "scenario", summary: "Scenario range" },
    challenger: { required: true, passed: true, modelId: "decision.challenger", artifactHash: "d".repeat(64) },
    deterministic: true, seed: null, createdAt: now.toISOString(),
  };
  const assurance = signModelAssuranceArtifact(unsigned, signing.privateKeyPem);
  async function existingCase(options: { userId?: number; organizationId?: number | null; approved?: boolean; complete?: boolean; assuranceValid?: boolean; outcome?: "approved" | "waived" } = {}) {
    const [decision] = await getDb().insert(decisionCases).values({ title: "Existing review case", question: "Proceed with pilot?", materiality: "routine",
      ownerUserId: options.userId ?? owner.id, organizationId: options.organizationId ?? null, status: "review" }).returning();
    const payload = { decisionId: decision.id, version: 1, question: decision.question, recommendation: "Pilot", interpretation: "Demand uncertainty",
      evidence: [], sources: [], assumptions: [], calculations: [], models: [], scenarios: [], alternatives: [], counterarguments: [], contradictions: [],
      confidence: { assurance: options.assuranceValid === false ? { ...assurance, score: 95 } : assurance }, monitoringTriggers: [], provenance: [],
      requiredEvidenceCount: 1, completeness: { complete: options.complete !== false }, createdByUserId: options.userId ?? owner.id };
    const [receipt] = await getDb().insert(decisionReceiptVersions).values({ ...payload, snapshotHash: decisionSnapshotHash(payload) }).returning();
    if (options.approved !== false) {
      await getDb().insert(decisionApprovals).values({ decisionId: decision.id, receiptVersionId: receipt.id, snapshotHash: receipt.snapshotHash,
        outcome: options.outcome ?? "approved", waiverReason: options.outcome === "waived" ? "Explicit canonical reviewer waiver" : null, reviewerUserId: reviewer.id });
      await getDb().update(decisionCases).set({ status: "approved", approvedReceiptVersionId: receipt.id }).where(eq(decisionCases.id, decision.id));
    }
    return { decision, receipt };
  }
  const approved = await existingCase();
  const request: DecisionArtifactApprovalLinkInput = { baseVersion: 1, baseHash: retained.version.contentHash,
    decisionId: approved.decision.id, receiptVersionId: approved.receipt.id, receiptHash: approved.receipt.snapshotHash };

  await t.test("link uses existing exact server review, writes only P4 reference custody and exposes current approval", async () => {
    const beforeCases = (await getDb().select().from(decisionCases)).length;
    const beforeReviews = (await getDb().select().from(decisionApprovals)).length;
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).state, "unlinked");
    const linked = await linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, request);
    assert.equal(linked.state, "approved");
    assert.equal(linked.link?.receiptHash, approved.receipt.snapshotHash);
    assert.equal(linked.link?.projectId, project.id);
    assert.equal(linked.link?.artifactContentHash, retained.version.contentHash);
    assert.equal(linked.currentApproval?.reviewerUserId, reviewer.id);
    assert.ok(linked.currentApproval?.serverApprovalId);
    assert.equal((await getDb().select().from(decisionCases)).length, beforeCases);
    assert.equal((await getDb().select().from(decisionApprovals)).length, beforeReviews);
    assert.equal((await getArtifact(ctx, retained.artifact.id)).headVersion, 1);
    assert.deepEqual((await getArtifactVersion(ctx, retained.artifact.id)).content, body);
    const receipts = await listArtifactInteractionReceipts(ctx, retained.artifact.id);
    assert.ok(receipts.some(row => row.action === "reference" && row.actorType === "system" && row.toVersion === 1 && row.detail.decisionApprovalLink));
    const ledger = await getDb().select().from(projectLedgerEvents).where(eq(projectLedgerEvents.projectId, project.id));
    assert.ok(ledger.some(row => row.payload.decisionApprovalLink));
    const options = await listDecisionObjectArtifactApprovalOptions(ctx, retained.artifact.id, 1);
    assert.equal(options.cases.find(item => item.id === approved.decision.id)?.receipts[0].eligible, true);
  });

  await t.test("foreign owner, foreign organization, linked foreign scopes and exact stale bases fail closed", async () => {
    await assert.rejects(getDecisionObjectArtifactApproval(foreignCtx, retained.artifact.id), /not owned/);
    const alien = await existingCase({ userId: foreign.id });
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, decisionId: alien.decision.id, receiptVersionId: alien.receipt.id, receiptHash: alien.receipt.snapshotHash }), /Owned decision/);
    const [organization] = await getDb().insert(organizations).values({ name: "Different organization", slug: `decision-foreign-${crypto.randomUUID()}` }).returning();
    const otherOrg = await existingCase({ organizationId: organization.id });
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, decisionId: otherOrg.decision.id, receiptVersionId: otherOrg.receipt.id, receiptHash: otherOrg.receipt.snapshotHash }), /Owned decision/);
    const foreignScope = await existingCase();
    const [investigation] = await getDb().insert(researchInvestigations).values({ title: "Foreign research", question: "Foreign?", ownerUserId: foreign.id, organizationId: null }).returning();
    await getDb().update(decisionCases).set({ investigationId: investigation.id }).where(eq(decisionCases.id, foreignScope.decision.id));
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, decisionId: foreignScope.decision.id, receiptVersionId: foreignScope.receipt.id, receiptHash: foreignScope.receipt.snapshotHash }), /Owned decision/);
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, baseHash: "f".repeat(64) }), /base hash/);
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, receiptHash: "f".repeat(64) }), /receipt hash/);
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, receiptVersionId: alien.receipt.id }), /unavailable/);
    const options = await listDecisionObjectArtifactApprovalOptions(ctx, retained.artifact.id);
    assert.ok(options.cases.every(item => ![alien.decision.id, otherOrg.decision.id, foreignScope.decision.id].includes(item.id)));
  });

  await t.test("nonapproved, incomplete, tampered confidence and missing review cannot be represented as approved", async () => {
    for (const fixture of [await existingCase({ approved: false }), await existingCase({ complete: false }), await existingCase({ assuranceValid: false })]) {
      await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, decisionId: fixture.decision.id, receiptVersionId: fixture.receipt.id, receiptHash: fixture.receipt.snapshotHash }));
    }
    const missingReview = await existingCase({ approved: false });
    await getDb().update(decisionCases).set({ status: "approved", approvedReceiptVersionId: missingReview.receipt.id }).where(eq(decisionCases.id, missingReview.decision.id));
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, decisionId: missingReview.decision.id, receiptVersionId: missingReview.receipt.id, receiptHash: missingReview.receipt.snapshotHash }), /canonical approval/);
    const tampered = await existingCase();
    await getDb().update(decisionReceiptVersions).set({ interpretation: "Rewritten after hash" }).where(eq(decisionReceiptVersions.id, tampered.receipt.id));
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, decisionId: tampered.decision.id, receiptVersionId: tampered.receipt.id, receiptHash: tampered.receipt.snapshotHash }), /hash verification/);
    const options = await listDecisionObjectArtifactApprovalOptions(ctx, retained.artifact.id);
    assert.ok(options.cases.some(item => item.receipts.some(receipt => !receipt.eligible && receipt.reason !== null)));
  });

  await t.test("new canonical receipt, ownership loss and inconsistent authored case references invalidate custody", async () => {
    const fixture = await existingCase();
    const target = await createArtifact(ctx, { projectId: project.id, title: "Review turnover", content: body });
    const selected = { baseVersion: 1, baseHash: target.version.contentHash, decisionId: fixture.decision.id,
      receiptVersionId: fixture.receipt.id, receiptHash: fixture.receipt.snapshotHash };
    await linkDecisionObjectArtifactApproval(ctx, target.artifact.id, selected);
    const { id: _id, snapshotHash: _hash, createdAt: _createdAt, ...oldPayload } = fixture.receipt;
    const payload = { ...oldPayload, version: 2, recommendation: "Different canonical recommendation" };
    await getDb().insert(decisionReceiptVersions).values({ ...payload, snapshotHash: decisionSnapshotHash(payload) });
    assert.equal((await getDecisionObjectArtifactApproval(ctx, target.artifact.id)).state, "stale");
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, target.artifact.id, selected), /latest/);
    await getDb().update(decisionCases).set({ ownerUserId: foreign.id }).where(eq(decisionCases.id, fixture.decision.id));
    assert.equal((await getDecisionObjectArtifactApproval(ctx, target.artifact.id)).state, "unavailable");
    const conflicting = await createArtifact(ctx, { projectId: project.id, title: "Explicit different case",
      content: { ...body, caseRef: `decision:${fixture.decision.id}` } });
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, conflicting.artifact.id, {
      ...request, baseHash: conflicting.version.contentHash,
    }), /case reference differs/);
  });

  await t.test("canonical revoked/rejected approval, replacement reviewer and case reopen are evaluated at read time", async () => {
    await getDb().update(decisionCases).set({ status: "review", approvedReceiptVersionId: null }).where(eq(decisionCases.id, approved.decision.id));
    const reopened = await getDecisionObjectArtifactApproval(ctx, retained.artifact.id);
    assert.equal(reopened.state, "stale"); assert.equal(reopened.currentApproval, null);
    assert.ok(reopened.link?.serverApprovalId);
    await getDb().update(decisionCases).set({ status: "approved", approvedReceiptVersionId: approved.receipt.id }).where(eq(decisionCases.id, approved.decision.id));
    const [revocation] = await getDb().insert(decisionApprovals).values({ decisionId: approved.decision.id, receiptVersionId: approved.receipt.id,
      snapshotHash: approved.receipt.snapshotHash, outcome: "rejected", reviewerUserId: secondReviewer.id, createdAt: new Date(Date.now() + 1_000) }).returning();
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).state, "stale");
    await getDb().update(decisionApprovals).set({ outcome: "approved" }).where(eq(decisionApprovals.id, revocation.id));
    const replaced = await getDecisionObjectArtifactApproval(ctx, retained.artifact.id);
    assert.equal(replaced.state, "stale"); assert.equal(replaced.currentApproval, null);
    await linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, request);
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).currentApproval?.serverApprovalId, revocation.id);
    await getDb().update(decisionCases).set({ expiresAt: new Date(Date.now() - 1_000) }).where(eq(decisionCases.id, approved.decision.id));
    assert.match((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).reason ?? "", /expired/);
    await getDb().update(decisionCases).set({ expiresAt: null }).where(eq(decisionCases.id, approved.decision.id));
  });

  let latestVersion = retained.version;
  await t.test("body edit and accepted proposal preserve dissent/actions/outcome/follow-up but stale earlier approval", async () => {
    latestVersion = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: 1,
      content: { ...body, recommendation: "Pilot after capacity check" } });
    const staleBody = await getDecisionObjectArtifactApproval(ctx, retained.artifact.id);
    assert.equal(staleBody.state, "stale"); assert.equal(staleBody.currentApproval, null);
    assert.match(staleBody.reason ?? "", /body changed/);
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id, 1)).state, "approved");
    await assert.rejects(linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, request), /head moved/);
    const proposal = await createArtifactProposal(ctx, { artifactId: retained.artifact.id, baseVersion: latestVersion.version, type: "artifact_patch",
      summary: "Record authored observation", patch: { outcome: { ...body.outcome, summary: "Observed 12 pilot signups", status: "observed", observedAt: "2026-10-08T11:00:00.000Z" } } });
    await decideArtifactProposal(ctx, proposal.id, "accept");
    latestVersion = await getArtifactVersion(ctx, retained.artifact.id);
    const updated = decisionArtifactContentSchema.parse(latestVersion.content);
    assert.deepEqual(updated.dissent, body.dissent);
    assert.deepEqual(updated.actions, body.actions);
    assert.deepEqual(updated.followUp, body.followUp);
    assert.equal(updated.outcome?.summary, "Observed 12 pilot signups");
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).state, "stale");
    assert.deepEqual((await getArtifactVersion(ctx, retained.artifact.id, 1)).content, body);
  });

  await t.test("maintenance exposes authored lifecycle fields but never decision approval authority", async () => {
    const call: GovernedToolCall = { source: "agent", userId: owner.id, tenant: ctx, projectId: project.id, requestId: crypto.randomUUID(),
      stepId: "decision-maintenance", activeArtifactRefs: [retained.artifact.id], resourceTransmissionAllowed: true, sourceScope: "my_data" };
    const inspected = await artifactInspectTool.invoke({ artifactId: retained.artifact.id }, new AbortController().signal, call);
    assert.match(inspected.summary, /recommendation/); assert.match(inspected.summary, /followUp/);
    const update = { artifactId: retained.artifact.id, baseVersion: latestVersion.version, baseHash: latestVersion.contentHash, summary: "Revise dissent",
      edits: [{ op: "set", path: ["dissent", 0], value: "Capacity remains uncertain" }] };
    const proposed = await artifactMaintenanceTool.invoke(update, new AbortController().signal, call);
    assert.match(proposed.summary, /pending|proposal|review/i);
    for (const protectedPath of [["caseRef"], ["assumptions", "approval"], ["assumptions", "decisionApprovalLink"]]) {
      await assert.rejects(artifactMaintenanceTool.invoke({ ...update, edits: [{ op: "set", path: protectedPath, value: "approved" }] }, new AbortController().signal, { ...call, stepId: crypto.randomUUID() }));
    }
  });

  await t.test("direct create/version/proposal nested authority injection is refused; fork/package does not copy server linkage", async () => {
    const injected = decisionArtifactContentSchema.parse({ ...body, assumptions: { decisionApprovalLink: { outcome: "approved", serverApprovalId: 999 } } });
    await assert.rejects(createArtifact(ctx, { projectId: project.id, title: "Injected", content: injected }), /server-derived/);
    await assert.rejects(createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: latestVersion.version, content: injected }), /server-derived/);
    await assert.rejects(createArtifactProposal(ctx, { artifactId: retained.artifact.id, baseVersion: latestVersion.version, type: "artifact_patch",
      summary: "Injected", patch: { assumptions: injected.assumptions } }), /server-derived/);
    const fork = await forkArtifact(ctx, { artifactId: retained.artifact.id, version: 1 });
    assert.equal((await getDecisionObjectArtifactApproval(ctx, fork.artifact.id)).state, "unlinked");
    const historical = await createArtifact(ctx, { projectId: project.id, title: "Historical decision",
      content: decisionArtifactContentSchema.parse({ kind: "decision", objective: "Historical objective" }) });
    assert.equal(Object.hasOwn(historical.version.content, "recommendation"), false);
    const destination = await createProject(ctx, { name: "Explicit imported project" });
    const pkg = await createArtifactPackage(ctx, project.id);
    const imported = await importArtifactPackage(ctx, destination.id, pkg);
    assert.equal((await getDecisionObjectArtifactApproval(ctx, imported.artifactIdMap[retained.artifact.id])).state, "unlinked");
    const reopenedHistorical = await getArtifactVersion(ctx, imported.artifactIdMap[historical.artifact.id]);
    assert.equal(Object.hasOwn(reopenedHistorical.content, "recommendation"), false);
    assert.equal(reopenedHistorical.contentHash, historical.version.contentHash);
    const forgedPkg = structuredClone(pkg);
    forgedPkg.artifacts[0].versions[0].content = injected;
    forgedPkg.artifacts[0].versions[0].contentHash = hashLedgerValue(injected);
    const { packageHash: _packageHash, ...unsignedPackage } = forgedPkg;
    forgedPkg.packageHash = hashLedgerValue(unsignedPackage);
    await assert.rejects(importArtifactPackage(ctx, destination.id, forgedPkg), /server-derived/);
  });

  await t.test("evidence metadata changes also stale binding; explicit unlink and relink keep immutable historical custody", async () => {
    const currentRequest = { ...request, baseVersion: latestVersion.version, baseHash: latestVersion.contentHash };
    await linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, currentRequest);
    latestVersion = await createArtifactVersion(ctx, { artifactId: retained.artifact.id, baseVersion: latestVersion.version,
      content: decisionArtifactContentSchema.parse(latestVersion.content), sourceRefs: ["https://example.test/changed-evidence"] });
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).state, "stale");
    const base = { baseVersion: latestVersion.version, baseHash: latestVersion.contentHash };
    const linked = await linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, ...base });
    assert.equal(linked.state, "approved");
    const cleared = await unlinkDecisionObjectArtifactApproval(ctx, retained.artifact.id, base);
    assert.equal(cleared.state, "unlinked"); assert.equal(cleared.link, null);
    assert.ok((await listArtifactInteractionReceipts(ctx, retained.artifact.id)).filter(row => row.detail.decisionApprovalLink).length >= 5);
    await linkDecisionObjectArtifactApproval(ctx, retained.artifact.id, { ...request, ...base });
  });

  await t.test("read/link routes reject forged server fields and enforce current base; waived remains explicitly waived", async () => {
    const waived = await existingCase({ outcome: "waived", complete: false, assuranceValid: false });
    const waivedArtifact = await createArtifact(ctx, { projectId: project.id, title: "Waived reference", content: body });
    const waivedLink = await linkDecisionObjectArtifactApproval(ctx, waivedArtifact.artifact.id, { baseVersion: 1, baseHash: waivedArtifact.version.contentHash,
      decisionId: waived.decision.id, receiptVersionId: waived.receipt.id, receiptHash: waived.receipt.snapshotHash });
    assert.equal(waivedLink.state, "waived");
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { Object.defineProperty(req, "isAuthenticated", { value: () => true }); req.user = owner; next(); });
    registerArtifactRoutes(app);
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address(); assert.ok(address && typeof address !== "string");
    try {
      const endpoint = `http://127.0.0.1:${address.port}/api/artifacts/${encodeURIComponent(retained.artifact.id)}/decision-approval`;
      const read = await fetch(`${endpoint}?version=${latestVersion.version}`);
      const inspected = decisionArtifactApprovalInspectionSchema.parse(await read.json());
      assert.equal(read.status, 200); assert.equal(inspected.state, "approved");
      assert.equal(inspected.approvalScope, "linked_receipt_only");
      const forged = await fetch(`${endpoint}/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, serverApprovalId: 1 }) });
      assert.equal(forged.status, 400);
      const moved = await fetch(`${endpoint}/link`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      assert.equal(moved.status, 409);
      const options = await fetch(`${endpoint}/options?version=${latestVersion.version}`);
      assert.equal(options.status, 200);
      const root = `http://127.0.0.1:${address.port}`;
      const targetPath = `/api/artifacts/${encodeURIComponent(retained.artifact.id)}`;
      for (const attempted of [
        { path: `/api/projects/${project.id}/artifacts`, body: { title: "Forged", content: body, decisionApprovalLink: inspected.link } },
        { path: `${targetPath}/versions`, body: { baseVersion: latestVersion.version, content: body, detail: { decisionApprovalLink: inspected.link } } },
        { path: `${targetPath}/proposals`, body: { baseVersion: latestVersion.version, type: "artifact_patch", summary: "Forged", patch: {}, decisionApprovalLink: inspected.link } },
        { path: `${targetPath}/references`, body: { targetType: "project", targetRef: String(project.id), detail: { decisionApprovalLink: inspected.link }, actorType: "system" } },
      ]) {
        const response = await fetch(`${root}${attempted.path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(attempted.body) });
        assert.equal(response.status, 400);
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });

  await t.test("reopen recovers all authored lifecycle content and immutable link, then resolves revocation live", async () => {
    const saved = await getArtifactVersion(ctx, retained.artifact.id);
    const snapshot = await getDecisionObjectArtifactApprovalLinkSnapshot(ctx, retained.artifact.id);
    assert.ok(snapshot);
    await closeDb(); await initDb();
    assert.deepEqual((await getArtifactVersion(ctx, retained.artifact.id)).content, saved.content);
    assert.deepEqual(await getDecisionObjectArtifactApprovalLinkSnapshot(ctx, retained.artifact.id), snapshot);
    assert.equal((await getDecisionObjectArtifactApproval(ctx, retained.artifact.id)).state, "approved");
    await getDb().update(decisionCases).set({ status: "rejected", approvedReceiptVersionId: null }).where(eq(decisionCases.id, approved.decision.id));
    const revoked = await getDecisionObjectArtifactApproval(ctx, retained.artifact.id);
    assert.equal(revoked.state, "stale"); assert.equal(revoked.currentApproval, null);
    // Foreign reads are denied by canonical P4 ownership, not an Artifact caseRef.
    await assert.rejects(getDecisionObjectArtifactApproval(foreignCtx, retained.artifact.id), /not owned/);
    const interactions = await getDb().select().from(artifactInteractionReceipts).where(eq(artifactInteractionReceipts.artifactId, retained.artifact.id));
    assert.ok(interactions.some(row => row.detail.decisionApprovalLink));
  });
});
