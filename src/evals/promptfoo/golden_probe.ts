/**
 * Read-only golden routing probe for the optional Promptfoo developer evaluator.
 * Runs LiOS's actual planner on EXISTING, review-owned golden cases.
 * No model calls, network tools, data sources or execution permissions are invoked.
 */
import { evaluateCase, loadGoldenCases } from "../goldenRouting";

const caseId = process.argv[2];
if (!caseId || !/^[A-Z][A-Z0-9]{1,15}$/.test(caseId)) {
  process.stderr.write("Expected one bounded golden case ID.\n");
  process.exit(2);
}
const golden = loadGoldenCases().find((item) => item.id === caseId);
if (!golden || golden.status !== "must_pass") {
  process.stderr.write("Unknown or non-mandatory golden case.\n");
  process.exit(2);
}
const result = evaluateCase(golden);
process.stdout.write(JSON.stringify({
  caseId: result.id,
  passed: result.passed,
  failures: result.failures,
  capabilities: result.capabilities,
  entities: result.entities,
}) + "\n");
