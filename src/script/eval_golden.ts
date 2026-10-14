/**
 * Runs the H0 golden routing set and prints a scorecard.
 *   npm run eval:golden                 print the scorecard
 *   npm run eval:golden -- --write      also store it as evals/baseline/routing-scorecard.json
 */
import fs from "node:fs";
import path from "node:path";
import { buildScorecard, evaluateCase, loadGoldenCases } from "../evals/goldenRouting";
import { loadJourneyCases, runJourney } from "../evals/journeys";

const results = loadGoldenCases().map(evaluateCase);
const card = buildScorecard(results);

console.log(`\nGolden routing scorecard — ${card.passed}/${card.total} passing`);
console.log(`  must_pass  ${card.mustPass.passed}/${card.mustPass.total}`);
console.log(`  known gaps ${card.knownGaps.stillFailing}/${card.knownGaps.total} still failing`);
console.log(`  planning   p50 ${card.planMs.p50} ms · p95 ${card.planMs.p95} ms · max ${card.planMs.max} ms`);
console.log("\nBy category:");
for (const [category, entry] of Object.entries(card.byCategory)) console.log(`  ${category.padEnd(34)} ${entry.passed}/${entry.total}`);
if (card.failures.length) {
  console.log("\nFailing cases:");
  for (const failure of card.failures) console.log(`  [${failure.status}] ${failure.id} "${failure.prompt.slice(0, 70)}"\n      - ${failure.failures.join("\n      - ")}`);
}
if (card.knownGaps.nowPassing.length) console.log(`\nKnown gaps that now pass (promote to must_pass): ${card.knownGaps.nowPassing.join(", ")}`);

const journeys = [];
for (const journey of loadJourneyCases()) journeys.push(await runJourney(journey));
const journeyPassed = journeys.filter((journey) => journey.passed).length;
console.log(`\nJourney scorecard — ${journeyPassed}/${journeys.length} passing (real runtime, fixture tools)`);
for (const journey of journeys) console.log(`  ${journey.passed ? "PASS" : "FAIL"} ${journey.id} ${String(journey.ms).padStart(4)} ms  "${journey.prompt.slice(0, 58)}"${journey.failures.length ? `\n      - ${journey.failures.join("\n      - ")}` : ""}`);

if (process.argv.includes("--write")) {
  const journeyTarget = path.resolve(process.cwd(), "evals", "baseline", "journey-scorecard.json");
  fs.writeFileSync(journeyTarget, `${JSON.stringify({ generatedAt: new Date().toISOString(), total: journeys.length, passed: journeyPassed, journeys }, null, 2)}\n`);
  console.log(`Journey baseline written to ${path.relative(process.cwd(), journeyTarget)}`);
}

if (process.argv.includes("--write")) {
  const target = path.resolve(process.cwd(), "evals", "baseline", "routing-scorecard.json");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(card, null, 2)}\n`);
  console.log(`\nBaseline written to ${path.relative(process.cwd(), target)}`);
}
if (card.mustPass.passed !== card.mustPass.total || journeyPassed !== journeys.length) process.exitCode = 1;
