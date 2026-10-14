import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/p5ProfessionalContracts.ts");
const conversationContracts = read("shared/conversationRuntime.ts");
const workflow = read("server/p5ProfessionalWorkflow.ts");
const execution = read("server/p5ProfessionalExecution.ts");
const resolver = read("server/conversationCapabilityResolver.ts");
const runtime = read("server/conversationRuntime.ts");
const quant = read("server/advancedQuantExecution.ts");
const quantRegistry = read("server/quantModelRegistry.ts");
const artifactContracts = read("shared/artifactContracts.ts");
const artifactExport = read("server/artifactExport.ts");
const personalFinance = read("server/p6PersonalFinance.ts");
const orchestrationTests = read("server/conversationCapabilityOrchestration.test.ts");
const workflowTests = read("server/p5ProfessionalWorkflow.test.ts");
const executionTests = read("server/p5ProfessionalExecution.test.ts");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const architecture = read("../docs/LIOS_ARCHITECTURE.md");

for (const family of [
  "company_research",
  "company_fundamentals",
  "valuation",
  "portfolio_risk",
  "fixed_income",
  "derivatives",
  "macro_fx",
  "research_reporting",
  "personal_finance",
]) {
  assert.ok(contracts.includes(`"${family}"`), `P5 professional family missing: ${family}`);
}
for (const capability of [
  "company.research",
  "company.fundamentals",
  "company.valuation",
  "financial_modeling.three_statement",
  "portfolio.risk",
  "fixed_income.analytics",
  "derivatives.analytics",
  "macro_fx.analytics",
  "research.report",
]) {
  assert.ok(conversationContracts.includes(`"${capability}"`), `P5 capability missing from Conversation Runtime contract: ${capability}`);
}

for (const pathToken of [
  "valuation/reverse-dcf",
  "valuation/residual-income",
  "valuation/eva",
  "valuation/sotp",
  "financial-modeling/three-statement",
  "portfolio/black-litterman",
  "portfolio/hrp",
  "risk/liquidity-var",
  "fixed-income/key-rate-risk",
  "fixed-income/callable-oas",
  "derivatives/black-scholes-greeks",
  "derivatives/implied-volatility",
  "derivatives/interest-rate-swap",
  "macro/recession-probability",
  "macro/financial-conditions-index",
  "research/filing-diff",
  "research/evidence-graph",
]) {
  assert.ok(contracts.includes(`"${pathToken}"`), `P5 model path missing: ${pathToken}`);
  assert.ok(quant.includes(`"${pathToken}"`), `P5 model path is not executable through Advanced Quant: ${pathToken}`);
}

assert.ok(workflow.includes("resolveP5ProfessionalIntents"), "P5 professional intent resolver is missing.");
assert.ok(workflow.includes("extractP5JsonObject"), "P5 explicit structured input parsing is missing.");
assert.ok(workflow.includes("p5InputsFromArtifact"), "P5 governed Artifact rerun input recovery is missing.");
assert.ok(workflow.includes("p5AdvancedPathFromEngineRef"), "P5 Artifact replay cannot recover engine identity.");
assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(workflow), "P5 workflow contains invalid control characters.");
assert.ok(!/[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(execution), "P5 execution contains invalid control characters.");

assert.ok(resolver.includes("resolveP5ProfessionalIntents"), "Conversation capability resolver is not wired to P5.");
assert.ok(resolver.includes('missingInputs') && resolver.includes('"professional_model"'), "P5 readiness must name missing professional model inputs.");
assert.ok(resolver.includes('"structured_model_inputs_or_active_artifact"'), "P5 must require explicit structured inputs or a governed Artifact.");
assert.ok(resolver.includes("p5OwnsCompanyJourney"), "P5 company workflows must suppress duplicate legacy security-overview routing.");
assert.ok(resolver.includes("sourceScopeCompatible"), "P5 capability readiness must preserve source-scope compatibility.");

assert.ok(runtime.includes('workflow: "p5_professional_bundle"'), "P5 professional bundle planner is missing.");
assert.ok(runtime.includes('id: "lios.company-intelligence"'), "P5 company-intelligence governed tool boundary is missing.");
assert.ok(runtime.includes('invokeConversationTool("lios.company-intelligence"'), "P5 company research must execute company intelligence through the governed tool registry.");
assert.ok(runtime.includes("executeP5ProfessionalBundle"), "P5 professional bundle executor is missing.");
assert.ok(runtime.includes("executeAdvancedQuant"), "P5 advanced model execution is not wired to deterministic engines.");
assert.ok(runtime.includes("resolve-security"), "P5 flagship workflows must resolve canonical identity.");
assert.ok(runtime.includes("retrieve-market-data"), "P5 company research must reuse governed market data.");
assert.ok(runtime.includes("retrieve-financial-statements"), "P5 company research must resolve multi-provider statements.");
assert.ok(runtime.includes("calculate-research-technicals"), "P5 company research must calculate deterministic market analytics.");
assert.ok(runtime.includes("buildP5CompanyResearchArtifact"), "P5 company research Artifact output is missing.");
assert.ok(runtime.includes("buildP5FundamentalsArtifact"), "P5 fundamentals Artifact output is missing.");
assert.ok(runtime.includes("buildP5ResearchReportArtifact"), "P5 research report Artifact output is missing.");
assert.ok(runtime.includes("buildP5AdvancedArtifact"), "P5 advanced model Artifact output is missing.");
assert.ok(runtime.includes("buildP5ReportFromArtifact"), "P5 report-from-Artifact output is missing.");
assert.ok(runtime.includes("analyticalRecalculation: false"), "Professional report assembly must not silently recalculate source Artifacts.");
assert.ok(runtime.includes("artifactRefreshSpecSchema"), "P5 Artifact reruns must preserve P4 governed replay metadata.");
assert.ok(runtime.includes("version.dependencyRefs"), "P5 Artifact reruns must preserve P4 dependency lineage.");
assert.ok(runtime.includes("Math.min(50, Math.max(12, steps.length + 2))"), "P5 multi-engine plans must scale the bounded workflow-step budget.");

assert.ok(execution.includes("inputSnapshotHash"), "P5 advanced Artifact output must retain deterministic input hashes.");
assert.ok(execution.includes("outputSnapshotHash"), "P5 advanced Artifact output must retain deterministic output hashes.");
assert.ok(execution.includes("validationLevel"), "P5 advanced Artifact output must retain engine validation level.");
assert.ok(execution.includes("buildP5CompanyResearchArtifact"), "P5 company research builder is missing.");
assert.ok(execution.includes("contradictions"), "P5 company research must preserve provider conflicts.");
assert.ok(execution.includes("buildP5ReportFromArtifact"), "P5 professional reporting builder is missing.");
assert.ok(execution.includes("does not recalculate or reinterpret deterministic outputs"), "P5 reporting must preserve calculator-of-record authority.");
assert.ok(contracts.includes("p5ReconciliationSchema"), "P5 deterministic reconciliation contract is missing.");
assert.ok(contracts.includes("p5ProfessionalExportProfileSchema"), "P5 professional export-profile contract is missing.");
assert.ok(execution.includes("professionalReconciliation"), "P5 professional Artifacts must embed deterministic reconciliation metadata.");
assert.ok(execution.includes("professionalExport"), "P5 professional Artifacts must embed the canonical export profile.");
assert.ok(execution.includes("p5AdvancedReconciliation"), "P5 advanced model Artifacts must reconcile directly to deterministic engine receipt hashes.");

assert.ok(quant.includes("inputSnapshotHash") && quant.includes("outputSnapshotHash"), "Advanced Quant deterministic receipt hashes are missing.");
assert.ok(quantRegistry.includes("validationLevel"), "Quant model registry validation metadata is missing.");
assert.ok(artifactContracts.includes("trustManifest") && artifactContracts.includes("dependencyRefs") && artifactContracts.includes("refreshSpec"), "P5 must build on durable P3/P4 trust/replay lineage.");
assert.ok(artifactContracts.includes("ARTIFACT_EXPORT_FORMATS"), "P5 export continuity must reuse a shared Artifact export policy.");
assert.ok(artifactContracts.includes("artifactExportFormatsForKind"), "Shared Artifact export-format resolver is missing.");
assert.ok(artifactExport.includes("artifactExportFormatsForKind"), "P4 Artifact export plans must use the shared export-format policy rather than a duplicate table.");
assert.ok(artifactExport.includes("formats: [...artifactExportFormatsForKind"), "Artifact export plans must resolve formats from the shared policy.");
assert.ok(runtime.includes("maybeSynthesizeDeterministicResult"), "P5 AI synthesis must remain downstream of deterministic work.");
assert.ok(runtime.includes("AI synthesis is interpretive; the upstream deterministic LiOS receipts and Artifacts remain authoritative."), "P5 AI synthesis authority boundary is missing.");

assert.ok(runtime.includes("executeP6PersonalFinance"), "P5C must reuse the existing deterministic personal-finance engine instead of creating a parallel calculator.");
assert.ok(personalFinance.includes("calculatePersonalFinanceSnapshot"), "Deterministic personal-finance calculator is missing.");
assert.ok(runtime.includes("LiOS will not invent accounts, transactions, debts, goals or retirement assumptions."), "P5C personal finance must expose explicit input gaps.");
assert.ok(runtime.includes("personalFinanceReconciliation"), "P5C personal-finance Artifact must reconcile to its deterministic runtime receipt.");
assert.ok(runtime.includes("personalFinanceExport"), "P5C personal-finance Artifact must inherit canonical P4 export support.");
assert.ok(runtime.includes("professionalReconciliation: personalFinanceReconciliation"), "P5C personal-finance decision Artifact must persist reconciliation metadata.");
assert.ok(runtime.includes("professionalExport: personalFinanceExport"), "P5C personal-finance decision Artifact must persist export metadata.");

assert.ok(orchestrationTests.includes("Research Apple executes shared identity, market, statements and trusted Artifacts end to end"), "P5 flagship company journey end-to-end regression test is missing.");
assert.ok(orchestrationTests.includes('capture.identityInput, { name: "Apple" }'), "P5 natural company-name identity regression test is missing.");
assert.ok(orchestrationTests.includes("generic valuation remains a visible readiness workflow"), "P5 valuation no-guessing planner regression is missing.");
assert.ok(orchestrationTests.includes("explicit derivatives model becomes a deterministic professional run plus Artifact step"), "P5 cross-asset professional planner regression is missing.");
assert.ok(workflowTests.includes("P5 routes named institutional model families"), "P5 professional family routing tests are missing.");
assert.ok(workflowTests.includes("advanced rerun recovers model path and assumptions"), "P5 Artifact rerun recovery test is missing.");
assert.ok(executionTests.includes("professional model registry only exposes executable advanced-quant paths"), "P5 model registry/execution parity test is missing.");
assert.ok(executionTests.includes("versionable Valuation Artifact with deterministic receipt lineage"), "P5 deterministic Artifact lineage test is missing.");
assert.ok(executionTests.includes("report assembly preserves a source Artifact without analytical recalculation"), "P5 report preservation test is missing.");
assert.ok(executionTests.includes("professionalReconciliation"), "P5 deterministic reconciliation regression checks are missing.");
assert.ok(executionTests.includes("p4_artifact_export_plan"), "P5 professional export continuity regression checks are missing.");
assert.ok(orchestrationTests.includes("personal finance Artifact reconciles to its deterministic receipt and canonical P4 exports"), "P5 personal-finance reconciliation/export regression test is missing.");

assert.ok(roadmap.includes("P5 — Professional Intelligence Workflows"), "Canonical roadmap must retain the active P5 phase identity.");
assert.ok(architecture.includes("P5"), "Architecture must document active P5 professional intelligence.");

console.log(JSON.stringify({
  contractVersion: "active-p5-1.0.0",
  flagshipCompanyJourney: true,
  valuationAndModeling: true,
  portfolioRisk: true,
  fixedIncome: true,
  derivatives: true,
  macroFx: true,
  researchReporting: true,
  professionalArtifactExports: true,
  deterministicNumericReconciliation: true,
  personalFinanceContinuity: true,
  personalFinanceArtifactReconciliation: true,
  deterministicCalculatorOfRecord: true,
  artifactTrustReplayContinuity: true,
  noInventedProfessionalInputs: true,
  aiSynthesisDownstreamOnly: true,
}, null, 2));
