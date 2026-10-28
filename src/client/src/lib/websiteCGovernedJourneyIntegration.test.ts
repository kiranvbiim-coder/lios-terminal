import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), "utf8");

test("C01 Chat visual uses a fresh exact-version P4 read, suppresses stale cache and rechecks identities", () => {
  const request = read("../../../shared/governedVisualAnswer.ts");
  const view = read("../components/terminal/GovernedVisualAnswer.tsx");
  const artifactOwner = read("./useArtifacts.ts");
  assert.ok(request.includes("requestedRefs.size !== canonicalRefs.size"));
  assert.ok(request.includes("observations.some(({ access }) =>"));
  assert.ok(view.includes("Recheck current source permissions"));
  assert.ok(view.includes("useArtifact(request.artifactId, request.version, true)"));
  assert.ok(view.includes("!artifact.isFetchedAfterMount"));
  assert.ok(view.includes("!loading && !artifact.isError"));
  assert.ok(view.includes("artifact.refetch()"));
  assert.ok(view.includes("resolveGovernedVisualAnswer(request, artifact.data)"));
  assert.ok(artifactOwner.includes('cache: "no-store"'));
  assert.ok(artifactOwner.includes('credentials: "same-origin"'));
  assert.ok(artifactOwner.includes('refetchOnMount: "always"'));
  assert.ok(artifactOwner.includes("signal"));
  assert.ok(!view.includes("createP9Workflow("));
});

test("C02 Scenario input approval has two interactions and one canonical matched-unit action plan", () => {
  const workbench = read("../components/terminal/ScenarioWorkbench.tsx");
  const registry = read("./terminalAssumptionRegistry.ts");
  const review = read("./scenarioBindingReview.ts");
  assert.ok(workbench.includes("Review model input changes"));
  assert.ok(workbench.includes("Confirm apply to model"));
  assert.ok(workbench.includes("inputApplyReviewed"));
  assert.ok(workbench.includes("scenarioBindingReviewKey(active, activeView, activeSymbol, freshPlan)"));
  assert.ok(workbench.includes("const result = applyScenarioToBindings(active"));
  assert.ok(workbench.includes("preview.matched.map("));
  assert.ok(workbench.includes("Skipped {item.assumptionKey}: {item.reason}"));
  assert.ok(registry.includes("registrationVersions.get(match.bindingId) !== match.registrationVersion"));
  assert.ok(registry.includes("const aUnit = assumption.unit"));
  assert.ok(registry.includes("const bUnit = binding.unit"));
  assert.ok(registry.includes("plan.skipped.push"));
  assert.ok(review.includes("plan.matched.length === 0"));
  assert.ok(!workbench.includes("saveIntegratedModelRunArtifact("));
});

test("C03 source-evidence investigation sends only a reviewed, nonexecuting Chat question", () => {
  const project = read("../components/terminal/ProjectInvestigationDesk.tsx");
  const consequence = read("./recordedConsequenceReview.ts");
  const review = read("../components/terminal/ProjectConsequenceReview.tsx");
  assert.ok(project.includes("reviewRecordedConsequences(projectId, validGraph, selected)"));
  assert.ok(project.includes("ProjectConsequenceReview"));
  assert.ok(project.includes("recordedIsoTimestamp(selected.occurredAt)"));
  assert.ok(consequence.includes("Insight source IDs (recorded, not independently verified)"));
  assert.ok(consequence.includes("Traversed edge source IDs (recorded, not independently verified)"));
  assert.ok(consequence.includes("do not run tools, save Artifacts"));
  assert.ok(review.includes("Review path in Chat"));
  assert.ok(review.includes("requires its own user approval"));
  assert.ok(!review.includes("saveIntegratedModelRunArtifact("));
});

test("C04 existing P2 agent approvals and P11 engine receipts remain the only execution/save owners", () => {
  const trace = read("../components/terminal/ConversationRuntimeTrace.tsx");
  const studio = read("../components/panels/IntegratedModelStudioPanel.tsx");
  const receipt = read("./reviewedModelRunArtifact.ts");
  assert.ok(trace.includes('governed_tool_approval_required'));
  assert.ok(trace.includes('data-testid="governed-tool-approval"'));
  assert.ok(trace.includes("reviewInFlight.current"));
  assert.ok(trace.includes('data-testid="trace-agent-receipt-warning"'));
  assert.ok(studio.includes("modelRunReviewKey(model, selectedDestination)"));
  assert.ok(studio.includes("verifiedReopenedModelRun(displayed, reopened)"));
  assert.ok(studio.includes("savedModelArtifactMatchesReceipt(detail, displayed.receipt, request)"));
  assert.ok(studio.includes("saveIntegratedModelRunArtifact(request.runId"));
  assert.ok(receipt.includes("a.deterministic === true && b.deterministic === true"));
  assert.ok(receipt.includes("version.refreshSpec.engineRef.endsWith"));
});
