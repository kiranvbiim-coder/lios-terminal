import assert from "node:assert/strict";
import test from "node:test";
import {
  AdvancedQuantInputError,
  executeAdvancedQuant,
} from "./advancedQuantExecution";

test("advanced quant execution uses injected engine and produces the normal receipt envelope", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const execution = await executeAdvancedQuant(
    "valuation/reverse-dcf",
    { revenue: 100, margin: 0.2 },
    {
      callEngine: async (path, body) => {
        calls.push({ path, body });
        return { impliedGrowth: 0.07, status: "complete" };
      },
      runId: "aqr_dispatch_test",
      calculatedAt: "2026-09-15T06:30:00.000Z",
    },
  );

  assert.deepEqual(calls, [{
    path: "/advanced/valuation/reverse-dcf",
    body: { revenue: 100, margin: 0.2 },
  }]);
  assert.equal(execution.result && (execution.result as Record<string, unknown>).status, "complete");
  assert.equal(execution.receipt.runId, "aqr_dispatch_test");
  assert.equal(execution.receipt.modelPath, "valuation/reverse-dcf");
  assert.equal(execution.receipt.modelId, "python.advanced.valuation.reverse-dcf");
  assert.equal(execution.receipt.dataClassification, "manual");
  assert.equal(execution.receipt.inputProvenance.declaration, "legacy_default");
  assert.equal(execution.headers["X-LIOS-Model-Id"], execution.receipt.modelId);
  assert.equal((execution.response as Record<string, unknown>).status, "complete");
  assert.equal((execution.response as { receipt: { runId: string } }).receipt.runId, "aqr_dispatch_test");
});

test("execution strips provenance metadata before deterministic engine dispatch", async () => {
  let engineBody: unknown;
  await executeAdvancedQuant(
    "valuation/reverse-dcf",
    {
      revenue: 100,
      inputProvenance: {
        dataClassification: "synthetic",
        syntheticContext: "experiment",
        transformations: ["test fixture"],
      },
    },
    {
      callEngine: async (_path, body) => {
        engineBody = body;
        return { ok: true };
      },
    },
  );

  assert.deepEqual(engineBody, { revenue: 100 });
});

test("execution rejects invalid request shape before calling the engine", async () => {
  let called = false;
  await assert.rejects(
    executeAdvancedQuant(
      "valuation/reverse-dcf",
      ["not", "an", "object"],
      {
        callEngine: async () => {
          called = true;
          return {};
        },
      },
    ),
    (error: unknown) => error instanceof AdvancedQuantInputError && error.code === "invalid_body",
  );
  assert.equal(called, false);
});

test("execution rejects source-bound provenance without lineage before engine dispatch", async () => {
  let called = false;
  await assert.rejects(
    executeAdvancedQuant(
      "valuation/reverse-dcf",
      {
        revenue: 100,
        inputProvenance: {
          dataClassification: "live",
          transformations: [],
        },
      },
      {
        callEngine: async () => {
          called = true;
          return {};
        },
      },
    ),
    (error: unknown) => error instanceof AdvancedQuantInputError
      && error.code === "invalid_provenance"
      && /provenance/i.test(error.message),
  );
  assert.equal(called, false);
});

test("DCF sensitivity runs through the canonical receipt path as known-answer validated", async () => {
  const parameters = {
    freeCashFlows: [100, 110, 120],
    waccPct: 10,
    terminalMethod: "gordon_growth",
    terminalGrowthPct: 3,
    netDebt: 50,
    sharesOutstanding: 10,
    waccGridPct: [9, 10, 11],
    terminalGrowthGridPct: [2, 3, 4],
    bearCase: { freeCashFlows: [90, 95, 100], waccPct: 11, terminalMethod: "gordon_growth", terminalGrowthPct: 2 },
    bullCase: { freeCashFlows: [110, 125, 140], waccPct: 9, terminalMethod: "gordon_growth", terminalGrowthPct: 4 },
  };
  const result = {
    base: { valuePerShare: 154.85832349468714 },
    sensitivity: { valuePerShareMatrix: [[157.72079069823367]] },
    scenarios: { bear: { valuePerShare: 100.99879158437717 }, base: { valuePerShare: 154.85832349468714 }, bull: { valuePerShare: 251.28314114973487 } },
  };
  const execution = await executeAdvancedQuant("valuation/dcf-sensitivity", parameters, {
    callEngine: async (path, body) => {
      assert.equal(path, "/advanced/valuation/dcf-sensitivity");
      assert.deepEqual(body, parameters);
      return result;
    },
    runId: "aqr_dcf_known_answer",
    calculatedAt: "2026-10-03T12:00:00.000Z",
  });
  assert.equal(execution.receipt.modelId, "python.advanced.valuation.dcf-sensitivity");
  assert.equal(execution.receipt.validationLevel, "known_answer");
  assert.match(execution.receipt.inputSnapshotHash, /^[a-f0-9]{64}$/);
  assert.match(execution.receipt.outputSnapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(execution.headers["X-LIOS-Validation-Level"], "known_answer");
});
