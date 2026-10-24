/**
 * GM-12 / SP-02 / Brain V1: OPT-IN real-BYOAI acceptance against the actual
 * ConversationRuntime -> AgentLoop -> governed P7/P4 tool path.
 *
 * Normal public-source CI skips this file: it never receives user-owned model
 * credentials, accesses an installed model or reports native SP/P14 acceptance.
 * On a disposable local checkout only:
 *
 * LIOS_BRAIN_LIVE_ACCEPTANCE=1 LIOS_BRAIN_LIVE_PROVIDER=ollama \
 *   OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=<installed-model> \
 *   node --import tsx --test server/agentBrainLiveAcceptance.test.ts
 *
 * A configured entitled API provider also works. Only synthetic evidence is
 * indexed; no real user Project, credential or model reply is recorded in Git.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Brain V1: a real entitled model plans a governed tool, saves an owned P4 Research Artifact and issues an exact receipt", {
  skip: process.env.LIOS_BRAIN_LIVE_ACCEPTANCE !== "1"
    ? "Requires explicit user-owned live-model opt-in, never public CI" : false,
  timeout: 180_000,
}, async (t) => {
  const provider = process.env.LIOS_BRAIN_LIVE_PROVIDER?.trim();
  assert.ok(provider, "Set LIOS_BRAIN_LIVE_PROVIDER to the user-owned provider/runtime to test.");
  const model = process.env.LIOS_BRAIN_LIVE_MODEL?.trim() || undefined;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "lios-brain-live-"));
  const oldDataDir = process.env.LIMURIA_DATA_DIR;
  process.env.LIMURIA_DATA_DIR = dataDir;

  // Import after isolating the stores: this acceptance must never touch an
  // existing installed Home database, Project, or P7 corpus.
  const { initDb, closeDb, getDb } = await import("./db");
  const { users } = await import("@shared/schema");
  const { createProject } = await import("./projectStore");
  const { indexProjectDocument } = await import("./p7ProjectIntelligenceStore");
  const { getArtifact, getArtifactVersion, listProjectArtifacts } = await import("./artifactStore");
  const { executeConversationRuntime } = await import("./conversationRuntime");
  const { createExecutionJournal } = await import("./exec/execution-journal");
  const { artifactContentSchema } = await import("@shared/artifactContracts");
  const { listProjectLedgerEvents } = await import("./ledgerStore");
  const events: import("@shared/conversationRuntime").ConversationRuntimeEvent[] = [];
  const agentEvents: import("./exec/agent-run-events").AgentEventInput[] = [];
  let dbClosed = true;
  t.after(async () => {
    if (!dbClosed) await closeDb();
    if (oldDataDir === undefined) delete process.env.LIMURIA_DATA_DIR;
    else process.env.LIMURIA_DATA_DIR = oldDataDir;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  await initDb();
  dbClosed = false;

  const [owner] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test", passwordHash: "synthetic-test-only",
    role: "internal_analyst", name: "Local Brain acceptance",
  }).returning();
  const [other] = await getDb().insert(users).values({
    email: crypto.randomUUID() + "@example.test", passwordHash: "synthetic-test-only",
    role: "internal_analyst", name: "Unrelated owner",
  }).returning();
  const tenant = { userId: owner.id, organizationId: null, role: owner.role };
  const foreignTenant = { userId: other.id, organizationId: null, role: other.role };
  const project = await createProject(tenant, { name: "Synthetic accessibility audit" });
  const foreignProject = await createProject(foreignTenant, { name: "Other owner's private test" });
  const excerpt = "Office accessibility: the north entrance has a step-free ramp.";
  await indexProjectDocument(tenant, {
    projectId: project.id, sourceType: "document", sourceRef: "document:accessibility-site-survey",
    title: "Synthetic site survey", body: excerpt, occurredAt: "2026-10-01T12:00:00Z",
  });
  await indexProjectDocument(foreignTenant, {
    projectId: foreignProject.id, sourceType: "document", sourceRef: "document:foreign-private",
    title: "Never accessible", body: "SECRET_OTHER_TENANT_NOT_AUTHORIZED",
  });

  const requestId = crypto.randomUUID();
  const journal = await createExecutionJournal({
    directory: path.join(dataDir, "agent-journal"), keyDirectory: path.join(dataDir, "agent-journal-keys"),
  });
  const journalOwner = { userId: tenant.userId, projectId: project.id, chatId: null };
  await journal.begin({ id: requestId, owner: journalOwner, label: "Live-model governed evidence digest", agentRun: true });
  const result = await executeConversationRuntime({
    tenant, scope: "project", projectId: project.id, chatId: null, resources: [], history: [],
    preferredProvider: provider,
    ...(model ? { preferredModel: model } : {}),
    request: {
      requestId, continuationOf: null,
      message: "Use the governed tool lios.project.evidence_artifact to create a cited Project Research Artifact. Query exactly 'office accessibility' and title it 'Accessibility evidence digest'. Do not use any other tool. Complete only after the tool really succeeds.",
      executionMode: "ai_assisted", sourceScope: "my_data", aiDirectApproved: false, approvals: [],
      transmissionPolicy: {
        mode: "configured", providerAllow: [provider], providerDeny: [],
        allowProjectInstructions: false, allowResourceReferences: false, allowSelection: false,
        allowToolCalling: true, dataClassification: "private", maxProviderAttempts: 1,
      },
      attachments: [],
    },
    agentLoop: {
      maxSteps: 1, maxAiCalls: 2, maxRevisions: 0, maxDurationMs: 120_000,
      ledger: async (event) => { await journal.appendAgentEvent(requestId, event); agentEvents.push(event); },
    },
    emit: (event) => { events.push(event); },
  });

  // Model output is never evidence of execution: require an actual
  // registry-issued tool result, L2 step records and P4 read-back.
  assert.equal(result.cancelled, false);
  assert.equal(result.awaitingApproval, false);
  assert.equal(result.label, "ai_derived", "The selected live model must finish after planning.");
  const planned = events.find(event => event.type === "plan");
  assert.ok(planned && planned.type === "plan");
  assert.equal(planned.plan.steps.some(step => step.componentId === "lios.project.evidence_artifact"), true);
  const toolResult = events.find(event => event.type === "tool_result" && event.stepId && event.sourceRefs.some(ref => ref.startsWith("artifact:")));
  assert.ok(toolResult && toolResult.type === "tool_result", "An actual governed tool must complete, not just an AI claim.");
  assert.equal(toolResult.deterministic, true);
  const savedRef = toolResult.sourceRefs.find(ref => /^artifact:[0-9a-f-]{36}@v[1-9]\d*$/.test(ref));
  assert.ok(savedRef, "The server-issued source reference must identify the committed version.");
  const artifactId = savedRef.split("@")[0];
  assert.equal(agentEvents.some(event => event.kind === "tool_call_finished" && event.status === "succeeded"), true);
  assert.equal(agentEvents.some(event => event.kind === "step_finished" && event.status === "completed"), true);
  const persistedRun = await journal.read(requestId, journalOwner);
  assert.ok(persistedRun);
  assert.equal(persistedRun.events.filter(event => event.kind === "tool_call_finished" && event.status === "succeeded").length, 1);
  assert.equal(JSON.stringify(persistedRun).includes(excerpt), false, "L2 stores receipts and references, not source passages.");
  assert.equal(result.receiptIds.length, 1);
  const receiptEvent = events.find(event => event.type === "receipt");
  assert.ok(receiptEvent && receiptEvent.type === "receipt");
  assert.equal(receiptEvent.receipt.id, result.receiptIds[0]);
  assert.equal(receiptEvent.receipt.sourceRefs.includes(savedRef), true);
  const savedVersion = await getArtifactVersion(tenant, artifactId);
  const content = artifactContentSchema.parse(savedVersion.content);
  assert.equal(content.kind, "research");
  if (content.kind !== "research") assert.fail("Real P4 Research Artifact expected.");
  assert.deepEqual(content.evidence.map(item => item.sourceRef), ["document:accessibility-site-survey"]);
  assert.equal(content.claims.length, 0, "The tool extracts evidence; it does not invent claims.");
  assert.ok(excerpt.includes(content.evidence[0].snippet), "Saved quote must be an unchanged P7 excerpt.");
  assert.equal(JSON.stringify([events, content]).includes("SECRET_OTHER_TENANT"), false);
  assert.equal((await listProjectArtifacts(tenant, project.id)).length, 1);
  assert.equal((await listProjectLedgerEvents(tenant, project.id, { eventType: "artifact.created", limit: 10 }))
    .some(event => event.payload.artifactId === artifactId), true);

  // Reopen the real isolated database, not a model-generated placeholder.
  await closeDb();
  dbClosed = true;
  await initDb();
  dbClosed = false;
  assert.equal((await getArtifact(tenant, artifactId)).projectId, project.id);
  assert.equal((await getArtifactVersion(tenant, artifactId)).contentHash, savedVersion.contentHash);
  await assert.rejects(getArtifact(foreignTenant, artifactId));
});
