import test from "node:test";
import assert from "node:assert/strict";
import { calculatePersonalFinanceSnapshot, projectDebt, projectRetirement } from "./p6PersonalFinance";
import {
  assertP6CalculatorOfRecord,
  buildGovernedExecutionIntent,
  buildPortfolioRebalanceDecision,
  buildValuationDecisionSupport,
  financeWorkflowDescriptor,
  P6_FINANCE_WORKFLOWS,
  rankCapitalAllocationCandidates,
} from "./p6FinanceWorkflow";
import { assertNoOptionalRuntimeLockIn, P6_RUNTIME_CANDIDATES } from "./p6RuntimeRegistry";

test("personal finance computes net worth, trailing cash flow, debt and goals deterministically", () => {
  const result = calculatePersonalFinanceSnapshot({
    schemaVersion: "1",
    asOf: "2026-09-22",
    accounts: [
      { id: "bank", kind: "bank", balance: 200000, currency: "INR" },
      { id: "loan", kind: "loan", balance: -50000, currency: "INR" },
    ],
    transactions: [
      { id: "salary", at: "2026-09-05", amount: 100000, category: "salary", accountId: "bank" },
      { id: "rent", at: "2026-09-06", amount: -30000, category: "rent", accountId: "bank" },
    ],
    debts: [{ id: "education", principal: 100000, annualRate: 0.08, monthlyPayment: 10000, currency: "INR" }],
    goals: [{ id: "goal", targetAmount: 150000, currentAmount: 100000, monthlyContribution: 5000, annualReturnAssumption: 0.06, targetDate: "2027-09-22", currency: "INR" }],
    retirement: {
      currentAge: 35,
      retirementAge: 60,
      currentPortfolio: 1000000,
      monthlyContribution: 25000,
      annualReturnAssumption: 0.08,
      annualInflationAssumption: 0.05,
      annualRetirementSpendingToday: 600000,
      withdrawalRate: 0.04,
    },
  });
  assert.equal(result.netWorth, 150000);
  assert.equal(result.trailingMonthlyCashFlow, 70000);
  assert.equal(result.savingsRate, 0.7);
  assert.equal(result.engineVersion, "1.1.0");
  assert.equal(result.budget.totalExpenses, 30000);
  assert.equal(result.budget.categories[0]?.category, "rent");
  assert.equal(result.savingsRateTrend[result.savingsRateTrend.length - 1]?.savingsRate, 0.7);
  assert.equal(result.deterministic, true);
  assert.match(result.inputHash, /^[a-f0-9]{64}$/);
  assert.equal(result.debt[0].status, "payoff_projected");
  assert.ok(result.retirement);
  assert.equal(result.retirement?.years, 25);
});

test("personal finance summarizes three calendar months by expense category and savings rate", () => {
  const result = calculatePersonalFinanceSnapshot({
    schemaVersion: "1",
    asOf: "2026-09-20",
    accounts: [{ id: "bank", kind: "bank", balance: 0, currency: "INR" }],
    transactions: [
      { id: "old", at: "2026-06-30", amount: -999, category: "ignore", accountId: "bank" },
      { id: "jul-salary", at: "2026-07-01", amount: 1000, category: "salary", accountId: "bank" },
      { id: "jul-rent", at: "2026-07-05", amount: -300, category: "rent", accountId: "bank" },
      { id: "jul-grocery", at: "2026-07-08", amount: -100, category: "groceries", accountId: "bank" },
      { id: "aug-salary", at: "2026-08-01", amount: 1000, category: "salary", accountId: "bank" },
      { id: "aug-rent", at: "2026-08-05", amount: -300, category: "rent", accountId: "bank" },
      { id: "aug-dining", at: "2026-08-12", amount: -200, category: "dining", accountId: "bank" },
      { id: "sep-salary", at: "2026-09-01", amount: 1200, category: "salary", accountId: "bank" },
      { id: "sep-rent", at: "2026-09-05", amount: -300, category: "rent", accountId: "bank" },
      { id: "sep-grocery", at: "2026-09-10", amount: -150, category: "groceries", accountId: "bank" },
      { id: "future", at: "2026-09-21", amount: -777, category: "ignore", accountId: "bank" },
    ],
    debts: [],
    goals: [],
    retirement: null,
  });

  assert.equal(result.budget.windowMonths, 3);
  assert.equal(result.budget.fromMonth, "2026-07");
  assert.equal(result.budget.through, "2026-09-20");
  assert.equal(result.budget.totalExpenses, 1350);
  assert.deepEqual(
    result.budget.categories.map(({ category, expenses, transactionCount }) => ({ category, expenses, transactionCount })),
    [
      { category: "rent", expenses: 900, transactionCount: 3 },
      { category: "groceries", expenses: 250, transactionCount: 2 },
      { category: "dining", expenses: 200, transactionCount: 1 },
    ],
  );
  assert.ok(Math.abs(result.budget.categories[0].shareOfExpenses - 900 / 1350) < 1e-12);
  assert.deepEqual(
    result.savingsRateTrend.map(({ month, income, expenses, cashFlow }) => ({ month, income, expenses, cashFlow })),
    [
      { month: "2026-07", income: 1000, expenses: 400, cashFlow: 600 },
      { month: "2026-08", income: 1000, expenses: 500, cashFlow: 500 },
      { month: "2026-09", income: 1200, expenses: 450, cashFlow: 750 },
    ],
  );
  assert.ok(Math.abs((result.savingsRateTrend[0].savingsRate ?? 0) - 0.6) < 1e-12);
  assert.ok(Math.abs((result.savingsRateTrend[1].savingsRate ?? 0) - 0.5) < 1e-12);
  assert.ok(Math.abs((result.savingsRateTrend[2].savingsRate ?? 0) - 0.625) < 1e-12);
});

test("personal finance emits empty calendar months instead of fabricating observations", () => {
  const result = calculatePersonalFinanceSnapshot({
    schemaVersion: "1",
    asOf: "2026-09-20",
    accounts: [],
    transactions: [{ id: "sep-expense", at: "2026-09-10", amount: -50, category: "fees", accountId: "bank" }],
    debts: [],
    goals: [],
    retirement: null,
  });
  assert.deepEqual(result.savingsRateTrend.slice(0, 2), [
    { month: "2026-07", income: 0, expenses: 0, cashFlow: 0, savingsRate: null },
    { month: "2026-08", income: 0, expenses: 0, cashFlow: 0, savingsRate: null },
  ]);
  assert.equal(result.savingsRateTrend[2].expenses, 50);
});

test("debt projection refuses to pretend an interest-only shortfall can amortize", () => {
  const result = projectDebt({ id: "d", principal: 100000, annualRate: 0.24, monthlyPayment: 1000, currency: "INR" });
  assert.equal(result.status, "payment_insufficient");
  assert.equal(result.payoffMonths, null);
});

test("retirement projection keeps assumptions explicit", () => {
  const result = projectRetirement({
    currentAge: 35,
    retirementAge: 60,
    currentPortfolio: 1000000,
    monthlyContribution: 25000,
    annualReturnAssumption: 0.08,
    annualInflationAssumption: 0.05,
    annualRetirementSpendingToday: 600000,
    withdrawalRate: 0.04,
  });
  assert.equal(result.years, 25);
  assert.ok(result.projectedNominalPortfolio > 1000000);
  assert.ok(result.targetPortfolioAtRetirement > 0);
});

test("P6 workflow registry covers every locked finance family", () => {
  assert.equal(P6_FINANCE_WORKFLOWS.length, 12);
  for (const family of ["valuation", "portfolio_risk", "fixed_income", "derivatives", "capital_allocation", "personal_finance", "strategy_backtest"] as const) {
    const descriptor = financeWorkflowDescriptor(family);
    assert.equal(descriptor.deterministic, true);
    assert.equal(descriptor.supportsConversation, true);
    assert.equal(descriptor.supportsRerun, true);
    assert.equal(descriptor.supportsExport, true);
  }
});

test("valuation decision support produces candidates but never auto-selects or executes", () => {
  const result = buildValuationDecisionSupport({ symbol: "ABC", currentPrice: 100, fairValue: 130, downsideFairValue: 85, upsideFairValue: 150 });
  assert.equal(result.candidateOnly, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.artifact.selectedAlternativeId, null);
  assert.equal(result.preferredCandidateId, "increase_review");
});

test("portfolio rebalance produces notional deltas without order execution", () => {
  const result = buildPortfolioRebalanceDecision({
    portfolioRef: "portfolio:test",
    portfolioValue: 100000,
    holdings: [
      { instrumentRef: "A", currentWeight: 0.7, targetWeight: 0.5 },
      { instrumentRef: "B", currentWeight: 0.3, targetWeight: 0.5 },
    ],
  });
  assert.equal(result.approvalRequired, true);
  assert.ok(Math.abs(result.trades[0].notionalChange + 20000) < 1e-8);
  assert.ok(Math.abs(result.trades[1].notionalChange - 20000) < 1e-8);
  assert.equal(result.artifact.selectedAlternativeId, null);
});

test("capital allocation ranking uses supplied assumptions and remains candidate-only", () => {
  const result = rankCapitalAllocationCandidates({
    availableCapital: 1000000,
    alternatives: [
      { id: "reinvest", label: "Reinvest", expectedReturn: 0.15, riskScore: 0.6, liquidityScore: 0.2, strategicFit: 0.9 },
      { id: "debt", label: "Repay debt", expectedReturn: 0.08, riskScore: 0.1, liquidityScore: 0.1, strategicFit: 0.6 },
    ],
  });
  assert.equal(result.candidateOnly, true);
  assert.equal(result.approvalRequired, true);
  assert.equal(result.candidates.length, 2);
});

test("deterministic calculator-of-record rejects AI-derived substitution", () => {
  assert.doesNotThrow(() => assertP6CalculatorOfRecord({ deterministic: true, aiDerived: false }));
  assert.throws(() => assertP6CalculatorOfRecord({ deterministic: false, aiDerived: true }), /deterministic/);
});

test("optional runtime registry preserves a built-in backtest path and no donor lock-in", () => {
  assert.doesNotThrow(assertNoOptionalRuntimeLockIn);
  assert.ok(P6_RUNTIME_CANDIDATES.some((candidate) => candidate.id === "lios.backtest.core-v1" && candidate.active));
  assert.ok(P6_RUNTIME_CANDIDATES.some((candidate) => candidate.id === "quantconnect-lean" && !candidate.active && !candidate.bundled));
  assert.ok(P6_RUNTIME_CANDIDATES.some((candidate) => candidate.id === "brue-language" && !candidate.active));
});


test("strategy to execution intent remains a draft with no side effect", async () => {
  const { runP6Backtest } = await import("./p6BacktestEngine");
  const start = Date.UTC(2026, 0, 1);
  const bars = Array.from({ length: 5 }, (_, index) => {
    const at = new Date(start + index * 86_400_000).toISOString();
    const price = 100 + index;
    return { at, open: price, high: price + 1, low: price - 1, close: price + 0.5, volume: 100000, availableAt: at };
  });
  const backtest = runP6Backtest({
    schemaVersion: "1",
    strategy: { schemaVersion: "1", id: "s", name: "Buy and hold", kind: "buy_and_hold", parameters: {}, sourceLanguage: "rules", source: "enter" },
    instrumentRef: "TEST",
    bars,
    benchmarkBars: null,
    assumptions: { startingCapital: 10000, feesBps: 0, slippageBps: 0, riskFreeRateAnnual: 0, execution: "next_bar_open", maxParticipationRate: null, pointInTimeRequired: true, seed: 1 },
    sourceRefs: ["test"],
  });
  const intent = buildGovernedExecutionIntent({ backtest, instrumentRef: "TEST", side: "hold" });
  assert.equal(intent.state, "draft");
  assert.equal(intent.approvalRequired, true);
  assert.equal(intent.externalExecutionPerformed, false);
  assert.match(intent.backtestReproducibilityHash, /^[a-f0-9]{64}$/);
});
