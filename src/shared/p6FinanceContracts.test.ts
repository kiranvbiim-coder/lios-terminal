import test from "node:test";
import assert from "node:assert/strict";
import {
  p6BacktestRequestSchema,
  p6ExecutionIntentSchema,
  p6FinanceWorkflowDescriptorSchema,
  p6PersonalFinanceRequestSchema,
  p6RuntimeCandidateSchema,
} from "./p6FinanceContracts";

test("P6 backtest contract preserves explicit execution and PIT assumptions", () => {
  const parsed = p6BacktestRequestSchema.parse({
    schemaVersion: "1",
    strategy: { schemaVersion: "1", id: "s", name: "S", kind: "buy_and_hold", parameters: {}, sourceLanguage: "rules", source: "enter" },
    instrumentRef: "listing:test",
    bars: [
      { at: "2026-01-01T00:00:00.000Z", open: 100, high: 101, low: 99, close: 100.5, volume: 1000, availableAt: "2026-01-01T00:00:00.000Z" },
      { at: "2026-01-02T00:00:00.000Z", open: 101, high: 102, low: 100, close: 101.5, volume: 1000, availableAt: "2026-01-02T00:00:00.000Z" },
      { at: "2026-01-03T00:00:00.000Z", open: 102, high: 103, low: 101, close: 102.5, volume: 1000, availableAt: "2026-01-03T00:00:00.000Z" },
    ],
  });
  assert.equal(parsed.assumptions.execution, "next_bar_open");
  assert.equal(parsed.assumptions.pointInTimeRequired, true);
  assert.equal(parsed.assumptions.seed, 20260922);
});

test("P6 execution intent cannot represent an implicit broker side effect", () => {
  const parsed = p6ExecutionIntentSchema.parse({
    schemaVersion: "1",
    strategyRef: "strategy:test",
    backtestReproducibilityHash: "a".repeat(64),
    instrumentRef: "listing:test",
    side: "hold",
    state: "draft",
    approvalRequired: true,
    externalExecutionPerformed: false,
  });
  assert.equal(parsed.approvalRequired, true);
  assert.equal(parsed.externalExecutionPerformed, false);
  assert.throws(() => p6ExecutionIntentSchema.parse({ ...parsed, externalExecutionPerformed: true }));
});

test("P6 personal-finance and workflow contracts keep source policy explicit", () => {
  const personal = p6PersonalFinanceRequestSchema.parse({ schemaVersion: "1", asOf: "2026-09-22" });
  assert.deepEqual(personal.accounts, []);
  const workflow = p6FinanceWorkflowDescriptorSchema.parse({
    family: "personal_finance",
    deterministic: true,
    artifactKind: "decision",
    engineRefs: ["lios.personal-finance.core-v1"],
    supportsConversation: true,
    supportsRerun: true,
    supportsExport: true,
    sourcePolicy: "user_owned_data",
  });
  assert.equal(workflow.sourcePolicy, "user_owned_data");
});

test("P6 optional runtime contract requires an explicit lifecycle and active state", () => {
  const runtime = p6RuntimeCandidateSchema.parse({
    id: "example",
    role: "advanced_backtest",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "MIT",
    upstreamCommit: "a".repeat(40),
    active: false,
  });
  assert.equal(runtime.lifecycle, "qualified_optional");
  assert.equal(runtime.active, false);
});


test("P6 runtime contract distinguishes managed bundled dependencies from optional packs", () => {
  const managed = p6RuntimeCandidateSchema.parse({
    id: "edgartools",
    role: "filing_parser",
    lifecycle: "managed_bundled",
    bundled: true,
    license: "MIT",
    upstreamCommit: "a".repeat(40),
    active: true,
  });
  assert.equal(managed.lifecycle, "managed_bundled");
  assert.equal(managed.bundled, true);
});
