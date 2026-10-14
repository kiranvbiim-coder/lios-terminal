import assert from "node:assert/strict";
import test from "node:test";
import {
  buildP6ContinuitySnapshot,
  decisionMemoryFromArtifact,
} from "./p6ProjectContinuity";
import type { P6AutomationSummary } from "@shared/p6ContinuityContracts";
import type { P7ContextGraph, P7InsightLens } from "@shared/p7ResearchContracts";

const graph: P7ContextGraph = {
  schemaVersion: "1",
  projectId: 7,
  generatedAt: "2026-09-26T10:00:00.000Z",
  contentHash: "a".repeat(64),
  nodes: [{
    id: "project:7",
    kind: "project",
    label: "Apple research",
    sourceRef: "7",
    occurredAt: null,
    contentHash: null,
    metadata: {},
  }],
  edges: [],
};

const insightLens: P7InsightLens = {
  schemaVersion: "1",
  projectId: 7,
  generatedAt: "2026-09-26T10:00:00.000Z",
  insights: [{
    id: "question:1",
    kind: "open_question",
    title: "Resolve margin assumption",
    summary: "The margin assumption remains explicitly unresolved.",
    severity: "watch",
    sourceRefs: ["artifact:valuation"],
    entityRefs: ["AAPL"],
    deterministic: true,
    occurredAt: null,
  }],
  counts: { open_question: 1 },
};

function decision(selected = false) {
  return decisionMemoryFromArtifact({
    artifact: {
      id: "artifact:decision-1",
      title: "Capital allocation",
      headVersion: 2,
      updatedAt: "2026-09-26T10:00:00.000Z",
    },
    version: {
      version: 2,
      content: {
        kind: "decision",
        objective: "Choose the capital allocation path.",
        whatChanged: [],
        why: [],
        scenarios: [],
        constraints: ["Preserve liquidity"],
        assumptions: { wacc: 0.09 },
        alternatives: [{ id: "buyback", label: "Buyback", expectedOutcomes: [], risks: [], tradeoffs: [] }],
        selectedAlternativeId: selected ? "buyback" : null,
        uncertainties: [],
        nextActions: ["Review board capacity"],
        implementation: [],
        monitoring: ["Revisit if leverage exceeds threshold"],
        linkedRefs: { models: [], sources: ["filing:10-k"], scenarios: [], backtests: [], monitors: [] },
      },
      sourceRefs: ["filing:10-k"],
      dependencyRefs: ["artifact:valuation"],
    },
  });
}

const failedAutomation: P6AutomationSummary = {
  workflowId: "workflow:1",
  name: "Valuation refresh",
  template: "valuation_refresh",
  enabled: true,
  triggerType: "event",
  actionKind: "conversation_rerun",
  nextRunAt: null,
  lastRunAt: "2026-09-26T09:00:00.000Z",
  lastFailureAt: "2026-09-26T09:00:00.000Z",
  consecutiveFailures: 2,
  latestRunStatus: "failed",
  latestRunSummary: "Provider unavailable.",
  sourceRefs: ["provider:market"],
  engineRefs: ["lios.valuation"],
  artifactRefs: ["artifact:valuation"],
};

test("active P6 composes Project graph, Decision memory and automation without a second persisted state model", () => {
  const result = buildP6ContinuitySnapshot({
    projectId: 7,
    generatedAt: "2026-09-26T12:00:00.000Z",
    dependencies: { projectId: 7, projectName: "Apple research", chats: 2, resources: 3, sessions: 1, artifacts: 4, total: 10 },
    intelligenceGraph: graph,
    delta: {
      schemaVersion: "1",
      projectId: 7,
      fromSnapshotId: "snapshot:before",
      toSnapshotId: "snapshot:after",
      added: [{ id: "doc:1", sourceType: "filing", sourceRef: "filing:new", title: "10-Q", contentHash: "b".repeat(64), occurredAt: null }],
      removed: [],
      changed: [],
    },
    insightLens,
    sessions: [{ sessionId: "session:bull", name: "Bull case", status: "active", chatId: 11, parentSessionId: "session:root", updatedAt: "2026-09-26T11:00:00.000Z", sourcePolicyRef: "policy:auto", strategyRef: null, backtestRef: null, assumptionRefs: ["assumption:wacc"], artifactVersionRefs: ["artifact:valuation@v2"] }, { sessionId: "session:root", name: "Base case", status: "active", chatId: 11, parentSessionId: null, updatedAt: "2026-09-26T10:00:00.000Z", sourcePolicyRef: "policy:auto", strategyRef: null, backtestRef: null, assumptionRefs: ["assumption:wacc"], artifactVersionRefs: ["artifact:valuation@v2"] }],
    decisions: [decision(false)],
    automations: [failedAutomation],
    unreadChangeNotification: true,
  });

  assert.equal(result.counts.sessions, 2);
  assert.equal(result.counts.branchedSessions, 1);
  assert.equal(result.counts.decisions, 1);
  assert.equal(result.counts.activeAutomations, 1);
  assert.equal(result.counts.failedAutomations, 1);
  assert.equal(result.changeSummary?.added, 1);
  assert.ok(result.graph.nodes.some((node) => node.kind === "session"));
  assert.ok(result.graph.edges.some((edge) => edge.type === "branches_from"));
  assert.ok(result.graph.edges.some((edge) => edge.type === "references" && edge.from.includes("session:bull")));
  assert.equal(result.graph.nodes.find((node) => node.id === "session:root")?.label, "Base case");
  assert.equal(result.graph.nodes.some((node) => node.id.startsWith("session:session:")), false);
  assert.ok(result.graph.nodes.some((node) => node.kind === "decision"));
  assert.ok(result.graph.nodes.some((node) => node.kind === "automation"));
  assert.ok(result.graph.nodes.some((node) => node.kind === "monitor"));
  assert.ok(result.continuationQueue.some((item) => item.kind === "review_change"));
  assert.ok(result.continuationQueue.some((item) => item.kind === "complete_decision"));
  assert.ok(result.continuationQueue.some((item) => item.kind === "automation_failed"));
  assert.ok(result.continuationQueue.some((item) => item.kind === "open_question"));
});

test("historical source deltas stay informational after the change notification is read", () => {
  const result = buildP6ContinuitySnapshot({
    projectId: 7,
    generatedAt: "2026-09-26T12:00:00.000Z",
    dependencies: { projectId: 7, projectName: "Apple research", chats: 0, resources: 0, sessions: 0, artifacts: 0, total: 0 },
    intelligenceGraph: graph,
    delta: {
      schemaVersion: "1",
      projectId: 7,
      fromSnapshotId: "snapshot:before",
      toSnapshotId: "snapshot:after",
      added: [{ id: "doc:1", sourceType: "filing", sourceRef: "filing:new", title: "10-Q", contentHash: "b".repeat(64), occurredAt: null }],
      removed: [],
      changed: [],
    },
    sessions: [],
    insightLens: { ...insightLens, insights: [], counts: {} },
    decisions: [],
    automations: [],
    unreadChangeNotification: false,
  });
  assert.equal(result.changeSummary?.added, 1);
  assert.equal(result.continuationQueue.some((item) => item.kind === "review_change"), false);
});

test("selected decisions with explicit monitoring surface a deterministic monitor-link gap", () => {
  const result = buildP6ContinuitySnapshot({
    projectId: 7,
    generatedAt: "2026-09-26T12:00:00.000Z",
    dependencies: { projectId: 7, projectName: "Apple research", chats: 0, resources: 0, sessions: 0, artifacts: 1, total: 1 },
    intelligenceGraph: graph,
    delta: null,
    sessions: [],
    insightLens: { ...insightLens, insights: [], counts: {} },
    decisions: [decision(true)],
    automations: [],
  });
  assert.ok(result.continuationQueue.some((item) => item.kind === "configure_monitor"));
  assert.equal(result.counts.unresolvedDecisions, 0);
});

test("P6 continuity fingerprint is stable when only generatedAt changes", () => {
  const common = {
    projectId: 7,
    dependencies: { projectId: 7, projectName: "Apple research", chats: 0, resources: 0, sessions: 0, artifacts: 0, total: 0 },
    intelligenceGraph: graph,
    delta: null,
    sessions: [],
    insightLens: { ...insightLens, insights: [], counts: {} },
    decisions: [],
    automations: [],
  };
  const left = buildP6ContinuitySnapshot({ ...common, generatedAt: "2026-09-26T12:00:00.000Z" });
  const right = buildP6ContinuitySnapshot({ ...common, generatedAt: "2026-09-26T13:00:00.000Z" });
  assert.equal(left.fingerprint, right.fingerprint);
});
