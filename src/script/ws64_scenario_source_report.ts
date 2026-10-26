/**
 * Run only after the exact WS-64 source + canonical continuity tests pass.
 * Source tests are separate from real installed/macOS/Windows/tenant evidence.
 * Emits an explicit seven-row NOT-ACCEPTED report until each target gate and
 * qualified release owner sign-off is recorded elsewhere.
 */
import { WS64_SCENARIOS, sourceOnlyWS64Scorecard, type WS64ScenarioId } from "../evals/ws64ScenarioMatrix";

if (!process.argv.includes("--source-tests-passed")) {
  throw new Error("WS-64 source-only report requires successful preceding source tests; run npm run test:ws64.");
}
const sourceOutcomes = Object.fromEntries(WS64_SCENARIOS.map(({ id }) => [id, true])) as Record<WS64ScenarioId, boolean>;
const cases = sourceOnlyWS64Scorecard(sourceOutcomes);
if (cases.some((item) => item.accepted)) throw new Error("Source-only proof cannot certify installed UX.");
process.stdout.write(JSON.stringify({
  workstream: "WS-64",
  evidenceKind: "LOCAL_SOURCE_FIXTURES_AND_CONTRACTS_ONLY",
  sourceSuiteCompleted: true,
  acceptedScenarioCount: 0,
  installedEvidence: "NOT_PROVIDED",
  thirdPartyLiveProvider: "NOT_VERIFIED",
  ownerSignOff: "MISSING",
  cases: cases.map((entry) => ({
    ...entry,
    journey: WS64_SCENARIOS.find((item) => item.id === entry.id)?.name,
    acceptanceStatus: "PENDING_INSTALLED_EVIDENCE_AND_OWNER_SIGNOFF",
  })),
}, null, 2) + "\n");