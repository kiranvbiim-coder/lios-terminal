import assert from "node:assert/strict";
import test from "node:test";
import { buildScorecard, evaluateCase, loadGoldenCases } from "../evals/goldenRouting";

const cases = loadGoldenCases();
const results = cases.map(evaluateCase);

test("golden routing: every must_pass case still passes", () => {
  const regressions = results.filter((result) => result.status === "must_pass" && !result.passed);
  assert.deepEqual(
    regressions.map((result) => `${result.id} "${result.prompt.slice(0, 60)}": ${result.failures.join("; ")}`),
    [],
  );
});

test("golden routing ratchet: a known_gap that now passes must be promoted to must_pass", () => {
  const fixed = results.filter((result) => result.status === "known_gap" && result.passed).map((result) => result.id);
  assert.deepEqual(fixed, [], `Promote these to must_pass in evals/golden/routing.json: ${fixed.join(", ")}`);
});

test("golden routing: every known_gap documents its reason and the set stays broad", () => {
  for (const golden of cases) if (golden.status === "known_gap") assert.ok(golden.gapReason && golden.gapReason.length > 10, `${golden.id} needs a gapReason`);
  assert.ok(cases.length >= 50, "the golden set must keep at least 50 prompts");
  assert.equal(new Set(cases.map((golden) => golden.id)).size, cases.length, "golden ids must be unique");
});

test("golden routing: planning stays inside the speed budget", () => {
  const card = buildScorecard(results);
  assert.ok(card.planMs.p95 < 50, `planning p95 ${card.planMs.p95} ms exceeds 50 ms`);
});

test("golden routing: unresolved template text is never an entity or plan label", () => {
  const leaks = results.flatMap((result) => result.failures.filter((failure) => failure.startsWith("template text")));
  assert.deepEqual(leaks, []);
});
