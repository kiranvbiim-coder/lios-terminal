import {
  p6PersonalFinanceRequestSchema,
  type P6Debt,
  type P6Goal,
  type P6PersonalFinanceRequest,
  type P6PersonalTransaction,
  type P6RetirementProjectionInput,
} from "@shared/p6FinanceContracts";
import { p6Hash } from "./p6BacktestEngine";
import { projectRetirementStress, type P6RetirementStressResult } from "./p6RetirementStress";
import type { P6FxNormalizedView } from "./p6PersonalFxNormalization";

export interface DebtProjection {
  id: string;
  payoffMonths: number | null;
  totalInterest: number | null;
  status: "payoff_projected" | "payment_insufficient" | "paid";
}

export interface GoalProjection {
  id: string;
  targetAmount: number;
  projectedAmount: number;
  fundingGap: number;
  targetDate: string;
  onTrack: boolean;
}

export interface BudgetCategorySummary {
  category: string;
  expenses: number;
  shareOfExpenses: number;
  transactionCount: number;
}

export interface MonthlySavingsRatePoint {
  month: string;
  income: number;
  expenses: number;
  cashFlow: number;
  savingsRate: number | null;
}

export interface PersonalFinanceBudget {
  windowMonths: 3;
  fromMonth: string;
  through: string;
  totalExpenses: number;
  categories: BudgetCategorySummary[];
}

export interface PersonalFinanceSnapshot {
  engineId: "lios.personal-finance.core-v1";
  engineVersion: "1.1.0";
  deterministic: true;
  asOf: string;
  netWorth: number;
  assets: number;
  liabilities: number;
  trailingMonthlyIncome: number;
  trailingMonthlyExpenses: number;
  trailingMonthlyCashFlow: number;
  savingsRate: number | null;
  budget: PersonalFinanceBudget;
  savingsRateTrend: MonthlySavingsRatePoint[];
  debt: DebtProjection[];
  goals: GoalProjection[];
  retirement: RetirementProjection | null;
  retirementStress?: P6RetirementStressResult;
  fxNormalized?: P6FxNormalizedView;
  inputHash: string;
  warnings: string[];
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

function monthsBetween(fromDate: string, toDate: string): number {
  const from = new Date(fromDate + "T00:00:00.000Z");
  const to = new Date(toDate + "T00:00:00.000Z");
  if (to <= from) return 0;
  return Math.max(0, (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()));
}

function utcMonthStart(date: Date, offsetMonths: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offsetMonths, 1));
}

function utcMonthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function calculateBudgetAnalytics(
  transactions: readonly P6PersonalTransaction[],
  asOf: string,
): { budget: PersonalFinanceBudget; savingsRateTrend: MonthlySavingsRatePoint[] } {
  const asOfDate = new Date(asOf + "T23:59:59.999Z");
  const firstMonth = utcMonthStart(asOfDate, -2);
  const monthStarts = [0, 1, 2].map((offset) => utcMonthStart(firstMonth, offset));
  const monthKeys = monthStarts.map(utcMonthKey);
  const monthTotals = new Map(monthKeys.map((month) => [month, { income: 0, expenses: 0 }]));
  const categoryTotals = new Map<string, { expenses: number; transactionCount: number }>();

  for (const transaction of transactions) {
    const at = new Date(transaction.at + "T00:00:00.000Z");
    if (at < firstMonth || at > asOfDate) continue;
    const month = utcMonthKey(at);
    const totals = monthTotals.get(month);
    if (!totals) continue;
    if (transaction.amount > 0) {
      totals.income += transaction.amount;
      continue;
    }
    if (transaction.amount < 0) {
      const expense = Math.abs(transaction.amount);
      totals.expenses += expense;
      const existing = categoryTotals.get(transaction.category) ?? { expenses: 0, transactionCount: 0 };
      existing.expenses += expense;
      existing.transactionCount += 1;
      categoryTotals.set(transaction.category, existing);
    }
  }

  const totalExpenses = Array.from(categoryTotals.values()).reduce((sum, item) => sum + item.expenses, 0);
  const categories = Array.from(categoryTotals.entries())
    .map(([category, item]) => ({
      category,
      expenses: item.expenses,
      shareOfExpenses: totalExpenses > 0 ? item.expenses / totalExpenses : 0,
      transactionCount: item.transactionCount,
    }))
    .sort((a, b) => b.expenses - a.expenses || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const savingsRateTrend = monthKeys.map((month) => {
    const totals = monthTotals.get(month)!;
    const cashFlow = totals.income - totals.expenses;
    return {
      month,
      income: totals.income,
      expenses: totals.expenses,
      cashFlow,
      savingsRate: totals.income > 0 ? cashFlow / totals.income : null,
    };
  });

  return {
    budget: {
      windowMonths: 3,
      fromMonth: monthKeys[0],
      through: asOf,
      totalExpenses,
      categories,
    },
    savingsRateTrend,
  };
}

export function projectDebt(debt: P6Debt): DebtProjection {
  if (debt.principal <= 0) return { id: debt.id, payoffMonths: 0, totalInterest: 0, status: "paid" };
  const monthlyRate = debt.annualRate / 12;
  if (monthlyRate === 0) {
    return {
      id: debt.id,
      payoffMonths: Math.ceil(debt.principal / debt.monthlyPayment),
      totalInterest: 0,
      status: "payoff_projected",
    };
  }
  const interestOnly = debt.principal * monthlyRate;
  if (debt.monthlyPayment <= interestOnly) {
    return { id: debt.id, payoffMonths: null, totalInterest: null, status: "payment_insufficient" };
  }
  const months = Math.ceil(-Math.log(1 - monthlyRate * debt.principal / debt.monthlyPayment) / Math.log(1 + monthlyRate));
  let balance = debt.principal;
  let interest = 0;
  for (let month = 0; month < months && balance > 0; month += 1) {
    const monthlyInterest = balance * monthlyRate;
    interest += monthlyInterest;
    balance = Math.max(0, balance + monthlyInterest - debt.monthlyPayment);
  }
  return { id: debt.id, payoffMonths: months, totalInterest: interest, status: "payoff_projected" };
}

export function projectGoal(goal: P6Goal, asOf: string): GoalProjection {
  const months = monthsBetween(asOf, goal.targetDate);
  const monthlyRate = Math.pow(1 + goal.annualReturnAssumption, 1 / 12) - 1;
  let amount = goal.currentAmount;
  for (let month = 0; month < months; month += 1) {
    amount = amount * (1 + monthlyRate) + goal.monthlyContribution;
  }
  const gap = Math.max(0, goal.targetAmount - amount);
  return {
    id: goal.id,
    targetAmount: goal.targetAmount,
    projectedAmount: amount,
    fundingGap: gap,
    targetDate: goal.targetDate,
    onTrack: gap <= Math.max(1e-8, goal.targetAmount * 1e-6),
  };
}

export function calculatePersonalFinanceSnapshot(input: P6PersonalFinanceRequest): PersonalFinanceSnapshot {
  const request = p6PersonalFinanceRequestSchema.parse(input);
  const assetKinds = new Set(["cash", "bank", "investment", "retirement", "property", "other_asset"]);
  const liabilityKinds = new Set(["credit_card", "loan", "other_liability"]);
  const assets = request.accounts.filter((account) => assetKinds.has(account.kind)).reduce((sum, account) => sum + account.balance, 0);
  const liabilities = request.accounts.filter((account) => liabilityKinds.has(account.kind)).reduce((sum, account) => sum + Math.abs(account.balance), 0);
  const asOfDate = new Date(request.asOf + "T23:59:59.999Z");
  const trailingStart = addMonths(asOfDate, -1);
  const trailing = request.transactions.filter((transaction) => {
    const at = new Date(transaction.at + "T00:00:00.000Z");
    return at > trailingStart && at <= asOfDate;
  });
  const income = trailing.filter((transaction) => transaction.amount > 0).reduce((sum, transaction) => sum + transaction.amount, 0);
  const expenses = trailing.filter((transaction) => transaction.amount < 0).reduce((sum, transaction) => sum + Math.abs(transaction.amount), 0);
  const cashFlow = income - expenses;
  const budgetAnalytics = calculateBudgetAnalytics(request.transactions, request.asOf);
  const warnings: string[] = [];
  if (request.accounts.some((account) => account.currency !== request.accounts[0]?.currency)) {
    warnings.push("Multiple currencies detected; values are not FX-normalized in the local personal-finance core.");
  }
  const debt = request.debts.map(projectDebt);
  if (debt.some((item) => item.status === "payment_insufficient")) {
    warnings.push("At least one debt payment does not cover projected monthly interest under the supplied rate.");
  }
  const goals = request.goals.map((goal) => projectGoal(goal, request.asOf));
  const retirement = request.retirement ? projectRetirement(request.retirement) : null;
  if (request.retirementStress && !request.retirement) {
    throw new Error("retirementStress requires explicit retirement profile assumptions.");
  }
  const retirementStress = request.retirementStress && request.retirement
    ? projectRetirementStress(request.retirement, request.retirementStress)
    : null;
  return {
    engineId: "lios.personal-finance.core-v1",
    engineVersion: "1.1.0",
    deterministic: true,
    asOf: request.asOf,
    netWorth: assets - liabilities,
    assets,
    liabilities,
    trailingMonthlyIncome: income,
    trailingMonthlyExpenses: expenses,
    trailingMonthlyCashFlow: cashFlow,
    savingsRate: income > 0 ? cashFlow / income : null,
    budget: budgetAnalytics.budget,
    savingsRateTrend: budgetAnalytics.savingsRateTrend,
    debt,
    goals,
    retirement,
    ...(retirementStress ? { retirementStress } : {}),
    inputHash: p6Hash(request),
    warnings,
  };
}

export type RetirementProjectionInput = P6RetirementProjectionInput;

export interface RetirementProjection {
  years: number;
  projectedNominalPortfolio: number;
  projectedRealPortfolio: number;
  targetPortfolioAtRetirement: number;
  fundingGap: number;
  fundedRatio: number | null;
}

export function projectRetirement(input: RetirementProjectionInput): RetirementProjection {
  if (!Number.isFinite(input.currentAge) || !Number.isFinite(input.retirementAge) || input.retirementAge < input.currentAge) {
    throw new Error("Retirement age must be on or after current age.");
  }
  if (input.withdrawalRate <= 0 || input.withdrawalRate > 1) throw new Error("withdrawalRate must be greater than 0 and at most 1.");
  if (input.annualReturnAssumption <= -1 || input.annualInflationAssumption <= -1) throw new Error("Return and inflation assumptions must be greater than -100%.");
  const years = input.retirementAge - input.currentAge;
  const months = Math.round(years * 12);
  const monthlyReturn = Math.pow(1 + input.annualReturnAssumption, 1 / 12) - 1;
  let portfolio = input.currentPortfolio;
  for (let month = 0; month < months; month += 1) {
    portfolio = portfolio * (1 + monthlyReturn) + input.monthlyContribution;
  }
  const inflationFactor = Math.pow(1 + input.annualInflationAssumption, years);
  const retirementSpending = input.annualRetirementSpendingToday * inflationFactor;
  const target = retirementSpending / input.withdrawalRate;
  const realPortfolio = inflationFactor > 0 ? portfolio / inflationFactor : portfolio;
  const gap = Math.max(0, target - portfolio);
  return {
    years,
    projectedNominalPortfolio: portfolio,
    projectedRealPortfolio: realPortfolio,
    targetPortfolioAtRetirement: target,
    fundingGap: gap,
    fundedRatio: target > 0 ? portfolio / target : null,
  };
}
