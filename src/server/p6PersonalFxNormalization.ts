/**
 * P6-08 source-attributed personal-finance FX projection. The authenticated
 * P6 route supplies persisted rates and a persisted currency master. No
 * provider fetch, client-submitted rate trust or competing FX authority.
 */
import { convertAmount, type ResolvedFxRate } from "@shared/fxNormalization";
import type { P6PersonalFinanceRequest } from "@shared/p6FinanceContracts";
import { calculateBudgetAnalytics } from "./p6PersonalFinance";

export type P6FxRateEvidence = ResolvedFxRate & { source: string };
export type P6FxRateEvidenceLookup = (
  base: string, quote: string, asOfDate: string,
) => Promise<P6FxRateEvidence | null> | P6FxRateEvidence | null;

export interface P6FxGap {
  kind: "account" | "transaction";
  id: string;
  reason: "missing_account" | "unavailable_rate" | "invalid_rate_evidence" | "unsupported_currency";
  fromCurrency: string | null;
  asOf: string;
}

export interface P6FxReceipt {
  kind: "account" | "transaction";
  id: string;
  fromCurrency: string;
  originalAmount: number;
  toCurrency: string;
  convertedAmount: number;
  requestedAsOf: string;
  effectiveRateDate: string;
  rate: number;
  direction: "identity" | "direct" | "inverse";
  source: string;
  evidenceClass: "stored_rate_source_unverified_publication_clock" | "identity_no_rate_required";
}

export interface P6FxNormalizedView {
  status: "complete" | "data_gap";
  reportingCurrency: string;
  asOf: string;
  sourcePolicy: "persisted_fx_observations_no_publication_clock";
  assets: number | null;
  liabilities: number | null;
  netWorth: number | null;
  trailingMonthlyIncome: number | null;
  trailingMonthlyExpenses: number | null;
  trailingMonthlyCashFlow: number | null;
  budget: ReturnType<typeof calculateBudgetAnalytics>["budget"] | null;
  savingsRateTrend: ReturnType<typeof calculateBudgetAnalytics>["savingsRateTrend"] | null;
  rateReceipts: P6FxReceipt[];
  gaps: P6FxGap[];
  limitation: string;
}

/**
 * All-or-nothing aggregate: one absent account or transaction FX rate
 * invalidates normalized totals; individual matched-rate receipts remain
 * visible so users can identify which consent/source/date is missing.
 */
export async function normalizeP6PersonalFinanceFx(
  request: P6PersonalFinanceRequest,
  target: { code: string; minorUnit: number },
  lookup: P6FxRateEvidenceLookup,
): Promise<P6FxNormalizedView> {
  if (!/^[A-Z]{3}$/.test(target.code) || !Number.isInteger(target.minorUnit)
      || target.minorUnit < 0 || target.minorUnit > 3) {
    throw new Error("FX reporting currency must be a verified ISO code with supported minor units.");
  }
  if (request.accounts.length > 500 || request.transactions.length > 5_000) {
    throw new Error("FX normalization is bounded to 500 accounts and 5,000 transactions per request.");
  }

  const receipts: P6FxReceipt[] = [];
  const gaps: P6FxGap[] = [];
  const conversions = new Map<string, P6FxRateEvidence | null>();
  const convertedAccounts: { kind: string; balance: number }[] = [];
  const convertedTransactions: P6PersonalFinanceRequest["transactions"] = [];
  const accountsById = new Map(request.accounts.map((account) => [account.id, account]));
  const allowedKinds = new Set(["cash", "bank", "investment", "retirement", "property", "other_asset", "credit_card", "loan", "other_liability"]);
  const assetKinds = new Set(["cash", "bank", "investment", "retirement", "property", "other_asset"]);
  const lookupCached = async (base: string, quote: string, asOfDate: string): Promise<P6FxRateEvidence | null> => {
    const key = JSON.stringify([base, quote, asOfDate]);
    if (!conversions.has(key)) conversions.set(key, await lookup(base, quote, asOfDate));
    return conversions.get(key) ?? null;
  };

  const convertLine = async (
    kind: P6FxGap["kind"], id: string, amount: number, fromCurrency: string, asOf: string,
  ): Promise<number | null> => {
    const gap = (reason: P6FxGap["reason"]) => {
      gaps.push({ kind, id, reason, fromCurrency, asOf });
      return null;
    };
    if (!/^[A-Z]{3}$/.test(fromCurrency)) return gap("unsupported_currency");
    let matched: P6FxRateEvidence | null = null;
    let invalidEvidence = false;
    try {
      const result = await convertAmount(
        { amount, fromCurrency, toCurrency: target.code, asOfDate: asOf },
        async (base, quote, asOfDate) => {
          const evidence = await lookupCached(base, quote, asOfDate);
          if (!evidence) return null;
          const validDate = /^\d{4}-\d{2}-\d{2}$/.test(evidence.rateDate)
            && !Number.isNaN(Date.parse(evidence.rateDate));
          if (!Number.isFinite(evidence.rate) || evidence.rate <= 0
            || !validDate || evidence.rateDate > asOfDate
            || typeof evidence.source !== "string" || evidence.source.trim().length === 0) {
            invalidEvidence = true;
            return null;
          }
          matched = evidence;
          return { rate: evidence.rate, rateDate: evidence.rateDate };
        },
        target,
      );
      if (!result.converted) return gap(invalidEvidence ? "invalid_rate_evidence" : "unavailable_rate");
      if (!Number.isFinite(result.convertedAmount) || !Number.isFinite(result.rate)
        || result.convertedAmount === null) return gap("invalid_rate_evidence");
      receipts.push({
        kind, id, fromCurrency, originalAmount: amount,
        toCurrency: target.code, convertedAmount: result.convertedAmount,
        requestedAsOf: asOf, effectiveRateDate: result.rateDate,
        rate: result.rate, direction: result.direction,
        source: result.direction === "identity" ? "identity_conversion" : matched!.source,
        evidenceClass: result.direction === "identity"
          ? "identity_no_rate_required" : "stored_rate_source_unverified_publication_clock",
      });
      return result.convertedAmount;
    } catch {
      // Strict currency rounding/invalid stored numeric results fail closed.
      return gap("invalid_rate_evidence");
    }
  };

  if (request.accounts.length === 0) {
    gaps.push({ kind: "account", id: "(profile)", reason: "missing_account", fromCurrency: null, asOf: request.asOf });
  }
  for (const account of request.accounts) {
    if (!allowedKinds.has(account.kind)) continue;
    const value = await convertLine("account", account.id, account.balance, account.currency, request.asOf);
    if (value !== null) convertedAccounts.push({ kind: account.kind, balance: value });
  }
  for (const transaction of request.transactions) {
    const parent = accountsById.get(transaction.accountId);
    if (!parent) {
      gaps.push({
        kind: "transaction", id: transaction.id, reason: "missing_account",
        fromCurrency: null, asOf: transaction.at,
      });
      continue;
    }
    if (transaction.at > request.asOf) continue; // future records never enter a current snapshot
    const value = await convertLine("transaction", transaction.id, transaction.amount, parent.currency, transaction.at);
    if (value !== null) convertedTransactions.push({ ...transaction, amount: value });
  }

  const common: Pick<P6FxNormalizedView,
    "reportingCurrency" | "asOf" | "sourcePolicy" | "rateReceipts" | "gaps" | "limitation"> = {
    reportingCurrency: target.code,
    asOf: request.asOf,
    sourcePolicy: "persisted_fx_observations_no_publication_clock",
    rateReceipts: receipts,
    gaps,
    limitation: "Rate dates are effective observation dates, not verified publication/availability times. "
      + "No provider permission, real-time FX, taxes or advice is implied. "
      + "Legacy unnormalized financial fields, debt/goal and retirement projections are separate; "
      + "never combine their currencies or treat those projections as converted here.",
  };

  if (gaps.length > 0) return {
    status: "data_gap", ...common, assets: null, liabilities: null, netWorth: null,
    trailingMonthlyIncome: null, trailingMonthlyExpenses: null,
    trailingMonthlyCashFlow: null, budget: null, savingsRateTrend: null,
  };
  const assets = convertedAccounts.filter((x) => assetKinds.has(x.kind))
    .reduce((sum, x) => sum + x.balance, 0);
  const liabilities = convertedAccounts.filter((x) => !assetKinds.has(x.kind))
    .reduce((sum, x) => sum + Math.abs(x.balance), 0);
  const trailingStart = new Date(request.asOf + "T23:59:59.999Z");
  trailingStart.setUTCMonth(trailingStart.getUTCMonth() - 1);
  const trailing = convertedTransactions.filter((x) =>
    new Date(x.at + "T00:00:00.000Z") > trailingStart && x.at <= request.asOf,
  );
  const income = trailing.filter((x) => x.amount > 0).reduce((sum, x) => sum + x.amount, 0);
  const expenses = trailing.filter((x) => x.amount < 0).reduce((sum, x) => sum + Math.abs(x.amount), 0);
  const budget = calculateBudgetAnalytics(convertedTransactions, request.asOf);
  if (![assets, liabilities, assets - liabilities, income, expenses, income - expenses, budget.budget.totalExpenses]
    .every(Number.isFinite)) throw new Error("FX-normalized aggregate overflow; totals refused.");
  return {
    status: "complete", ...common, assets, liabilities, netWorth: assets - liabilities,
    trailingMonthlyIncome: income, trailingMonthlyExpenses: expenses,
    trailingMonthlyCashFlow: income - expenses,
    budget: budget.budget, savingsRateTrend: budget.savingsRateTrend,
  };
}
