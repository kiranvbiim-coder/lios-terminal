import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import type { ConversationArtifactDraft } from "@shared/conversationRuntime";
import type { TenantContext } from "./tenantContext";
import type { CreatedArtifact } from "./artifactStore";
import type { TrustManifest } from "@shared/trustContracts";
import type { ArtifactRefreshSpec } from "@shared/artifactContracts";

// Load database-dependent modules only after selecting an isolated, on-disk Postgres data root.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-artifact-retention-"));
process.env.LIOS_DATA_ROOT = dataDir;
process.env.LIMURIA_DATA_DIR = dataDir;
delete process.env.DATABASE_URL;
const { initDb, closeDb, getDb } = await import("./db");
const { users, organizations, projectArtifacts, projectArtifactVersions, artifactInteractionReceipts, projectLedgerEvents } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { normalizeConversationDraft } = await import("./artifactDiff");
const { persistConversationDraft, keepConversationDraft, createArtifactVersion, getArtifact, getArtifactVersion, listArtifactVersions } = await import("./artifactStore");

function trustSnapshot(requestId: string): TrustManifest {
  return {
    schemaVersion: "1",
    trustId: crypto.randomUUID(),
    requestId,
    generatedAt: "2026-10-07T12:00:00.000Z",
    sourceScope: "web",
    summary: {
      freshness: "current",
      quality: "high",
      confidence: "high",
      conflictState: "not_evaluated_single_source",
      evidenceCoveragePct: 100,
      sourceCount: 1,
      receiptCount: 0,
      missingCount: 0,
    },
    evidence: [{
      evidenceId: crypto.randomUUID(),
      sourceRef: "provider:filing-extract",
      providerId: "filing-extract",
      providerLabel: "Filing extract",
      kind: "provider",
      observedAt: "2026-10-07T12:00:00.000Z",
      asOf: null,
      freshness: "current",
      quality: "high",
      confidence: "high",
      connectorState: "live_verified",
      isFallback: false,
      access: null,
      fields: ["revenue"],
      valueHash: null,
      notes: [],
    }],
    claims: [],
    conflicts: [],
    methodology: [],
    assumptions: [],
    missing: [],
    warnings: [],
  };
}

function researchDraft(projectId: number): ConversationArtifactDraft {
  const sourceRef = "https://example.test/filing/2026-10-07";
  const receiptId = crypto.randomUUID();
  return {
    schemaVersion: "1",
    artifactId: crypto.randomUUID(),
    artifactType: "research.company",
    title: "Filing-backed research",
    projectId,
    sourceRefs: [sourceRef, "provider:sec_edgar"],
    executionReceiptIds: [receiptId],
    data: {
      kind: "research",
      question: "What changed in the filing?",
      blocks: [{ id: "summary", type: "paragraph", text: "Revenue increased according to the filing.", attrs: {} }],
      claims: [{ id: "revenue", text: "Revenue increased.", sourceRefs: [sourceRef], provenance: "source_backed" }],
      evidence: [{ id: "filing", title: "Quarterly filing", snippet: "Revenue increased.", sourceRef, sourceType: "filing", observedAt: "2026-10-07T12:00:00.000Z" }],
      executionTrail: [{ at: "2026-10-07T12:00:00.000Z", action: "Read quarterly filing", sourceRefs: [sourceRef], receiptId }],
      editorPreference: "builtin",
    },
    persistence: "project_candidate",
  };
}

async function artifactRows(artifactId: string) {
  const [artifacts, versions, receipts] = await Promise.all([
    getDb().select().from(projectArtifacts).where(eq(projectArtifacts.id, artifactId)),
    getDb().select().from(projectArtifactVersions).where(eq(projectArtifactVersions.artifactId, artifactId)).orderBy(projectArtifactVersions.version),
    getDb().select().from(artifactInteractionReceipts).where(eq(artifactInteractionReceipts.artifactId, artifactId)).orderBy(artifactInteractionReceipts.createdAt, artifactInteractionReceipts.id),
  ]);
  const ledger = (await getDb().select().from(projectLedgerEvents).orderBy(projectLedgerEvents.createdAt, projectLedgerEvents.id)).filter(event => event.payload.artifactId === artifactId);
  return { artifacts, versions, receipts, ledger };
}

async function rowCounts() {
  const [artifacts, versions, receipts, ledger] = await Promise.all([
    getDb().select({ id: projectArtifacts.id }).from(projectArtifacts),
    getDb().select({ id: projectArtifactVersions.id }).from(projectArtifactVersions),
    getDb().select({ id: artifactInteractionReceipts.id }).from(artifactInteractionReceipts),
    getDb().select({ id: projectLedgerEvents.id }).from(projectLedgerEvents),
  ]);
  return { artifacts: artifacts.length, versions: versions.length, receipts: receipts.length, ledger: ledger.length };
}

test("SI-04.02 Project draft retention uses canonical P4 state and durable replay identity", { timeout: 90_000 }, async (t) => {
  t.after(async () => {
    await closeDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await initDb();
  const [owner, stranger] = await getDb().insert(users).values([
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Retention owner", role: "internal_analyst" as const, organizationId: null },
    { email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-only", name: "Other owner", role: "internal_analyst" as const, organizationId: null },
  ]).returning();
  const ctx: TenantContext = { userId: owner.id, role: owner.role, organizationId: null };
  const strangerCtx: TenantContext = { userId: stranger.id, role: stranger.role, organizationId: null };
  const project = await createProject(ctx, { name: "Automatically retained research" });
  const draft = researchDraft(project.id);
  const input = { projectId: project.id, draft, requestId: crypto.randomUUID() };
  let retained: CreatedArtifact;

  await t.test("concurrent identical calls create one Artifact, initial version, interaction receipt and Ledger event", async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => persistConversationDraft(ctx, structuredClone(input))));
    retained = results[0];
    assert.equal(new Set(results.map(result => result.artifact.id)).size, 1);
    assert.equal(new Set(results.map(result => result.version.id)).size, 1);
    assert.equal(retained.artifact.ownerUserId, owner.id);
    assert.equal(retained.artifact.organizationId, null);
    assert.equal(retained.artifact.projectId, project.id);
    assert.equal(retained.artifact.origin, "conversation");
    assert.equal(retained.artifact.kind, "research");
    assert.equal(retained.artifact.headVersion, 1);
    assert.deepEqual(retained.version.content, normalizeConversationDraft(draft));
    assert.deepEqual(retained.version.sourceRefs, draft.sourceRefs);
    assert.deepEqual(retained.version.executionReceiptIds, draft.executionReceiptIds);
    assert.deepEqual(retained.version.dependencyRefs, draft.sourceRefs);
    const rows = await artifactRows(retained.artifact.id);
    assert.deepEqual([rows.artifacts.length, rows.versions.length, rows.receipts.length, rows.ledger.length], [1, 1, 1, 1]);
    assert.equal(rows.receipts[0].actorType, "conversation");
    assert.equal(rows.receipts[0].requestId, input.requestId);
    assert.equal(rows.receipts[0].toVersion, 1);
    assert.match(String(rows.receipts[0].detail.draftRetentionHash), /^[a-f0-9]{64}$/);
    assert.equal(rows.ledger[0].eventType, "artifact.created");
    assert.equal(rows.ledger[0].actorType, "system");
    assert.equal(rows.ledger[0].requestId, input.requestId);
    assert.equal(rows.ledger[0].payload.draftRetentionHash, rows.receipts[0].detail.draftRetentionHash);
    const lineage = rows.ledger[0].lineage as { nodes: Array<{ ref: string }>; edges: Array<{ from: string; to: string; relation: string }> };
    for (const sourceRef of draft.sourceRefs) {
      assert.ok(lineage.nodes.some(node => node.ref === sourceRef));
      assert.ok(lineage.edges.some(edge => edge.from === sourceRef && edge.to === `${retained.artifact.id}@v1`));
    }
    assert.deepEqual(await getArtifactVersion(ctx, retained.artifact.id, 1), retained.version);
  });

  await t.test("TrustManifest, dependencies and validated refresh provenance survive reopen and immutable replay", async () => {
    const requestId = crypto.randomUUID();
    const trustManifest = trustSnapshot(requestId);
    const refreshSpec: ArtifactRefreshSpec = {
      kind: "conversation",
      sourceScope: "my_data",
      executionMode: "deterministic_first",
      capabilityIds: ["research.report"],
      message: "Create a risk report",
      selection: { kind: "artifact", id: "artifact:linked-research", label: "Research", view: "report", symbol: null },
      engineRef: null,
    };
    const trustedInput = {
      projectId: project.id,
      draft: researchDraft(project.id),
      requestId,
      trustManifest,
      dependencyRefs: ["artifact:linked-research@v3"],
      refreshSpec,
    };
    const trusted = await persistConversationDraft(ctx, trustedInput);
    assert.deepEqual(trusted.version.trustManifest, trustManifest);
    assert.deepEqual(trusted.version.dependencyRefs, ["artifact:linked-research@v3", "provider:filing-extract"]);
    assert.deepEqual(trusted.version.sourceRefs, trustedInput.draft.sourceRefs);
    assert.deepEqual(trusted.version.executionReceiptIds, trustedInput.draft.executionReceiptIds);
    assert.deepEqual(trusted.version.refreshSpec, refreshSpec);
    const before = await artifactRows(trusted.artifact.id);
    assert.deepEqual(await persistConversationDraft(ctx, structuredClone(trustedInput)), trusted);
    await assert.rejects(persistConversationDraft(ctx, { ...trustedInput, trustManifest: null }), /different content/);
    await assert.rejects(persistConversationDraft(ctx, {
      ...trustedInput,
      trustManifest: { ...trustManifest, summary: { ...trustManifest.summary, confidence: "medium" } },
    }), /different content/);
    await assert.rejects(persistConversationDraft(ctx, { ...trustedInput, dependencyRefs: ["artifact:other@v1"] }), /different content/);
    for (const change of [
      { message: "Create a different risk report" },
      { sourceScope: "auto" as const },
      { executionMode: "ai_assisted" as const },
      { capabilityIds: ["company.research"] },
      { selection: { ...refreshSpec.selection!, id: "artifact:other" } },
      { engineRef: "engine:other" },
    ]) {
      await assert.rejects(persistConversationDraft(ctx, {
        ...trustedInput, refreshSpec: { ...refreshSpec, ...change },
      }), /different content/);
    }
    await assert.rejects(persistConversationDraft(ctx, { ...trustedInput, refreshSpec: null }), /different content/);
    await assert.rejects(persistConversationDraft(ctx, {
      ...trustedInput, requestId: crypto.randomUUID(),
      refreshSpec: { ...refreshSpec, message: "api_key=abcdefgh12345678" },
    }), /credential-bearing/);
    await assert.rejects(persistConversationDraft(ctx, {
      ...trustedInput, requestId: crypto.randomUUID(),
      refreshSpec: { ...refreshSpec, sourceScope: "everything" as ArtifactRefreshSpec["sourceScope"] },
    }));
    assert.deepEqual(await artifactRows(trusted.artifact.id), before);

    const defaultDependencies = await persistConversationDraft(ctx, { ...trustedInput, requestId: crypto.randomUUID(), dependencyRefs: undefined });
    assert.deepEqual(defaultDependencies.version.dependencyRefs, [...trustedInput.draft.sourceRefs, "provider:filing-extract"]);
    await closeDb();
    await initDb();
    assert.deepEqual(await persistConversationDraft(ctx, structuredClone(trustedInput)), trusted);
    assert.deepEqual((await getArtifactVersion(ctx, trusted.artifact.id, 1)).refreshSpec, refreshSpec);
    await assert.rejects(persistConversationDraft(ctx, { ...trustedInput, refreshSpec: null }), /different content/);
    assert.deepEqual(await artifactRows(trusted.artifact.id), before);
  });

  await t.test("same-key changes to content, title, citations, receipts or draft type fail without overwriting", async () => {
    const variants: Partial<ConversationArtifactDraft>[] = [
      { data: { ...draft.data, question: "Different research question" } },
      { title: "A different retained title" },
      { sourceRefs: [...draft.sourceRefs, "provider:other"] },
      { executionReceiptIds: [crypto.randomUUID()] },
      { artifactType: "research.other" },
    ];
    const before = await artifactRows(retained.artifact.id);
    for (const change of variants) {
      await assert.rejects(persistConversationDraft(ctx, { ...input, draft: { ...draft, ...change } }), /retention key already contains different content/);
    }
    assert.deepEqual(await artifactRows(retained.artifact.id), before);
    const replay = await persistConversationDraft(ctx, structuredClone(input));
    assert.deepEqual(replay, retained);
  });

  await t.test("a simultaneous same-key content collision has one winner and one explicit mismatch", async () => {
    const raceDraft = researchDraft(project.id);
    const race = { projectId: project.id, draft: raceDraft, requestId: crypto.randomUUID() };
    const changed = { ...race, draft: { ...raceDraft, data: { ...raceDraft.data, question: "Concurrent differing content" } } };
    const results = await Promise.allSettled([
      persistConversationDraft(ctx, race),
      persistConversationDraft(ctx, changed),
    ]);
    const winners = results.filter(result => result.status === "fulfilled");
    const losers = results.filter(result => result.status === "rejected");
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.match(String(losers[0].reason), /retention key already contains different content/);
    const winner = winners[0].value;
    const rows = await artifactRows(winner.artifact.id);
    assert.deepEqual([rows.artifacts.length, rows.versions.length, rows.receipts.length, rows.ledger.length], [1, 1, 1, 1]);
    const winningInput = results[0].status === "fulfilled" ? race : changed;
    const losingInput = results[0].status === "fulfilled" ? changed : race;
    assert.deepEqual(await persistConversationDraft(ctx, winningInput), winner);
    await assert.rejects(persistConversationDraft(ctx, losingInput), /different content/);
  });

  await t.test("foreign owners, organization contexts, Projects and non-Project drafts are rejected before writes", async () => {
    const otherProject = await createProject(ctx, { name: "Another owner Project" });
    const [organization] = await getDb().insert(organizations).values({ name: "Retention organization", slug: `retention-${crypto.randomUUID()}` }).returning();
    const orgCtx: TenantContext = { ...ctx, organizationId: organization.id };
    const before = await rowCounts();
    await assert.rejects(persistConversationDraft(strangerCtx, input), /not found or not owned/);
    await assert.rejects(persistConversationDraft(orgCtx, input), /not found or not owned/);
    await assert.rejects(getArtifact(strangerCtx, retained.artifact.id), /not found or not owned/);
    await assert.rejects(getArtifactVersion(strangerCtx, retained.artifact.id, 1), /not found or not owned/);
    await assert.rejects(getArtifact(orgCtx, retained.artifact.id), /not found or not owned/);
    await assert.rejects(persistConversationDraft(ctx, { ...input, draft: { ...draft, projectId: otherProject.id } }), /different Project/);
    await assert.rejects(persistConversationDraft(ctx, { ...input, draft: { ...draft, projectId: null, persistence: "ephemeral" } }), /different Project/);
    assert.deepEqual(await rowCounts(), before);

    const foreignProject = await createProject(strangerCtx, { name: "Stranger Project" });
    const orgProject = await createProject(orgCtx, { name: "Organization-scoped Project" });
    const scopedResults = await Promise.all([
      persistConversationDraft(ctx, { ...input, projectId: otherProject.id, draft: { ...draft, projectId: otherProject.id } }),
      persistConversationDraft(strangerCtx, { ...input, projectId: foreignProject.id, draft: { ...draft, projectId: foreignProject.id } }),
      persistConversationDraft(orgCtx, { ...input, projectId: orgProject.id, draft: { ...draft, projectId: orgProject.id } }),
    ]);
    assert.equal(new Set([retained.artifact.id, ...scopedResults.map(result => result.artifact.id)]).size, 4);
    assert.equal(scopedResults[1].artifact.ownerUserId, stranger.id);
    assert.equal(scopedResults[2].artifact.organizationId, organization.id);
    await assert.rejects(persistConversationDraft(ctx, { ...input, projectId: orgProject.id, draft: { ...draft, projectId: orgProject.id } }), /not found or not owned/);
  });

  await t.test("distinct request and draft identities remain distinct despite identical content", async () => {
    const otherRequest = await persistConversationDraft(ctx, { ...input, requestId: crypto.randomUUID() });
    const otherDraft = await persistConversationDraft(ctx, { ...input, draft: { ...draft, artifactId: crypto.randomUUID() } });
    assert.equal(new Set([retained.artifact.id, otherRequest.artifact.id, otherDraft.artifact.id]).size, 3);
    assert.deepEqual(otherRequest.version.content, retained.version.content);
    assert.deepEqual(otherDraft.version.content, retained.version.content);
  });

  await t.test("creation failure rolls back the retention claim, version, receipt and Ledger before retry", async () => {
    const failedInput = { projectId: project.id, draft: researchDraft(project.id), requestId: crypto.randomUUID() };
    const before = await rowCounts();
    await getDb().execute(sql`ALTER TABLE project_ledger_events ADD CONSTRAINT artifact_retention_test_failure CHECK (event_type <> 'artifact.created') NOT VALID`);
    try {
      await assert.rejects(persistConversationDraft(ctx, failedInput), (error: unknown) => {
        const cause = error instanceof Error ? error.cause ?? error : error;
        return /artifact_retention_test_failure/.test(String(cause));
      });
      assert.deepEqual(await rowCounts(), before);
    } finally {
      await getDb().execute(sql`ALTER TABLE project_ledger_events DROP CONSTRAINT artifact_retention_test_failure`);
    }
    const retried = await persistConversationDraft(ctx, failedInput);
    const rows = await artifactRows(retried.artifact.id);
    assert.deepEqual([rows.artifacts.length, rows.versions.length, rows.receipts.length, rows.ledger.length], [1, 1, 1, 1]);
  });

  await t.test("explicit Keep is still non-deduplicating and can promote a non-Project draft", async () => {
    const quickDraft = { ...researchDraft(project.id), projectId: null, persistence: "chat_candidate" as const };
    const keepInput = { projectId: project.id, draft: quickDraft, requestId: crypto.randomUUID() };
    const first = await keepConversationDraft(ctx, keepInput);
    const second = await keepConversationDraft(ctx, keepInput);
    assert.notEqual(first.artifact.id, second.artifact.id);
    assert.deepEqual(first.version.content, second.version.content);
    assert.deepEqual(first.version.sourceRefs, quickDraft.sourceRefs);
    assert.deepEqual(first.version.executionReceiptIds, quickDraft.executionReceiptIds);
    assert.equal((await artifactRows(first.artifact.id)).receipts[0].detail.draftRetentionHash, undefined);
  });

  await t.test("authored revisions cannot retain or reattach verification, while recorded access restrictions survive direct edits and proposals", async () => {
    const { createArtifact, restoreArtifactRevision, createArtifactProposal, decideArtifactProposal } = await import("./artifactStore");
    const { getArtifactExportPlan } = await import("./artifactExport");
    for (const supplied of ["omitted", "recorded", "fabricated"] as const) {
      const manifest = trustSnapshot(crypto.randomUUID());
      const created = await createArtifact(ctx, { projectId: project.id, title: `Direct ${supplied}`, content: { kind:"report", templateId:null, blocks:[{id:"p",type:"paragraph",text:"Original supported text",attrs:{}}], sections:[] }, trustManifest:manifest, sourceRefs:["provider:filing-extract"] });
      const changed = { ...created.version.content, blocks:[{id:"p",type:"paragraph",text:"Materially changed authored assertion",attrs:{}}] } as any;
      const edited = await createArtifactVersion(ctx, {artifactId:created.artifact.id,baseVersion:1,content:changed,actorType:"system",...(supplied==="omitted"?{}:{trustManifest:supplied==="recorded"?manifest:{...manifest,trustId:crypto.randomUUID()}})});
      assert.equal(edited.trustManifest,null);
      assert.deepEqual((await getArtifactVersion(ctx,created.artifact.id,1)).trustManifest,created.version.trustManifest);
      await assert.rejects(createArtifactVersion(ctx,{artifactId:created.artifact.id,baseVersion:2,content:changed,trustManifest:manifest}),/cannot mint or replace/);
      const restored=await restoreArtifactRevision(ctx,created.artifact.id,2,1);
      assert.deepEqual(restored.trustManifest,created.version.trustManifest);
    }
    for (const state of ["revoked","denied","expired","restricted"]) {
      const manifest=trustSnapshot(crypto.randomUUID());
      manifest.evidence[0].access={state,servedTier:null,bestAvailableTier:null,entitlementRequired:true,upgradeConnectorId:null,upgradeConnectorLabel:null,reason:"Historical source restriction"};
      const created=await createArtifact(ctx,{projectId:project.id,title:`Restricted ${state}`,content:{kind:"report",templateId:null,blocks:[{id:"p",type:"paragraph",text:"Original",attrs:{}}],sections:[]},trustManifest:manifest,sourceRefs:["provider:filing-extract"],dependencyRefs:["provider:filing-extract"]});
      const edited=await createArtifactVersion(ctx,{artifactId:created.artifact.id,baseVersion:1,content:{...created.version.content,blocks:[{id:"p",type:"paragraph",text:"Authored change",attrs:{}}]} as any,trustManifest:null,sourceRefs:[],dependencyRefs:[]});
      const trust=edited.trustManifest as unknown as TrustManifest;
      assert.equal(trust.summary.confidence,"unknown");assert.equal(trust.summary.evidenceCoveragePct,0);assert.equal(trust.claims.length,0);assert.equal(trust.methodology.length,0);
      assert.deepEqual(trust.evidence[0].access,manifest.evidence[0].access);
      assert.ok(edited.sourceRefs.includes("provider:filing-extract"));assert.ok(edited.dependencyRefs.includes("provider:filing-extract"));
      if(state!=="restricted")await assert.rejects(getArtifactExportPlan(ctx,created.artifact.id,2),/denied|revoked|expired/);
      const proposal=await createArtifactProposal(ctx,{artifactId:created.artifact.id,baseVersion:2,type:"artifact_patch",summary:"Explicit authored proposal",patch:{blocks:[{id:"p",type:"paragraph",text:"Proposal change",attrs:{}}]}});
      await decideArtifactProposal(ctx,proposal.id,"accept");
      const proposed=await getArtifactVersion(ctx,created.artifact.id);
      assert.deepEqual((proposed.trustManifest as unknown as TrustManifest).evidence[0].access,manifest.evidence[0].access);
      if(state!=="restricted")await assert.rejects(getArtifactExportPlan(ctx,created.artifact.id,3),/denied|revoked|expired/);
    }
    const {createArtifactPackage,importArtifactPackage}=await import("./artifactPackage");
    const exportProject=await createProject(ctx,{name:"Restricted portable history"});
    const destination=await createProject(ctx,{name:"Reimported restricted history"});
    const manifest=trustSnapshot(crypto.randomUUID());
    Object.assign(manifest.evidence[0],{sourceRef:"manual:restricted",providerId:null,kind:"manual",access:{state:"revoked",servedTier:null,bestAvailableTier:null,entitlementRequired:true,upgradeConnectorId:null,upgradeConnectorLabel:null,reason:"Historical restriction"}});
    const original=await createArtifact(ctx,{projectId:exportProject.id,title:"Portable restricted history",content:{kind:"report",templateId:null,blocks:[{id:"p",type:"paragraph",text:"Original historical claim",attrs:{}}],sections:[]},sourceRefs:["manual:restricted"],trustManifest:manifest});
    const changed={...original.version.content,blocks:[{id:"p",type:"paragraph",text:"Authored changed claim",attrs:{}}]} as any;
    await createArtifactVersion(ctx,{artifactId:original.artifact.id,baseVersion:1,content:changed});
    await createArtifactVersion(ctx,{artifactId:original.artifact.id,baseVersion:2,content:changed});
    await restoreArtifactRevision(ctx,original.artifact.id,3,1);
    const pkg=await createArtifactPackage(ctx,exportProject.id);
    const imported=await importArtifactPackage(ctx,destination.id,pkg);
    const importedId=imported.artifactIdMap[original.artifact.id];
    for(let version=1;version<=4;version++) {
      const source=await getArtifactVersion(ctx,original.artifact.id,version);
      const restored=await getArtifactVersion(ctx,importedId,version);
      assert.deepEqual(restored.content,source.content);assert.deepEqual(restored.trustManifest,source.trustManifest);
    }
  });

  await t.test("replay after database reopen returns the original version without replacing later edits", async () => {
    const editedContent = normalizeConversationDraft({ ...draft, data: { ...draft.data, question: "User-refined research question" } });
    const editedVersion = await createArtifactVersion(ctx, {
      artifactId: retained.artifact.id,
      baseVersion: 1,
      content: editedContent,
      actorType: "user",
      note: "User revision",
    });
    await getDb().update(projectArtifacts).set({ title: "User-renamed research" }).where(and(eq(projectArtifacts.id, retained.artifact.id), eq(projectArtifacts.ownerUserId, ctx.userId)));
    const before = await artifactRows(retained.artifact.id);
    await closeDb();
    await initDb();
    const reopened = await persistConversationDraft(ctx, structuredClone(input));
    assert.equal(reopened.artifact.id, retained.artifact.id);
    assert.equal(reopened.artifact.headVersion, 2);
    assert.equal(reopened.artifact.title, "User-renamed research");
    assert.deepEqual(reopened.version, retained.version);
    assert.deepEqual(await getArtifactVersion(ctx, retained.artifact.id), editedVersion);
    assert.equal((await listArtifactVersions(ctx, retained.artifact.id)).length, 2);
    assert.deepEqual(await artifactRows(retained.artifact.id), before);
    await assert.rejects(persistConversationDraft(ctx, { ...input, draft: { ...draft, title: "Different creation content after reopen" } }), /different content/);
    await assert.rejects(persistConversationDraft(strangerCtx, input), /not found or not owned/);
  });
});
