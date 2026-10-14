import test from "node:test";
import assert from "node:assert/strict";
import { createScenarioPipelineAttachmentHandler } from "./decisionRoutes";
import { decisionSnapshotHash } from "./decisionEngine";

function response() {
  let statusCode = 200;
  let body: unknown;
  const target = {
    status(code: number) { statusCode = code; return target; },
    json(value: unknown) { body = value; return target; },
  };
  return { target, get status() { return statusCode; }, get body() { return body; } };
}

function pipelineCalculation() {
  const traceWithoutHash = {
    schemaVersion: 1,
    scenario: { id: "downside", name: "Downside", provenance: {} },
    financialDataset: { snapshotId: "dataset-1", contentHash: "dataset-hash", dataClass: "financial_statements", payload: {} },
    models: { baseline: {}, scenario: {}, baselineChecks: {}, scenarioChecks: {} },
    valuation: { inputs: {}, baseline: {}, scenario: {}, delta: -1 },
    factorRisk: { snapshotId: "factor-1", contentHash: "factor-hash", decomposition: {}, derivedAssetImpacts: [] },
    action: { input: {}, result: {}, coverage: {} },
    rankedCandidates: [],
    recommendation: null,
    sourceBindings: {},
    limitations: [],
  };
  const traceHash = decisionSnapshotHash(traceWithoutHash);
  return {
    name: "Scenario-to-action pipeline" as const,
    deterministicRef: `scenario-pipeline:${traceHash}`,
    modelVersion: "scenario-pipeline-v1",
    value: -1,
    scenarioPipelineArtifact: { ...traceWithoutHash, traceHash },
  };
}

function sourceReceipt() {
  const source = {
    id: 11,
    decisionId: 7,
    version: 1,
    snapshotHash: "",
    question: "Should we rebalance?",
    recommendation: "Review the downside.",
    interpretation: "The evidence is mixed.",
    evidence: [], sources: [], assumptions: [{ label: "a" }], calculations: [], models: [], scenarios: [],
    alternatives: [], counterarguments: [], contradictions: [], confidence: {}, monitoringTriggers: [], provenance: [],
    requiredEvidenceCount: 1, completeness: { complete: true }, createdByUserId: 10, createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  const { id: _id, snapshotHash: _snapshotHash, createdAt: _createdAt, ...payload } = source;
  return { ...source, snapshotHash: decisionSnapshotHash(payload) };
}

function setup(overrides: { status?: string; organizationId?: number | null; ownerUserId?: number } = {}) {
  const decision = {
    id: 7, title: "Rebalance", question: "Should we rebalance?", decisionType: "investment", materiality: "material",
    status: overrides.status ?? "review", symbol: null, investigationId: null, brainRunId: null,
    organizationId: overrides.organizationId ?? 3, ownerUserId: overrides.ownerUserId ?? 10,
    finalDecision: null, decisionRationale: null, reviewDate: null, expiresAt: null, approvedReceiptVersionId: null,
    createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
  const source = sourceReceipt();
  const receipts = [source];
  let persistCount = 0;
  const store = {
    async loadDecision() { return decision as never; },
    async loadReceipt() { return receipts[0] as never; },
    async listReceipts() { return receipts as never; },
    async persistAttachment(payload: never) {
      persistCount += 1;
      const created = { ...payload, id: 20 + persistCount, createdAt: new Date() };
      receipts.push(created as never);
      return created as never;
    },
  };
  const req = { params: { id: "7" }, user: { id: 10, role: "internal_analyst", organizationId: 3 }, body: { receiptVersionId: 11, pipelineCalculation: pipelineCalculation() } };
  return { decision, source, receipts, store, req, get persistCount() { return persistCount; } };
}

async function invoke(state: ReturnType<typeof setup>) {
  const output = response();
  await createScenarioPipelineAttachmentHandler(state.store as never, async () => {})(reqWithBody(state.req) as never, output.target as never);
  return output;
}

function reqWithBody(req: ReturnType<typeof setup>["req"]) { return req; }

test("scenario pipeline attachment enforces owner and organization access", async () => {
  const state = setup({ organizationId: 99 });
  const output = await invoke(state);
  assert.equal(output.status, 403);
  assert.equal(state.persistCount, 0);
});

test("scenario pipeline attachment rejects a mismatched trace hash", async () => {
  const state = setup();
  state.req.body.pipelineCalculation = { ...pipelineCalculation(), deterministicRef: "scenario-pipeline:" + "0".repeat(64) };
  const output = await invoke(state);
  assert.equal(output.status, 400);
  assert.equal(state.persistCount, 0);
});

test("scenario pipeline attachment rejects a tampered source receipt", async () => {
  const state = setup();
  state.source.snapshotHash = "0".repeat(64);
  const output = await invoke(state);
  assert.equal(output.status, 409);
  assert.equal(state.persistCount, 0);
});

test("scenario pipeline attachment rejects finalized decisions", async () => {
  const state = setup({ status: "approved" });
  const output = await invoke(state);
  assert.equal(output.status, 409);
  assert.equal(state.persistCount, 0);
});

test("scenario pipeline attachment is idempotent for the same trace hash", async () => {
  const state = setup();
  const first = await invoke(state);
  const second = await invoke(state);
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((second.body as { idempotent?: boolean }).idempotent, true);
  assert.equal(state.persistCount, 1);
});

test("scenario pipeline attachment creates an immutable receipt version", async () => {
  const state = setup();
  const output = await invoke(state);
  assert.equal(output.status, 201);
  const created = state.receipts[1];
  assert.equal(created.version, 2);
  assert.equal(created.decisionId, state.source.decisionId);
  assert.equal(created.recommendation, state.source.recommendation);
  assert.equal(created.assumptions, state.source.assumptions);
  assert.equal(created.calculations.length, 1);
  assert.deepEqual(state.receipts[0].calculations, []);
});
