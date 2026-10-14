import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { TenantContext } from "./tenantContext";
import type { GovernedToolCall } from "./governedTools";
import type { ConversationToolKind, ConversationToolResult } from "./conversationRuntime";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-nonfinance-evidence-"));
process.env.LIMURIA_DATA_DIR = dataDir;
// Store modules capture LIMURIA_DATA_DIR at load; importing after isolation is the boundary under test.
const { initDb, closeDb, getDb } = await import("./db");
const { users } = await import("@shared/schema");
const { createProject } = await import("./projectStore");
const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
const { getArtifact, getArtifactVersion, listProjectArtifacts } = await import("./artifactStore");
const { projectEvidenceArtifactTool, projectEvidenceArtifactOutputSchema } = await import("./projectEvidenceArtifactTool");
const { GovernedToolRegistry } = await import("./governedTools");
const { runAgentLoop } = await import("./agentLoop");
const { createExecutionJournal } = await import("./exec/execution-journal");
const { artifactContentSchema } = await import("@shared/artifactContracts");
const { listProjectLedgerEvents, verifyLedgerIntegrity } = await import("./ledgerStore");

// Scripted JSON exercises the production loop contract, not a claimed live AI answer.
test("non-finance Project evidence uses governed planning, the real L2 ledger and persistent P4 state", async (t) => {
  await initDb();
  t.after(async () => { await closeDb(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const [user] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-hash", role: "internal_analyst", name: "Evidence owner" }).returning();
  const [other] = await getDb().insert(users).values({ email: `${crypto.randomUUID()}@example.test`, passwordHash: "test-hash", role: "internal_analyst", name: "Other owner" }).returning();
  const tenant: TenantContext = { userId: user.id, organizationId: null, role: user.role };
  const foreign: TenantContext = { userId: other.id, organizationId: null, role: other.role };
  const project = await createProject(tenant, { name: "Office accessibility review" });
  const otherProject = await createProject(foreign, { name: "Private project" });
  const excerpt = "Office accessibility: the north entrance has a step-free ramp. The south entrance requires stairs.";
  await indexProjectDocument(tenant, {
    projectId: project.id,
    sourceType: "document",
    sourceRef: "document:site-survey",
    title: "Site survey",
    body: excerpt,
    occurredAt: "2026-10-01T12:00:00Z",
    metadata: {
      sourceUrl: "https://example.test/survey-final",
      requestedUrl: "https://example.test/survey",
      resolvedUrl: "https://example.test/survey-final",
      retrievedAt: "2026-10-02T12:00:00Z",
      publishedAt: "2026-10-01T12:00:00Z",
      modelPeriod: "2026-Q3",
      sourceTier: "community",
      originClass: "untrusted",
      evidenceKind: "claim",
      relations: [
        { type: "contradicts", targetRef: "document:counter-survey" },
        { type: "contradicts", targetRef: "document:excluded-survey" },
      ],
    },
  });
  await indexProjectDocument(tenant, { projectId: project.id, sourceType: "document", sourceRef: "document:counter-survey", title: "Counter survey", body: "Office accessibility: the north entrance ramp is closed and requires stairs.", occurredAt: "2026-10-03T09:00:00Z", metadata: { relations: [{ type: "contradicts", targetRef: "document:site-survey" }] } });
  await indexProjectDocument(tenant, { projectId: project.id, sourceType: "document", sourceRef: "document:excluded-survey", title: "Unapproved survey", body: "Office accessibility SECRET_UNAPPROVED_EVIDENCE" });
  await indexProjectDocument(foreign, { projectId: otherProject.id, sourceType: "document", sourceRef: "document:foreign-survey", title: "Foreign survey", body: "Office accessibility SECRET_FOREIGN_EVIDENCE" });
  const registry = new GovernedToolRegistry<ConversationToolKind, ConversationToolResult>();
  registry.register(projectEvidenceArtifactTool);
  const requestId = crypto.randomUUID();
  const call: GovernedToolCall = { source: "agent", userId: tenant.userId, tenant, projectId: project.id, requestId, sourceScope: "my_data", allowedSourceRefs: ["document:site-survey"] };
  const signal = new AbortController().signal;
  const args = { query: "office accessibility", title: "Office accessibility evidence digest" };
  let artifactId = "";
  let contradictionArtifactId = "";

  await t.test("catalogue is schema-backed, ticker-free and never declares internal creation replay-safe", () => {
    const tool = registry.listAgentTools()[0];
    assert.equal(tool.id, "lios.project.evidence_artifact");
    assert.equal(tool.permissionClass, "safe_auto");
    assert.equal(tool.sideEffect, "internal_write");
    assert.equal(tool.replaySafe, false);
    assert.ok(tool.inputSchema?.safeParse(args).success);
    for (const reserved of ["tenant", "projectId", "sourceScope", "allowedSourceRefs", "approval"]) {
      assert.equal(tool.inputSchema?.safeParse({ ...args, [reserved]: "forged" }).success, false);
    }
  });

  await t.test("validated non-finance plan creates only cited permitted excerpts, with durable tool events", async () => {
    const owner = { userId: tenant.userId, projectId: project.id, chatId: null };
    const journal = await createExecutionJournal({ directory: path.join(dataDir, "journal"), keyDirectory: path.join(dataDir, "keys") });
    await journal.begin({ id: requestId, owner, label: "Non-finance evidence digest", agentRun: true });
    const tool = registry.listAgentTools()[0];
    const outcome = await runAgentLoop({
      goal: "Find permitted office accessibility evidence and save a cited Project Artifact. No ticker or market data is needed.",
      tools: [{ id: tool.id, label: tool.label, kind: tool.kind, permissionClass: tool.permissionClass, sideEffect: tool.sideEffect, decision: "allow" }],
      budget: { maxSteps: 2, maxAiCalls: 1, maxRevisions: 0 }, signal,
      callModel: async ({ system, user: prompt }) => {
        assert.match(prompt, /office accessibility/);
        assert.match(system, /lios\.project\.evidence_artifact/);
        return JSON.stringify({ steps: [{ id: "save-evidence", toolId: tool.id, label: "Save permitted accessibility excerpts", input: args, dependsOn: [] }] });
      },
      invokeTool: async ({ step }) => {
        const result = await registry.invoke(step.toolId, step.input, signal, { ...call, stepId: step.id });
        const parsed = projectEvidenceArtifactOutputSchema.parse(result);
        artifactId = parsed.output.artifactId;
        return { kind: "ok", summary: result.summary, deterministic: result.deterministic, sourceRefs: result.sourceRefs };
      },
      ledger: (event) => journal.appendAgentEvent(requestId, event),
      onPlan: async (steps) => { assert.equal(steps[0].toolId, tool.id); },
      onStepStart: async (step) => { assert.equal(step.id, "save-evidence"); },
      onStepResult: async (step) => { assert.equal(step.status, "completed"); },
      onRevise: async () => { assert.fail("No revision expected"); },
    });
    assert.equal(outcome.status, "budget_exhausted");
    assert.equal(outcome.answer, null, "No scripted AI outcome is substituted for a real model answer");
    assert.equal(outcome.steps[0].status, "completed");
    const record = await journal.read(requestId, owner);
    assert.deepEqual(record?.events?.map((event) => event.kind), ["step_started", "tool_call_started", "tool_call_finished", "step_finished"]);
    assert.equal(JSON.stringify(record).includes(excerpt), false, "L2 holds hashes/refs, not document text");
    const version = await getArtifactVersion(tenant, artifactId);
    const content = artifactContentSchema.parse(version.content);
    assert.equal(content.kind, "research");
    if (content.kind !== "research") assert.fail("Research Artifact expected");
    assert.deepEqual(content.claims, []);
    assert.deepEqual(content.contradictions, []);
    assert.deepEqual(content.evidence.map((item) => item.sourceRef), ["document:site-survey"]);
    assert.ok(excerpt.includes(content.evidence[0].snippet), "Excerpts are copied from actual evidence, never invented");
    assert.equal(content.evidence[0].url, "https://example.test/survey-final");
    const quote = content.blocks.find((block) => block.type === "quote");
    assert.ok(quote);
    assert.equal(quote.attrs.excerptSha256, crypto.createHash("sha256").update(quote.text, "utf8").digest("hex"));
    assert.equal(quote.attrs.excerptByteLength, Buffer.byteLength(quote.text, "utf8"));
    assert.deepEqual(quote.attrs.provenance, { sourceUrl: "https://example.test/survey-final", requestedUrl: "https://example.test/survey", resolvedUrl: "https://example.test/survey-final", retrievedAt: "2026-10-02T12:00:00Z", publishedAt: "2026-10-01T12:00:00Z", originClass: "untrusted", evidenceKind: "claim", modelPeriod: "2026-Q3", sourceTier: "community" });
    const truth = quote.attrs.truth as { temporal: { modelPeriod: string }; sourceQuality: { tier: string; claimVerification: string }; freshness: { basis: string } };
    assert.equal(truth.temporal.modelPeriod, "2026-Q3");
    assert.equal(truth.sourceQuality.tier, "community");
    assert.equal(truth.sourceQuality.claimVerification, "not_verified_by_digest");
    const { listProjectIntelligenceDocuments } = await import("./p7ProjectIntelligenceStore");
    const indexed = (await listProjectIntelligenceDocuments(tenant, project.id)).find((doc) => doc.sourceRef === "document:site-survey");
    assert.ok(indexed);
    assert.equal(quote.attrs.contentHash, indexed.contentHash);
    assert.deepEqual(content.sourcePolicy.allowedSourceRefs, call.allowedSourceRefs);
    assert.deepEqual(version.sourceRefs, ["document:site-survey"]);
    assert.deepEqual(version.dependencyRefs, ["document:site-survey"]);
    assert.equal(JSON.stringify(content).includes("SECRET_"), false);

    const ledgerEvents = await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.created", limit: 50 });
    const artifactEvent = ledgerEvents.find((event) => event.payload.artifactId === artifactId);
    assert.ok(artifactEvent);
    const evidenceLedger = (artifactEvent.payload as any).evidenceLedger;
    assert.equal(Array.isArray(evidenceLedger), true);
    assert.equal(evidenceLedger.length, 1);
    assert.equal(evidenceLedger[0].sourceRef, "document:site-survey");
    assert.equal(evidenceLedger[0].downstreamRef, `${artifactId}@v1`);
    assert.equal(evidenceLedger[0].quoteBlockId, "quote-0");
    assert.match(evidenceLedger[0].excerptHash, /^[a-f0-9]{64}$/);
    assert.equal(evidenceLedger[0].sourceContentHash, indexed.contentHash);
    assert.equal(evidenceLedger[0].clocks.observedAt, "2026-10-01T12:00:00.000Z");
    assert.equal(evidenceLedger[0].clocks.retrievedAt, "2026-10-02T12:00:00Z");
    assert.equal(evidenceLedger[0].clocks.publishedAt, "2026-10-01T12:00:00Z");
    assert.equal(evidenceLedger[0].clocks.modelPeriod, "2026-Q3");
    assert.equal(evidenceLedger[0].sourceQuality.tier, "community");
    assert.equal(evidenceLedger[0].sourceQuality.claimVerification, "not_verified_by_digest");
    assert.equal(JSON.stringify(artifactEvent).includes(excerpt), false, "P3 evidence ledger stores hashes/locators, not raw excerpts");

    const lineage = artifactEvent.lineage as any;
    const evidenceNode = lineage.nodes.find((node: any) => node.kind === "evidence");
    assert.ok(evidenceNode);
    assert.equal(evidenceNode.metadata.sourceRef, "document:site-survey");
    assert.match(evidenceNode.metadata.excerptHash, /^[a-f0-9]{64}$/);
    assert.ok(lineage.edges.some((edge: any) =>
      edge.from === "document:site-survey" && edge.to === evidenceNode.ref && edge.relation === "produced"
    ));
    assert.ok(lineage.edges.some((edge: any) =>
      edge.from === evidenceNode.ref && edge.to === `${artifactId}@v1` && edge.relation === "used"
    ));
    const integrity = await verifyLedgerIntegrity(tenant, `project:${project.id}`);
    assert.equal(integrity.valid, true);
  });

  await t.test("permitted explicit contradiction pair is durable and excluded relation targets do not leak", async () => {
    const contradictionCall = {
      ...call,
      requestId: crypto.randomUUID(),
      allowedSourceRefs: ["document:site-survey", "document:counter-survey"],
    };
    const result = projectEvidenceArtifactOutputSchema.parse(await registry.invoke(
      projectEvidenceArtifactTool.id,
      { query: "office accessibility", title: "Office accessibility contradiction digest" },
      signal,
      contradictionCall,
    ));
    contradictionArtifactId = result.output.artifactId;
    assert.match(result.summary, /1 explicit contradiction/);

    const version = await getArtifactVersion(tenant, contradictionArtifactId);
    const content = artifactContentSchema.parse(version.content);
    assert.equal(content.kind, "research");
    if (content.kind !== "research") assert.fail("Research Artifact expected");
    assert.equal(content.contradictions.length, 1);
    assert.deepEqual(content.contradictions[0].evidenceRefs, ["document:counter-survey", "document:site-survey"]);
    assert.equal(content.contradictions[0].status, "open");
    const contradictionBlock = content.blocks.find((block) => block.id.startsWith("contradiction-"));
    assert.ok(contradictionBlock);
    assert.equal(contradictionBlock.attrs.deterministic, true);
    assert.deepEqual(contradictionBlock.attrs.evidenceRefs, ["document:counter-survey", "document:site-survey"]);
    assert.equal(JSON.stringify(content).includes("document:excluded-survey"), false);
    assert.equal(JSON.stringify(content).includes("SECRET_UNAPPROVED_EVIDENCE"), false);
    assert.deepEqual(new Set(version.dependencyRefs), new Set(["document:site-survey", "document:counter-survey"]));
  });

  await t.test("agent research inherits the active Artifact source policy before reading Project evidence", async () => {
    const { executeConversationRuntime } = await import("./conversationRuntime");
    const { createAttribution } = await import("./byoaiRouter");
    const responses = [
      JSON.stringify({ steps: [{ id: "research", toolId: "lios.project.evidence_artifact", label: "Save selected evidence", input: args, dependsOn: [] }] }),
      JSON.stringify({ decision: "complete", answer: "Saved selected evidence." }),
    ];
    const events: import("@shared/conversationRuntime").ConversationRuntimeEvent[] = [];
    await executeConversationRuntime({
      tenant, scope: "project", projectId: project.id, chatId: null, resources: [], history: [],
      request: {
        requestId: crypto.randomUUID(), message: "Save office accessibility evidence",
        executionMode: "ai_assisted", sourceScope: "my_data",
        context: { activeObjectRefs: [artifactId] },
      },
      agentLoop: {},
      aiCompletion: async () => {
        const text = responses.shift();
        assert.ok(text, "Only plan and review model calls are expected");
        return { provider: "openai", model: "gpt-4o", text, attribution: createAttribution({ provider: "openai", model: "gpt-4o", prompt: "p", output: text }) };
      },
      emit: (event) => { events.push(event); },
    });
    const result = events.find((event) => event.type === "tool_result");
    assert.ok(result && result.type === "tool_result");
    const savedRef = result.sourceRefs.find((ref) => ref.startsWith("artifact:"));
    assert.ok(savedRef);
    const saved = artifactContentSchema.parse((await getArtifactVersion(tenant, savedRef.split("@")[0])).content);
    assert.equal(saved.kind, "research");
    if (saved.kind !== "research") assert.fail("Research Artifact expected");
    assert.deepEqual(saved.evidence.map((item) => item.sourceRef), ["document:site-survey"]);
    assert.equal(JSON.stringify(saved).includes("SECRET_UNAPPROVED_EVIDENCE"), false);
  });

  await t.test("Web/Files, wrong owner, forged model scope, empty evidence and cancellation cannot create an Artifact", async () => {
    const before = (await listProjectArtifacts(tenant, project.id)).length;
    for (const sourceScope of ["web", "files"] as const) {
      await assert.rejects(registry.invoke(projectEvidenceArtifactTool.id, args, signal, { ...call, sourceScope }), /requires Auto or My Data/);
    }
    await assert.rejects(registry.invoke(projectEvidenceArtifactTool.id, args, signal, { ...call, projectId: otherProject.id }));
    await assert.rejects(registry.invoke(projectEvidenceArtifactTool.id, { ...args, allowedSourceRefs: [] }, signal, call), /registered schema/);
    await assert.rejects(registry.invoke(projectEvidenceArtifactTool.id, { ...args, query: "zzznomatchzzz" }, signal, call), /No permitted Project evidence/);
    await assert.rejects(registry.invoke(projectEvidenceArtifactTool.id, args, AbortSignal.abort(), call));
    assert.equal((await listProjectArtifacts(tenant, project.id)).length, before);
  });

  await t.test("P4 identity, citations and excerpt content survive database close/reopen", async () => {
    const before = await getArtifactVersion(tenant, artifactId);
    await closeDb();
    await initDb();
    assert.equal((await getArtifact(tenant, artifactId)).projectId, project.id);
    const reopened = await getArtifactVersion(tenant, artifactId);
    assert.deepEqual(reopened.content, before.content);
    assert.deepEqual(reopened.sourceRefs, before.sourceRefs);
    assert.equal(reopened.contentHash, before.contentHash);
    const reopenedLedgerEvents = await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.created", limit: 50 });
    const reopenedArtifactEvent = reopenedLedgerEvents.find((event) => event.payload.artifactId === artifactId);
    assert.ok(reopenedArtifactEvent);
    assert.equal((reopenedArtifactEvent.payload as any).evidenceLedger[0].downstreamRef, `${artifactId}@v1`);
    assert.equal(await verifyLedgerIntegrity(tenant, `project:${project.id}`).then((report) => report.valid), true);

    assert.ok(contradictionArtifactId);
    const reopenedContradiction = artifactContentSchema.parse((await getArtifactVersion(tenant, contradictionArtifactId)).content);
    assert.equal(reopenedContradiction.kind, "research");
    if (reopenedContradiction.kind !== "research") assert.fail("Research Artifact expected");
    assert.equal(reopenedContradiction.contradictions.length, 1);
    assert.deepEqual(reopenedContradiction.contradictions[0].evidenceRefs, ["document:counter-survey", "document:site-survey"]);
    assert.equal(JSON.stringify(reopenedContradiction).includes("document:excluded-survey"), false);
    await assert.rejects(getArtifact(foreign, artifactId));
  });
});
