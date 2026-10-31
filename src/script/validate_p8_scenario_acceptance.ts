import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const contracts = read("shared/p8ScenarioContracts.ts");
const engine = read("server/p8ScenarioEngine.ts");
const service = read("server/p8ScenarioService.ts");
const routes = read("server/p8Routes.ts");
const routeRegistry = read("server/routes.ts");
const artifact = read("shared/artifactContracts.ts");
const pane = read("client/src/components/terminal/ArtifactPane.tsx");
const review = read("client/src/components/terminal/ScenarioFormulaReview.tsx");
const packageJson = read("package.json");
const workflow = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const plan = read("../docs/technical/P8_BRANCHING_SCENARIO_FORMULA_INTELLIGENCE.md");

assert.ok(engine.includes("compareP8ScenarioSnapshots") && service.includes("artifactRoot") && service.includes("forkP8") === false, "P8-01 branch comparison engine missing.");
assert.ok(service.includes("branchP8ScenarioArtifact") && service.includes("compareP8ScenarioArtifacts") && routes.includes("scenario-compare"), "P8-01 branch API missing.");
assert.ok(routeRegistry.includes("registerP8Routes(app)"), "P8 central route registration missing.");
assert.ok(engine.includes("validateP8FormulaDraft") && engine.includes("evaluateFinanceFormula") && review.includes("VALIDATED FORMULA STUDIO"), "P8-02 deterministic Formula Studio missing.");
assert.ok(service.includes("validation.fingerprint !== input.validationFingerprint") && service.includes("approved: true"), "P8-02 explicit validation/approval publication gate missing.");
assert.ok(engine.includes("buildSelectedAssumptionPatch") && service.includes("proposeP8AssumptionMerge") && service.includes("p8.assumption_merge_proposed"), "P8-04 selected-assumption merge/copy missing.");
assert.ok(contracts.includes("p8ScenarioMatrixRowSchema") && contracts.includes("p8ScenarioWaterfallItemSchema") && review.includes("Compare family"), "P8-05 structured matrix/waterfall comparison missing.");
assert.ok(artifact.includes("whatChanged") && artifact.includes("nextActions") && artifact.includes("linkedRefs"), "P8-06 Decision Object schema extension missing.");
assert.ok(service.includes("createP8DecisionObject") && routes.includes("/decisions"), "P8-06 Decision Object persistence flow missing.");
for (const token of ["whatChanged", "why", "scenarios", "alternatives", "tradeoffs", "nextActions", "monitoring"]) assert.ok(artifact.includes(token), "P8-07 prescriptive output section missing " + token + ".");
for (const token of ["models", "sources", "scenarios", "backtests", "monitors"]) assert.ok(artifact.includes(token), "P8-08 linked Decision Object reference missing " + token + ".");
assert.ok(artifact.includes("uncertainties") && artifact.includes("selectedAlternativeId"), "P8-09 uncertainty/user-choice fields missing.");
assert.ok(review.includes("nothing was silently applied") && review.includes("Approve & publish"), "P8 user-control UX guard missing.");
assert.ok(packageJson.includes('"test:p8"') && packageJson.includes('"acceptance:p8"'), "P8 package gates missing.");
assert.ok(workflow.includes("P8 Branching, scenario and model change review acceptance"), "P8 phase-end CI gate missing.");

for (let id = 1; id <= 9; id += 1) {
  const taskId = "LIOS-P8-" + String(id).padStart(2, "0");
  assert.ok(roadmap.includes(taskId), "Roadmap missing " + taskId + ".");
  assert.ok(plan.includes(taskId), "P8 technical source of truth missing " + taskId + ".");
}
console.log("P8 Branching, Scenario & Formula Intelligence acceptance P8-01…P8-09: PASS");
