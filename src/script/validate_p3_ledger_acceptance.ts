import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/ledgerContracts.ts");
const schema = read("shared/schemaProjects.ts");
const projectContracts = read("shared/projectContracts.ts");
const migration = read("migrations/0067_lios_p3_ledger_reproducibility.sql");
const store = read("server/ledgerStore.ts");
const recorder = read("server/ledgerReproducibility.ts");
const sessions = read("server/projectSessionStore.ts");
const undo = read("server/ledgerUndo.ts");
const routes = read("server/ledgerRoutes.ts");
const projectRoutes = read("server/projectRoutes.ts");
const conversationRoutes = read("server/conversationRunService.ts");
const portability = read("server/projectPortability.ts");
const panel = read("client/src/components/terminal/ProjectLedgerPanel.tsx");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const projectHome = read("client/src/components/terminal/ProjectHome.tsx");

// P3-01 — Conversation Ledger persistence.
assert.ok(schema.includes('projectLedgerStreamHeads = pgTable("project_ledger_stream_heads"'), "P3-01 stream-head persistence is missing.");
assert.ok(schema.includes('projectLedgerEvents = pgTable("project_ledger_events"'), "P3-01 event persistence is missing.");
assert.ok(migration.includes('CREATE TABLE "project_ledger_events"'), "P3-01 Ledger migration is missing.");
assert.ok(store.includes("appendLedgerEventInTransaction") && store.includes("projectLedgerStreamHeads.nextSequence"), "P3-01 append/sequence service is missing.");
assert.ok(conversationRoutes.includes("createConversationLedgerRecorder") && conversationRoutes.includes("ledger.recordRuntimeEvent"), "P3-01 P2 runtime is not persisted into the Ledger.");

// P3-02 — change, decision and execution receipts.
for (const event of ["execution.receipt", "decision.recorded", "session.updated", "state.reverted"]) {
  assert.ok(contracts.includes(`"${event}"`), `P3-02 event contract missing ${event}.`);
}
assert.ok(routes.includes("/ledger/decisions"), "P3-02 decision recording endpoint is missing.");
assert.ok(recorder.includes('eventType: "execution.receipt"'), "P3-02 runtime execution receipts are not recorded.");

// P3-03 — branch ancestry and comparison.
assert.ok(sessions.includes("getProjectSessionAncestry"), "P3-03 Session ancestry is missing.");
assert.ok(sessions.includes("commonAncestorId"), "P3-03 common-ancestor comparison is missing.");
assert.ok(projectRoutes.includes("/compare/:otherSessionId"), "P3-03 Session comparison route is missing.");

// P3-04 — Show Work reproducibility.
for (const field of ["sourceRefs:", "inputSnapshot:", "formulas:", "engines:", "asOf:", "aiInvolvement:"]) {
  assert.ok(contracts.includes(field), `P3-04 Show Work field missing ${field}.`);
}
assert.ok(routes.includes("/receipts/:receiptId/show-work"), "P3-04 Show Work endpoint is missing.");
assert.ok(panel.includes("Show Work") && panel.includes("Engine / formula") && panel.includes("Sources") && panel.includes("Inputs / outputs"), "P3-04 Show Work UX is missing.");

// P3-05 — deterministic history and reversible mutation.
assert.ok(store.includes("previousHash") && store.includes("eventHash") && store.includes("verifyLedgerIntegrity"), "P3-05 hash-chain history is incomplete.");
assert.ok(undo.includes('eventType: "state.reverted"'), "P3-05 undo must append a revert event.");
assert.ok(undo.includes("already been undone"), "P3-05 duplicate undo protection is missing.");
assert.ok(!store.includes("update(projectLedgerEvents)") && !store.includes("delete(projectLedgerEvents)"), "P3-05 Ledger events must remain append-only.");
assert.ok(panel.includes("Undo") && panel.includes("Verify integrity"), "P3-05 undo/integrity UX is missing.");
assert.ok(migration.includes("project_ledger_events_single_revert_unique"), "P3-05 concurrent duplicate Undo must be blocked by the database.");

// P3-06 — data/model/artifact lineage.
for (const kind of ["source", "formula", "engine", "model", "assumption", "provider", "decision", "execution", "session", "artifact", "policy"]) {
  assert.ok(contracts.includes(`"${kind}"`), `P3-06 lineage node kind missing ${kind}.`);
}
for (const relation of ["used", "derived_from", "produced", "changed", "forked_from", "supersedes"]) {
  assert.ok(contracts.includes(`"${relation}"`), `P3-06 lineage relation missing ${relation}.`);
}

// P3-07 — Session/change graph and configuration references.
for (const ref of ["layoutStateRef", "sourcePolicyRef", "strategyRef", "backtestRef", "assumptionRefs", "artifactVersionRefs"]) {
  assert.ok(projectContracts.includes(ref), `P3-07 Session provenance missing ${ref}.`);
}
assert.ok(sessions.includes('"session.forked"') && sessions.includes('eventType: "session.updated"'), "P3-07 Session change events are incomplete.");

// P3-08 — why-changed intelligence.
assert.ok(sessions.includes("explainProjectSessionChange") && sessions.includes("deterministicExplanation"), "P3-08 deterministic change explanation is missing.");
assert.ok(projectRoutes.includes("/explain-change/:otherSessionId"), "P3-08 change-explanation route is missing.");
assert.ok(panel.includes("Why did these Sessions change?"), "P3-08 comparison UX is missing.");

// P3-09 — provider observations, point-in-time metadata, engines, assumptions, artifacts.
for (const term of ["providerObservations", "isoAsOf", "engineRefs", "artifactIdsByReceipt"]) {
  assert.ok(recorder.includes(term), `P3-09 recorder is missing ${term}.`);
}
assert.ok(contracts.includes("assumptions:") && projectContracts.includes("artifactVersionRefs"), "P3-09 assumption/artifact-version references are missing.");

// P3-10 — versioned, credential-free Project/Session portability manifest.
assert.ok(contracts.includes("LIOS_PORTABILITY_MANIFEST_VERSION = 1"), "P3-10 manifest version is missing.");
assert.ok(portability.includes("excludesCredentials: true"), "P3-10 manifest must explicitly exclude credentials.");
assert.ok(portability.includes("resources.map((resource) => resource.id)") && !portability.includes("resource.resourceRef || resource.id"), "P3-10 manifest must not serialize raw resource/provider locators.");
assert.ok(portability.includes("instructionsHash") && portability.includes("activeChats") && portability.includes("titleHash"), "P3-10 Project/chat manifest metadata is incomplete.");
assert.ok(routes.includes("/portability-manifest"), "P3-10 manifest endpoint is missing.");
assert.ok(panel.includes("Portability manifest"), "P3-10 manifest UX is missing.");

// Cross-cutting P3 safety and UX.
assert.ok(store.includes("sanitizeLedgerPayload") && store.includes("[REDACTED]"), "P3 Ledger payloads must be credential-redacted.");
assert.ok(shell.includes("ProjectHome") && projectHome.includes("<ProjectLedgerPanel"), "P3 Project History/Ledger UI is not wired into Project Home.");

console.log("P3 Ledger, reproducibility and change intelligence acceptance: PASS");
