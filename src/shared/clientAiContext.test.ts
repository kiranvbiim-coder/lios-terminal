import assert from "node:assert/strict";
import test from "node:test";
import { buildClientAiContextInstruction, clientAiContextSchema } from "./clientAiContext";

test("accepts bounded navigation-only Ask LiOS context", () => {
  const parsed = clientAiContextSchema.safeParse({ symbol: "aapl", view: "valuation" });
  assert.equal(parsed.success, true);
});

test("rejects arbitrary context fields and unsafe symbol shapes", () => {
  assert.equal(clientAiContextSchema.safeParse({ symbol: "AAPL;DROP", view: "valuation" }).success, false);
  assert.equal(clientAiContextSchema.safeParse({ symbol: "AAPL", view: "valuation", data: { revenue: 1 } }).success, false);
});

test("context instruction is explicit that navigation metadata is not screen-data access", () => {
  const instruction = buildClientAiContextInstruction({ symbol: "aapl", view: "valuation", asOfDate: "2026-09-19" });
  assert.match(instruction, /active security\/entity: AAPL/);
  assert.match(instruction, /source screen: valuation/);
  assert.match(instruction, /as-known-on date: 2026-09-19/);
  assert.match(instruction, /navigation metadata only/i);
  assert.match(instruction, /Do not claim to see screen values/i);
});

test("missing context produces no extra system instruction", () => {
  assert.equal(buildClientAiContextInstruction(undefined), "");
});
