import assert from "node:assert/strict";
import test from "node:test";
import { loadJourneyCases, runJourney } from "../evals/journeys";

const journeys = loadJourneyCases();

test("golden journeys: every must_pass conversation still delivers what the user is owed", async () => {
  const regressions: string[] = [];
  const fixed: string[] = [];
  for (const journey of journeys) {
    const result = await runJourney(journey);
    if (journey.status === "must_pass" && !result.passed) regressions.push(`${result.id} "${result.prompt.slice(0, 50)}": ${result.failures.join("; ")}`);
    if (journey.status === "known_gap" && result.passed) fixed.push(result.id);
  }
  assert.deepEqual(regressions, []);
  assert.deepEqual(fixed, [], `Promote to must_pass in evals/golden/journeys.json: ${fixed.join(", ")}`);
});

test("golden journeys: the harness can fail (negative control)", async () => {
  const research = journeys.find((journey) => journey.id === "JR01");
  assert.ok(research, "JR01 must exist");
  const result = await runJourney({ ...research, id: "NEG", expect: { artifactTypes: ["valuation"], textIncludes: ["not present anywhere"] }, maxMs: 0 });
  assert.equal(result.passed, false);
  assert.ok(result.failures.length >= 3);
});

test("golden journeys: known gaps document their reason and the set covers the flagship paths", () => {
  for (const journey of journeys) if (journey.status === "known_gap") assert.ok(journey.gapReason, `${journey.id} needs a gapReason`);
  const ids = new Set(journeys.map((journey) => journey.id));
  for (const required of ["JR01", "JR02", "JR03", "JR05"]) assert.ok(ids.has(required), `${required} is required`);
});
