import test from "node:test";
import assert from "node:assert/strict";
import { brainApprovalSnapshotHash, buildBrainPlan, canInvokeBrainTool, extractOfficialCatalogQueries, findDownstreamTaskKeys, parseBrainIntent, shouldExecuteBrainTask, stableBrainHash, validateToolResult } from "./brainService";

test("investment intent produces a dependency-safe plan with approval before synthesis", () => {
  const intent = parseBrainIntent("Should we invest in AAPL over the next 12 months under a 20% downside limit?", "AAPL");
  assert.equal(intent.decisionType, "investment");
  assert.deepEqual(intent.entities, ["AAPL"]);
  assert.equal(intent.horizon, "12 months");
  const plan = buildBrainPlan("Should we invest in AAPL?", intent, null);
  assert.deepEqual(plan.find((task) => task.key === "synthesis")?.dependencies, ["approval"]);
  assert.ok(plan.find((task) => task.key === "verify")?.dependencies.includes("consensus"));
});

test("policy intent includes official data and omits market consensus", () => {
  const intent = parseBrainIntent("How would tighter monetary policy affect employment over 2 years?");
  assert.equal(intent.decisionType, "policy");
  const keys = buildBrainPlan("policy question", intent).map((task) => task.key);
  assert.ok(keys.includes("official_data"));
  assert.ok(!keys.includes("consensus"));
});

test("tool permissions enforce both specialist and human role grants", () => {
  assert.equal(canInvokeBrainTool("market.quote", "financial_analyst", "internal_analyst"), true);
  assert.equal(canInvokeBrainTool("market.quote", "policy", "internal_analyst"), false);
  assert.equal(canInvokeBrainTool("synthesis.assemble", "decision_judge", "internal_compliance"), false);
  assert.equal(canInvokeBrainTool("missing", "research", "internal_admin"), false);
});

test("material tool results fail validation without provenance or calculation references", () => {
  assert.deepEqual(validateToolResult({ output: { value: 10 } }), ["missing_provenance_or_deterministic_reference"]);
  assert.deepEqual(validateToolResult({ output: { value: 10 }, deterministicRefs: ["calc:known-answer:v1"] }), []);
  assert.deepEqual(validateToolResult({ output: null, provenance: [{ provider: "SEC" }] }), ["missing_output"]);
});

test("brain hashes are key-order stable and date-sensitive", () => {
  assert.equal(stableBrainHash({ b: 2, a: 1 }), stableBrainHash({ a: 1, b: 2 }));
  assert.notEqual(stableBrainHash({ at: new Date("2026-01-01") }), stableBrainHash({ at: new Date("2026-01-02") }));
});

test("replaying an upstream task invalidates every transitive downstream task", () => {
  const tasks = [
    { taskKey: "research", dependencies: [] },
    { taskKey: "challenge", dependencies: ["research"] },
    { taskKey: "verify", dependencies: ["challenge"] },
    { taskKey: "approval", dependencies: ["verify"] },
    { taskKey: "synthesis", dependencies: ["approval"] },
    { taskKey: "unrelated", dependencies: [] },
  ];
  assert.deepEqual(findDownstreamTaskKeys(tasks, "research"), ["research", "challenge", "verify", "approval", "synthesis"]);
});

test("policy questions map to deterministic official catalog concepts", () => {
  assert.deepEqual(
    extractOfficialCatalogQueries("How would tighter monetary policy affect employment and growth?"),
    ["unemployment", "employment", "gross domestic product", "interest rate", "federal funds"],
  );
  assert.deepEqual(extractOfficialCatalogQueries("What evidence should we review?"), []);
});

test("only explicitly pending tasks execute without an operator retry", () => {
  assert.equal(shouldExecuteBrainTask("pending"), true);
  for (const status of ["completed", "incomplete", "failed", "blocked", "awaiting_approval", "rejected"]) {
    assert.equal(shouldExecuteBrainTask(status), false, status);
  }
});

test("approval snapshots exclude the gate but detect evidence changes", () => {
  const tasks = [
    { id: 1, status: "incomplete", output: { reason: "unavailable" }, deterministicRefs: ["gap:1"] },
    { id: 2, status: "awaiting_approval", output: null, deterministicRefs: [] },
    { id: 3, status: "pending", output: null, deterministicRefs: [] },
  ];
  assert.equal(brainApprovalSnapshotHash(tasks, 2), brainApprovalSnapshotHash(tasks.map((task) => task.id === 2 ? { ...task, status: "completed" } : task), 2));
  assert.notEqual(brainApprovalSnapshotHash(tasks, 2), brainApprovalSnapshotHash(tasks.map((task) => task.id === 1 ? { ...task, output: { reason: "new evidence" } } : task), 2));
});
