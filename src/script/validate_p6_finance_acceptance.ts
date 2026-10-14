import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { calculatePersonalFinanceSnapshot } from "../server/p6PersonalFinance";
import { planConversationWorkflow } from "../server/conversationRuntime";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/p6FinanceContracts.ts");
const workflow = read("server/p6FinanceWorkflow.ts");
const workflowTests = read("server/p6FinanceWorkflow.test.ts");
const backtest = read("server/p6BacktestEngine.ts");
const backtestTests = read("server/p6BacktestEngine.test.ts");
const risk = read("server/p6RiskFixedDerivatives.ts");
const riskTests = read("server/p6RiskFixedDerivatives.test.ts");
const personal = read("server/p6PersonalFinance.ts");
const runtimeRegistry = read("server/p6RuntimeRegistry.ts");
const conversation = read("server/conversationRuntime.ts");
const conversationTests = read("server/p6ConversationRuntime.test.ts");
const cockpit = read("client/src/lib/backtestCockpit.ts");
const cockpitPanel = read("client/src/components/panels/P6BacktestCockpitPanel.tsx");
const strategyStudio = read("client/src/components/panels/P6StrategyStudioPanel.tsx");
const primaryBacktestPanel = read("client/src/components/panels/BacktestPanel.tsx");
const p6FinanceRoutes = read("server/p6FinanceRoutes.ts");
const projectRoutes = read("server/projectRoutes.ts");
const projectResourceStore = read("server/projectResourceStore.ts");
const personalFinancePanel = read("client/src/components/panels/PersonalFinancePanel.tsx");
const projectPersonalFinancePanel = read("client/src/components/terminal/ProjectPersonalFinancePanel.tsx");
const projectExperienceShell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const terminalWorkspace = read("client/src/lib/terminalWorkspace.ts");
const routeRegistry = read("server/routes.ts");
const indicators = read("client/src/lib/technicalIndicators.ts");
const indicatorTests = read("client/src/lib/p6IndicatorParity.test.ts");
const pptx = read("client/src/lib/exportPptx.ts");
const artifactContracts = read("shared/artifactContracts.ts");
const artifactExport = read("server/artifactExport.ts");
const clientArtifactExport = read("client/src/lib/artifactExport.ts");
const portfolioOptimizer = read("python-service/portfolio_optimization.py");
const derivatives = read("python-service/advanced_derivatives.py");
const fixedIncome = read("python-service/advanced_fixed_income.py");
const requirements = read("python-service/requirements.txt");
const runtimeManifest = read("server/runtimeManifest.ts");
const xbrl = read("server/xbrlFilingsOrg.ts");
const technicalPlan = read("../docs/technical/P6_FINANCE_ENGINE.md");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const thirdParty = JSON.parse(read("../third_party/components.json"));
const components = Array.isArray(thirdParty) ? thirdParty : thirdParty.components;

function hasWorkflow(family: string): boolean {
  return workflow.includes(`family: "${family}"`);
}
function hasRuntime(id: string): boolean {
  return runtimeRegistry.includes(`id: "${id}"`);
}
function component(id: string): any {
  return components.find((item: any) => item.id === id);
}

// P6-01 — company/fundamentals is converged behind the governed finance workflow.
assert.ok(hasWorkflow("company_fundamentals"), "P6-01 company/fundamentals workflow missing.");
assert.ok(workflow.includes("lios.semantic-finance") && workflow.includes("lios.sec-edgar"), "P6-01 semantic/SEC engine convergence missing.");

// P6-02 — valuation remains deterministic and adds candidate-only decision support.
assert.ok(hasWorkflow("valuation") && workflow.includes("lios.valuation.dcf"), "P6-02 valuation workflow missing.");
assert.ok(workflow.includes("buildValuationDecisionSupport") && workflow.includes("candidateOnly: true") && workflow.includes("selectedAlternativeId: null"), "P6-02 governed valuation decision candidates missing.");

// P6-03 — portfolio/risk and rebalancing.
assert.ok(hasWorkflow("portfolio_risk"), "P6-03 portfolio/risk workflow missing.");
assert.ok(workflow.includes("buildPortfolioRebalanceDecision") && workflow.includes("notionalChange") && workflow.includes("approvalRequired: true"), "P6-03 rebalance decision support missing.");

// P6-04 — fixed income / derivatives conversational deterministic artifacts.
assert.ok(hasWorkflow("fixed_income") && hasWorkflow("derivatives"), "P6-04 fixed-income/derivatives workflow convergence missing.");
assert.ok(workflow.includes("quantlib") && workflow.includes("lios.derivatives"), "P6-04 deterministic engine refs missing.");

// P6-05 — macro/FX, alternatives and events.
for (const family of ["macro_fx", "alternative_assets", "corporate_actions_events"]) {
  assert.ok(hasWorkflow(family), `P6-05 missing workflow family ${family}.`);
}

// P6-06 — professional export includes a real PPTX path in addition to existing XLSX/PDF.
assert.ok(artifactContracts.includes('"pptx"'), "P6-06 PPTX export contract missing.");
// Server export formats derive from the shared Artifact export policy (asserted above to include pptx).
assert.ok(artifactExport.includes("artifactExportFormatsForKind") && clientArtifactExport.includes('format === "pptx"'), "P6-06 PPTX artifact export routing missing.");
for (const token of ["ppt/presentation.xml", "ppt/slides/slide", "zipSync", "modelHash", "provenance"]) {
  assert.ok(pptx.includes(token), `P6-06 PPTX OOXML/provenance implementation missing ${token}.`);
}

// P6-07 — capital allocation candidate workflow.
assert.ok(hasWorkflow("capital_allocation") && workflow.includes("rankCapitalAllocationCandidates"), "P6-07 capital allocation workflow missing.");
assert.ok(workflow.includes("candidateOnly: true") && workflow.includes("approvalRequired: true"), "P6-07 capital allocation must remain candidate-only.");

// P6-08 — personal finance and wealth.
assert.ok(hasWorkflow("personal_finance") && personal.includes("calculatePersonalFinanceSnapshot"), "P6-08 personal finance workflow missing.");
for (const token of ["netWorth", "trailingMonthlyCashFlow", "projectDebt", "projectGoal", "projectRetirement"]) {
  assert.ok(personal.includes(token), `P6-08 personal finance capability missing ${token}.`);
}
const personalFinanceFixture = {
  schemaVersion: "1" as const,
  asOf: "2026-09-22",
  accounts: [
    { id: "bank", kind: "bank" as const, balance: 200000, currency: "INR" },
    { id: "loan", kind: "loan" as const, balance: -50000, currency: "INR" },
  ],
  transactions: [
    { id: "salary", at: "2026-09-05", amount: 100000, category: "salary", accountId: "bank" },
    { id: "rent", at: "2026-09-06", amount: -30000, category: "rent", accountId: "bank" },
  ],
  debts: [],
  goals: [],
  retirement: null,
};
const personalFinanceSnapshot = calculatePersonalFinanceSnapshot(personalFinanceFixture);
assert.equal(personalFinanceSnapshot.netWorth, 150000, "P6-08 deterministic net-worth calculation did not execute.");
assert.equal(personalFinanceSnapshot.trailingMonthlyCashFlow, 70000, "P6-08 deterministic cash-flow calculation did not execute.");
assert.equal(personalFinanceSnapshot.engineVersion, "1.1.0", "P6-08 personal-finance engine version did not advance for budget analytics.");
assert.equal(personalFinanceSnapshot.budget.windowMonths, 3, "P6-08 three-month budget window is missing.");
assert.equal(personalFinanceSnapshot.budget.categories[0]?.category, "rent", "P6-08 category budget did not preserve the supplied expense category.");
assert.equal(personalFinanceSnapshot.budget.categories[0]?.expenses, 30000, "P6-08 category budget did not reconcile the supplied expense.");
assert.equal(personalFinanceSnapshot.savingsRateTrend[2]?.savingsRate, 0.7, "P6-08 monthly savings-rate trend did not reconcile the supplied cash flow.");
const personalFinancePlan = planConversationWorkflow({
  requestId: "33333333-3333-4333-8333-333333333333",
  continuationOf: null,
  message: "Show my net worth and cash flow",
  executionMode: "deterministic_first",
  aiDirectApproved: false,
  approvals: [],
  context: { personalFinance: personalFinanceFixture },
});
assert.equal(personalFinancePlan.intent.parameters.workflow, "p6_personal_finance", "P6-08 Conversation Runtime route is not behavioral.");
assert.equal(personalFinancePlan.intent.requiresAI, false, "P6-08 personal finance must not route to AI.");
assert.ok(personalFinancePlan.steps.some((step) => step.componentId === "lios.personal-finance.core-v1"), "P6-08 Conversation Runtime engine step missing.");
assert.ok(p6FinanceRoutes.includes("runP6PersonalFinance") && p6FinanceRoutes.includes("p6-personal-finance"), "P6-08 authenticated personal-finance route missing.");
assert.ok(personalFinancePanel.includes('fetch("/api/finance/p6-personal-finance"'), "P6-08 first-class Workbench Personal Finance surface is not wired to the deterministic route.");
assert.ok(personalFinancePanel.includes("This panel never calls an AI provider.") && !personalFinancePanel.includes("/api/chat"), "P6-08 Workbench Personal Finance surface must remain deterministic and non-chat by default.");
assert.ok(terminalWorkspace.includes('primary: { view: "personalfinance"'), "P6-08 Personal Finance workspace must open the first-class Personal Finance surface.");
assert.ok(projectRoutes.includes("personal-finance-profile") && projectRoutes.includes('kind: "personal_finance_profile"'), "P6-08 Project Personal Finance profile route missing.");
assert.ok(projectRoutes.includes('contextMode: "excluded"') && projectRoutes.includes('setProjectResourceContextMode(ctx(req), resource.id, "excluded")'), "P6-08 saved Personal Finance profile must stay excluded from ambient Project context.");
assert.ok(projectResourceStore.includes("updateProjectResourceMetadata") && projectResourceStore.includes("tenantFilter(ctx)"), "P6-08 profile metadata update must remain tenant-scoped.");
for (const token of ["Personal Finance & Wealth", "Recent transactions", "Debt payoff", "Goals", "Retirement", "Run deterministic snapshot", "Analyze in Project chat"]) {
  assert.ok(projectPersonalFinancePanel.includes(token), `P6-08 Project Personal Finance UX missing ${token}.`);
}
assert.ok(projectPersonalFinancePanel.includes("No transaction observations supplied. LiOS will not invent income or expenses."), "P6-08 Project Personal Finance UX must not synthesize cash-flow observations.");
assert.ok(projectExperienceShell.includes("pendingPersonalFinance") && projectExperienceShell.includes('personalFinance: chatMode === "project"'), "P6-08 explicit Personal Finance Conversation Runtime handoff missing.");
assert.ok(projectExperienceShell.includes("setPendingPersonalFinance(null)") && projectExperienceShell.includes("staged for this one request"), "P6-08 Personal Finance data must be visibly one-request scoped rather than ambient AI context.");

// P6-09 — robust existing optimizer retained; skfolio/CVXPY optional rather than dependency bloat.
for (const token of ["turnoverLimit", "transactionCostBps", "groupConstraints", "meanUncertaintyPct", "covarianceShrinkage", "MeanCVaRRequest"]) {
  assert.ok(portfolioOptimizer.includes(token), `P6-09 existing robust optimizer capability missing ${token}.`);
}
for (const id of ["skfolio", "cvxpy"]) {
  assert.ok(hasRuntime(id), `P6-09 optional runtime candidate missing ${id}.`);
  assert.ok(runtimeRegistry.includes(`id: "${id}"`) && runtimeRegistry.includes("qualified_optional"), `P6-09 ${id} must remain optional.`);
}

// P6-10 — SEC/XBRL primary source stack + EdgarTools, Arelle optional.
assert.ok(requirements.includes("edgartools==5.51.0") && runtimeManifest.includes('id: "research-sec"'), "P6-10 EdgarTools managed runtime missing.");
assert.ok(runtimeRegistry.includes('id: "edgartools"')&&runtimeRegistry.includes('lifecycle: "managed_bundled"')&&runtimeRegistry.includes("bundled: true"), "P6-10 packaged EdgarTools runtime status is not represented honestly.");
assert.ok(xbrl.includes("filings.xbrl.org") && xbrl.includes("GLEIF"), "P6-10 primary-source XBRL path missing.");
assert.ok(hasRuntime("arelle") && runtimeRegistry.includes('id: "arelle"') && runtimeRegistry.includes("qualified_optional"), "P6-10 optional Arelle validation boundary missing.");

// P6-11 — LEAN is optional advanced quant runtime.
assert.ok(hasRuntime("quantconnect-lean") && runtimeRegistry.includes('role: "advanced_backtest"'), "P6-11 LEAN advanced runtime candidate missing.");
assert.ok(runtimeRegistry.includes('id: "quantconnect-lean"') && runtimeRegistry.includes("bundled: false"), "P6-11 LEAN must not be a base dependency.");

// P6-12 — OpenTerminalUI remains governed donor, not a second state/runtime owner.
const otu = component("openterminalui");
assert.ok(otu && otu.bundled === false, "P6-12 OpenTerminalUI donor governance missing.");
assert.ok(technicalPlan.includes("OpenTerminalUI") && technicalPlan.includes("no weaker duplicate finance runtime"), "P6-12 donor assimilation decision missing.");

// P6-13 — robust backtesting.
for (const token of ["pointInTimeRequired", "next_bar_open", "feesBps", "slippageBps", "maxParticipationRate", "runP6ParameterSweep", "runP6WalkForward", "runP6MonteCarlo"]) {
  assert.ok(backtest.includes(token), `P6-13 robust backtesting capability missing ${token}.`);
}
assert.ok(backtestTests.includes("next bar") && backtestTests.includes("point-in-time") && backtestTests.includes("fees and slippage") && backtestTests.includes("out-of-sample test window"), "P6-13 known-answer regression coverage incomplete.");
assert.ok(backtest.includes("evaluationStartIndex")&&backtest.includes("boundedEvaluationStart"), "P6-13 walk-forward warm-up/evaluation boundary missing.");

// P6-14 — risk attribution/contribution and explicit scenario/liquidity stress.
for (const token of ["calculateRiskContribution", "marginalRisk", "componentRisk", "percentContribution", "runPortfolioScenarioStress", "sectorShocks", "currencyShocks", "calculateLiquidityStress", "daysToLiquidate"]) {
  assert.ok(risk.includes(token), `P6-14 risk expansion missing ${token}.`);
}
assert.ok(riskTests.includes("reconciles component risk") && riskTests.includes("liquidity stress"), "P6-14 risk regression tests missing.");

// P6-15 — derivatives breadth plus OI/flow.
for (const token of ["black_scholes_greeks", "implied_volatility", "check_vol_surface_arbitrage"]) {
  assert.ok(derivatives.includes(token), `P6-15 derivatives engine missing ${token}.`);
}
assert.ok(risk.includes("aggregateOptionsFlow") && risk.includes("putCallOpenInterestRatio"), "P6-15 options OI/flow analytics missing.");

// P6-16 — fixed income curves/spreads/key-rate + ladder/cash flow.
for (const token of ["bootstrap_par_curve", "spread_analytics", "key_rate_risk"]) {
  assert.ok(fixedIncome.includes(token), `P6-16 fixed-income engine missing ${token}.`);
}
assert.ok(risk.includes("buildFixedIncomeLadder") && risk.includes("weightedDuration"), "P6-16 ladder/cashflow model missing.");

// P6-17 — LSE backtest donor audited at a pinned commit.
assert.ok(hasRuntime("lse-terminal-backtest"), "P6-17 LSE backtest donor registry missing.");
assert.ok(runtimeRegistry.includes("62c48a5ce6de37a1c115d6270dfd0eee75166d8b"), "P6-17 LSE terminal commit pin missing.");

// P6-18 — LSE/Brue indicator parity is executable.
assert.ok(indicators.includes("Wilder smoothing")&&backtest.includes("p6WilderRsiSeries"), "P6-18 Wilder RSI alignment missing across chart/backtest engines.");
assert.ok(indicatorTests.includes("RSI uses Wilder seed and smoothing") && indicatorTests.includes("SMA and EMA") && indicatorTests.includes("MACD") && backtestTests.includes("Wilder indicator parity contract"), "P6-18 indicator parity known-answer tests missing.");

// P6-19 — ML remains an optional future pack, not base desktop bloat.
assert.ok(technicalPlan.includes("LSE ML remains an optional future Quant/ML Runtime Pack"), "P6-19 ML runtime posture missing.");
assert.ok(!requirements.toLowerCase().includes("torch==") && !requirements.toLowerCase().includes("tensorflow=="), "P6-19 heavy deep-learning dependency leaked into base runtime.");

// P6-20 — Brue is optional behind LiOS Strategy/sandbox contracts.
assert.ok(hasRuntime("brue-language") && runtimeRegistry.includes("a846522fe8af0e11ee7739ef8b6b8a4c0f7922cb"), "P6-20 Brue pinned runtime candidate missing.");
assert.ok(strategyStudio.includes('value="brue"')&&strategyStudio.includes("Brue (optional runtime)")&&strategyStudio.includes("Strategy Studio"), "P6-20 Brue Strategy Studio surface missing.");
for (const token of ["sandboxed", "externalSideEffects", "brokerAccess", "credentialAccess"]) {
  assert.ok(read("client/src/lib/backtestCockpit.ts").includes(token), `P6-20 Strategy sandbox state missing ${token}.`);
}

// P6-21 — portable strategy -> backtest -> draft execution intent; no implicit side effect.
assert.ok(contracts.includes("p6ExecutionIntentSchema") && contracts.includes("externalExecutionPerformed") && contracts.includes("approvalRequired"), "P6-21 execution-intent contract missing.");
assert.ok(workflow.includes("buildGovernedExecutionIntent") && workflow.includes("No broker order is sent by P6"), "P6-21 governed execution-intent bridge missing.");
assert.ok(workflowTests.includes("externalExecutionPerformed") && workflowTests.includes('state, "draft"'), "P6-21 execution-intent safety test missing.");

// P6-22 — regression suite covers timing/PIT/costs/reproducibility/indicator/safety.
for (const token of ["reproducibility", "liquidity", "walk-forward", "Monte Carlo"]) {
  assert.ok(backtestTests.includes(token), `P6-22 backtest regression coverage missing ${token}.`);
}
assert.ok(indicatorTests.includes("parity") && conversationTests.includes("deterministic backtest"), "P6-22 parity/conversation regression coverage missing.");

// P6-23 — BacktestEngine/reproducibility abstraction.
for (const token of ["p6BacktestRequestSchema", "p6BacktestResultSchema", "reproducibilityHash", "reproducibilityId"]) {
  assert.ok(contracts.includes(token) || backtest.includes(token), `P6-23 canonical backtest contract missing ${token}.`);
}
assert.ok(backtest.includes('engineId: ENGINE_ID') && backtest.includes('ENGINE_ID = "lios.backtest.core-v1"'), "P6-23 LiOS BacktestEngine identity missing.");

// P6-24 — Backtest Kit donor is pinned/optional.
assert.ok(hasRuntime("backtest-kit") && runtimeRegistry.includes("599d990204cd7bfb44ba61c973cc3f742ea43861"), "P6-24 Backtest Kit pin missing.");
assert.ok(runtimeRegistry.includes("Benchmarked/donor reference behind the LiOS BacktestEngine boundary"), "P6-24 Backtest Kit boundary missing.");

// P6-25 — LEAN uses same LiOS-owned boundary; no state ownership.
assert.ok(technicalPlan.includes("LEAN remains behind the same conceptual BacktestEngine boundary"), "P6-25 LEAN boundary decision missing.");
assert.ok(technicalPlan.includes("cannot own Project/Artifact/credential state"), "P6-25 LEAN state ownership boundary missing.");

// P6-26 — Strategy Studio editor choice is independent of sandbox/permission.
assert.ok(strategyStudio.includes("Editor:") && strategyStudio.includes("Run historical simulation") && strategyStudio.includes('readOnly={props.value.sourceLanguage === "rules"}'), "P6-26 Strategy Studio generated-rule boundary missing.");
assert.ok(cockpit.includes('"monaco_optional"') && cockpit.includes('"builtin"') && cockpit.includes("sandboxed: true"), "P6-26 editor/sandbox boundary missing.");
assert.ok(primaryBacktestPanel.includes("P6StrategyStudioPanel")&&primaryBacktestPanel.includes('fetch("/api/finance/p6-backtest"')&&primaryBacktestPanel.includes('data-canonical-engine="lios.backtest.core-v1"'), "P6-26 primary backtesting route is not wired to the canonical server engine.");
assert.ok(!primaryBacktestPanel.includes("function computeRSI")&&!primaryBacktestPanel.includes("function computeMA"), "P6-26 legacy browser-side backtest calculator must not remain primary.");
assert.ok(p6FinanceRoutes.includes("runP6Backtest")&&p6FinanceRoutes.includes('sourceLanguage !== "rules"')&&routeRegistry.includes("registerP6FinanceRoutes(app)"), "P6-26 governed P6 finance route registration/runtime boundary missing.");

// P6-27 — Backtest Cockpit exposes required professional surfaces.
for (const token of ["equity", "drawdown", "benchmark", "exposure", "trades", "Sharpe", "Sortino", "costs", "reproducibility"]) {
  assert.ok(cockpit.includes(token) || cockpitPanel.includes(token), `P6-27 cockpit surface missing ${token}.`);
}

// P6-28 — lifecycle is explicit and historical simulation cannot look live.
for (const state of ["edited_not_run", "running", "completed", "failed", "stale"]) {
  assert.ok(contracts.includes(`"${state}"`) || cockpit.includes(`"${state}"`), `P6-28 lifecycle state missing ${state}.`);
}
assert.ok(cockpit.includes("isHistoricalSimulation: true") && cockpit.includes("livePerformance: false"), "P6-28 live-vs-backtest distinction missing.");

// P6-29 — expanded user-owned personal finance/wealth.
for (const token of ["accounts", "transactions", "debts", "goals", "retirement"]) assert.ok(contracts.includes(token), `P6-29 contract missing ${token}.`);
assert.ok(personal.includes("projectRetirement") && personal.includes("fundingGap"), "P6-29 retirement/goal monitoring missing.");

// P6-30 — deterministic finance remains calculator of record.
assert.ok(workflow.includes("assertP6CalculatorOfRecord") && workflow.includes("AI-derived output cannot replace"), "P6-30 calculator-of-record guard missing.");
assert.ok(conversation.includes('requiresAI: false') && conversation.includes('workflow: "p6_backtest"'), "P6-30 Conversation Runtime deterministic backtest routing missing.");
assert.ok(conversationTests.includes("never routes a backtest to AI"), "P6-30 deterministic conversation regression test missing.");

// Canonical roadmap must contain one table task row per ID and no duplicate task meanings.
for (let id = 1; id <= 30; id += 1) {
  const taskId = "LIOS-P6-" + String(id).padStart(2, "0");
  const rowPattern = new RegExp("\\|\\s*" + taskId.replaceAll("-", "\\-") + "\\s*\\|", "g");
  const matches = roadmap.match(rowPattern) ?? [];
  assert.equal(matches.length, 1, `P6 roadmap must contain exactly one canonical table row for ${taskId}; found ${matches.length}.`);
  assert.ok(technicalPlan.includes(taskId), `P6 technical source of truth missing ${taskId}.`);
}

console.log("P6 Finance Engine & Robust Analytics acceptance P6-01…P6-30: PASS");
