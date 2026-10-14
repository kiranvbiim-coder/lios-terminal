/**
 * SEC EDGAR XBRL company-facts connector -- the second provider in the
 * financial-reports waterfall (see financialDataProviders.ts). Free, no API
 * key, genuinely public: every US public company's structured financial
 * statements straight from the regulator that mandates the disclosure in
 * the first place. Covers the NASDAQ/NYSE gap the ticker-universe audit
 * found in LSE's coverage (small/mid-caps LSE has nothing for) without
 * needing anyone's account.
 *
 * Reuses resolveCik() from secEdgarData.ts (the existing Form 4
 * insider-trading connector) rather than duplicating the ticker->CIK
 * lookup -- same underlying SEC ticker map, no reason for two copies.
 *
 * Every field mapping here was verified against real filed AAPL data
 * (already cross-checked against LSE's numbers earlier this session)
 * before being trusted -- Assets, NetIncomeLoss, and the receivables sign
 * convention (XBRL's IncreaseDecreaseInAccountsReceivable is a balance
 * change, not a cash-flow-statement sign, and AAPL specifically splits it
 * across two tags that must be summed) were all checked against known-good
 * numbers, not assumed from documentation alone.
 */
import fs from "fs";
import path from "path";
import type { LseFinancialReport } from "./lseData";
import { resolveCik } from "./secEdgarData";
import { buildSecCompanyFactsUrl } from "./edgartoolsSecUrls";
import { upsertCompany, persistFinancialStatementPeriods, getFinancialStatementPeriodsForSymbol } from "./companyStore";
import { recordConnectorVerification } from "./connectorVerification";
import { dataPath } from "./dataRoot";

const USER_AGENT = "Limuria Terminal (internal financial data tool) research@limuria-terminal.local";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // filings update at most quarterly; a day is plenty fresh

function cacheDir(): string {
  return dataPath("sec-edgar-financials-cache");
}
function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}
function readCache<T>(key: string): T | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - raw.cachedAt > CACHE_TTL_MS) return null;
    return raw.data as T;
  } catch {
    return null;
  }
}
function writeCache<T>(key: string, data: T): void {
  try {
    if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(cachePathFor(key), JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // best-effort cache
  }
}

async function secFetch<T>(url: string, cacheKey: string): Promise<T | null> {
  const cached = readCache<T>(cacheKey);
  if (cached !== null) return cached;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Accept-Encoding": "identity" } });
    if (!res.ok) {
      recordConnectorVerification("sec_edgar", false, `SEC EDGAR request returned ${res.status}.`);
      return null;
    }
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    recordConnectorVerification("sec_edgar", true, "SEC EDGAR responded to a live request.");
    return data;
  } catch (err) {
    recordConnectorVerification("sec_edgar", false, err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ── XBRL fact extraction ────────────────────────────────────────────────
interface XbrlFact { start?: string; end: string; val: number; fy: number; fp: string; form: string; filed: string }
interface CompanyFacts { cik: number; entityName: string; facts: { "us-gaap"?: Record<string, { units: { USD?: XbrlFact[] } }> } }

async function getCompanyFacts(cik: string): Promise<CompanyFacts | null> {
  return secFetch<CompanyFacts>(buildSecCompanyFactsUrl(cik), `companyfacts_${cik}`);
}

/** Facts for a given period type (FY from 10-K, or Q1/Q2/Q3 from 10-Q),
 * deduped by period (keeping the earliest filing for a given period --
 * later filings re-report prior periods as comparatives, and the original
 * filing is the "as first reported" figure every other provider in this app
 * uses). Balance-sheet tags are instant (no `start`); income/cash-flow tags
 * are duration (`start`+`end`).
 *
 * Quarterly 10-Qs often carry BOTH a genuine 3-month duration fact and a
 * year-to-date (6-month/9-month) cumulative fact for the same `end` date and
 * the same tag -- distinguished only by how far back `start` goes. Filtering
 * to ~70-100 day spans keeps the standalone quarter and excludes the YTD
 * cumulative figure. Q4 is intentionally not supported here (most filers
 * never separately report it in a 10-Q -- it's only inferable as FY minus
 * the first three quarters, which needs correlating periods across two
 * different tag sets and risks a subtly wrong derived number); the LSE
 * provider (checked first in the waterfall) already has real filed Q4 data
 * for the tickers it covers.
 */
function factsByPeriod(facts: CompanyFacts, tag: string, period: string): Map<string, XbrlFact> {
  const rows = facts.facts["us-gaap"]?.[tag]?.units?.USD ?? [];
  const matches = period === "FY"
    ? rows.filter((r) => r.fp === "FY" && (r.form === "10-K" || r.form === "10-K/A"))
    : rows.filter((r) => {
        if (r.fp !== period || (r.form !== "10-Q" && r.form !== "10-Q/A")) return false;
        if (!r.start) return true; // instant (balance sheet) facts are always a single point in time
        const days = (new Date(r.end).getTime() - new Date(r.start).getTime()) / 86400000;
        return days >= 70 && days <= 100;
      });
  const byPeriod = new Map<string, XbrlFact>();
  for (const r of [...matches].sort((a, b) => a.filed.localeCompare(b.filed))) {
    const key = `${r.start ?? ""}|${r.end}`;
    if (!byPeriod.has(key)) byPeriod.set(key, r);
  }
  return byPeriod;
}

/** Tries each candidate tag in order (XBRL tag usage varies company to
 * company -- AAPL uses CommonStockValue, another filer might not tag it at
 * all), returning the first one with data for that fiscal-year-end. Some
 * fields (AAPL's receivables, split into trade + nontrade) need multiple
 * tags SUMMED rather than substituted -- `sumWith` handles that case. */
function pickValue(
  facts: CompanyFacts,
  candidates: string[],
  periodEnd: string,
  period: string,
  opts: { negate?: boolean; sumWith?: string[] } = {},
): number | undefined {
  for (const tag of candidates) {
    const byPeriod = factsByPeriod(facts, tag, period);
    const fact = Array.from(byPeriod.values()).find((f) => f.end === periodEnd);
    if (!fact) continue;
    let value = fact.val;
    for (const extra of opts.sumWith ?? []) {
      const extraByPeriod = factsByPeriod(facts, extra, period);
      for (const [extraKey, extraFact] of Array.from(extraByPeriod.entries())) {
        if (extraKey.split("|")[1] === periodEnd) value += extraFact.val;
      }
    }
    return opts.negate ? -value : value;
  }
  return undefined;
}

// Field -> candidate XBRL tag(s), in priority order. `negate: true` flips
// XBRL's "payment"/"increase" sign convention to this app's established
// convention (outflows negative), matching what FinancialStatementsPanel
// already expects (verified against real LSE-sourced AAPL figures).
export const BALANCE_FIELDS: Record<string, { tags: string[]; negate?: boolean; sumWith?: string[] }> = {
  cashAndCashEquivalents: { tags: ["CashAndCashEquivalentsAtCarryingValue"] },
  shortTermInvestments: { tags: ["ShortTermInvestments", "MarketableSecuritiesCurrent"] },
  netReceivables: { tags: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"], sumWith: ["NontradeReceivablesCurrent"] },
  inventory: { tags: ["InventoryNet"] },
  otherCurrentAssets: { tags: ["OtherAssetsCurrent"] },
  totalCurrentAssets: { tags: ["AssetsCurrent"] },
  propertyPlantEquipmentNet: { tags: ["PropertyPlantAndEquipmentNet"] },
  goodwill: { tags: ["Goodwill"] },
  intangibleAssets: { tags: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"] },
  longTermInvestments: { tags: ["LongTermInvestments", "MarketableSecuritiesNoncurrent"] },
  otherNonCurrentAssets: { tags: ["OtherAssetsNoncurrent"] },
  totalNonCurrentAssets: { tags: ["AssetsNoncurrent"] },
  totalAssets: { tags: ["Assets"] },
  restrictedCash: { tags: ["RestrictedCashAndCashEquivalentsAtCarryingValue", "RestrictedCashCurrent"] },
  deferredTaxAssetsNonCurrent: { tags: ["DeferredIncomeTaxAssetsNet", "DeferredTaxAssetsNetNoncurrent"] },
  accountPayables: { tags: ["AccountsPayableCurrent"] },
  shortTermDebt: { tags: ["ShortTermBorrowings", "CommercialPaper", "DebtCurrent", "LongTermDebtCurrent"] },
  deferredRevenue: { tags: ["ContractWithCustomerLiabilityCurrent", "DeferredRevenueCurrent"] },
  otherCurrentLiabilities: { tags: ["OtherLiabilitiesCurrent"] },
  totalCurrentLiabilities: { tags: ["LiabilitiesCurrent"] },
  longTermDebt: { tags: ["LongTermDebtNoncurrent"] },
  deferredTaxLiabilitiesNonCurrent: { tags: ["DeferredIncomeTaxLiabilitiesNet", "DeferredTaxLiabilitiesNoncurrent"] },
  otherNonCurrentLiabilities: { tags: ["OtherLiabilitiesNoncurrent"] },
  totalNonCurrentLiabilities: { tags: ["LiabilitiesNoncurrent"] },
  totalLiabilities: { tags: ["Liabilities"] },
  commonStock: { tags: ["CommonStockValue"] },
  additionalPaidInCapital: { tags: ["AdditionalPaidInCapitalCommonStock", "AdditionalPaidInCapital"] },
  retainedEarnings: { tags: ["RetainedEarningsAccumulatedDeficit"] },
  treasuryStock: { tags: ["TreasuryStockValue", "TreasuryStockCommonValue"] },
  accumulatedOtherComprehensiveIncomeLoss: { tags: ["AccumulatedOtherComprehensiveIncomeLossNetOfTax"] },
  totalStockholdersEquity: { tags: ["StockholdersEquity"] },
  totalLiabilitiesAndTotalEquity: { tags: ["LiabilitiesAndStockholdersEquity"] },
};

export const INCOME_FIELDS: Record<string, { tags: string[]; negate?: boolean }> = {
  revenue: { tags: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues"] },
  costOfRevenue: { tags: ["CostOfGoodsAndServicesSold", "CostOfRevenue"] },
  grossProfit: { tags: ["GrossProfit"] },
  researchAndDevelopmentExpenses: { tags: ["ResearchAndDevelopmentExpense"] },
  sellingGeneralAndAdministrativeExpenses: { tags: ["SellingGeneralAndAdministrativeExpense"] },
  operatingExpenses: { tags: ["CostsAndExpenses"] },
  otherOperatingIncome: { tags: ["OtherOperatingIncomeExpenseNet"] },
  operatingIncome: { tags: ["OperatingIncomeLoss"] },
  interestExpense: { tags: ["InterestExpense"] },
  interestIncome: { tags: ["InvestmentIncomeInterest"] },
  totalOtherIncomeExpensesNet: { tags: ["NonoperatingIncomeExpense"] },
  incomeBeforeTax: { tags: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"] },
  incomeTaxExpense: { tags: ["IncomeTaxExpenseBenefit"] },
  netIncome: { tags: ["NetIncomeLoss"] },
  eps: { tags: ["EarningsPerShareBasic"] },
  epsDiluted: { tags: ["EarningsPerShareDiluted"] },
  depreciationAndAmortization: { tags: ["DepreciationDepletionAndAmortization"] },
};

export const CASHFLOW_FIELDS: Record<string, { tags: string[]; negate?: boolean; sumWith?: string[] }> = {
  netIncome: { tags: ["NetIncomeLoss"] },
  depreciationAndAmortization: { tags: ["DepreciationDepletionAndAmortization"] },
  stockBasedCompensation: { tags: ["ShareBasedCompensation"] },
  deferredIncomeTax: { tags: ["DeferredIncomeTaxExpenseBenefit"] },
  accountsReceivables: { tags: ["IncreaseDecreaseInAccountsReceivable"], sumWith: ["IncreaseDecreaseInOtherReceivables"], negate: true },
  inventory: { tags: ["IncreaseDecreaseInInventories"], negate: true },
  accountsPayables: { tags: ["IncreaseDecreaseInAccountsPayable"] },
  netCashProvidedByOperatingActivities: { tags: ["NetCashProvidedByUsedInOperatingActivities"] },
  investmentsInPropertyPlantAndEquipment: { tags: ["PaymentsToAcquirePropertyPlantAndEquipment"], negate: true },
  acquisitionsNet: { tags: ["PaymentsToAcquireBusinessesNetOfCashAcquired"], negate: true },
  purchasesOfInvestments: { tags: ["PaymentsToAcquireInvestments"], negate: true },
  salesMaturitiesOfInvestments: { tags: ["ProceedsFromSaleMaturityAndCollectionsOfInvestments"] },
  netCashProvidedByInvestingActivities: { tags: ["NetCashProvidedByUsedInInvestingActivities"] },
  commonStockIssuance: { tags: ["ProceedsFromIssuanceOfCommonStock"] },
  commonStockRepurchased: { tags: ["PaymentsForRepurchaseOfCommonStock"], negate: true },
  commonDividendsPaid: { tags: ["PaymentsOfDividendsCommonStock"], negate: true },
  netCashProvidedByFinancingActivities: { tags: ["NetCashProvidedByUsedInFinancingActivities"] },
  effectOfForexChangesOnCash: { tags: ["EffectOfExchangeRateOnCashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"] },
  netChangeInCash: { tags: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect", "CashAndCashEquivalentsPeriodIncreaseDecrease"] },
  cashAtEndOfPeriod: { tags: ["CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsAtCarryingValue", "CashAndCashEquivalentsAtCarryingValue"] },
  incomeTaxesPaid: { tags: ["IncomeTaxesPaidNet"] },
  interestPaid: { tags: ["InterestPaidNet", "InterestPaid"] },
};

function buildRow(
  facts: CompanyFacts,
  fields: Record<string, { tags: string[]; negate?: boolean; sumWith?: string[] }>,
  periodEnd: string,
  period: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const v = pickValue(facts, spec.tags, periodEnd, period, spec);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/** Fills the compound/alias fields FinancialStatementsPanel and the
 * ValuationPanel tabs read under a second name, plus the ones best derived
 * rather than pulled from a single tag (EBIT/EBITDA, free cash flow, and
 * the non-current totals when a filer doesn't tag them directly). */
function deriveAliasesAndTotals(reportType: string, row: Record<string, number>): void {
  if (reportType === "balance") {
    if (row.totalNonCurrentAssets === undefined && row.totalAssets !== undefined && row.totalCurrentAssets !== undefined) {
      row.totalNonCurrentAssets = row.totalAssets - row.totalCurrentAssets;
    }
    if (row.totalNonCurrentLiabilities === undefined && row.totalLiabilities !== undefined && row.totalCurrentLiabilities !== undefined) {
      row.totalNonCurrentLiabilities = row.totalLiabilities - row.totalCurrentLiabilities;
    }
  }
  if (reportType === "income") {
    if (row.operatingIncome !== undefined) row.ebit = row.operatingIncome;
    if (row.operatingIncome !== undefined && row.depreciationAndAmortization !== undefined) {
      row.ebitda = row.operatingIncome + row.depreciationAndAmortization;
    }
  }
  if (reportType === "cashflow") {
    if (row.netCashProvidedByOperatingActivities !== undefined) row.operatingCashFlow = row.netCashProvidedByOperatingActivities;
    if (row.investmentsInPropertyPlantAndEquipment !== undefined) row.capitalExpenditure = row.investmentsInPropertyPlantAndEquipment;
    if (row.operatingCashFlow !== undefined && row.capitalExpenditure !== undefined) {
      row.freeCashFlow = row.operatingCashFlow + row.capitalExpenditure; // capex already negative
    }
    if (row.commonStockIssuance !== undefined || row.commonStockRepurchased !== undefined) {
      row.netCommonStockIssuance = (row.commonStockIssuance ?? 0) + (row.commonStockRepurchased ?? 0);
    }
    // Beginning-of-period cash = end-of-period cash less the period's net
    // change -- algebraically exact, and avoids needing a second tag lookup
    // for a value that's already implied by two facts we already have.
    if (row.cashAtEndOfPeriod !== undefined && row.netChangeInCash !== undefined) {
      row.cashAtBeginningOfPeriod = row.cashAtEndOfPeriod - row.netChangeInCash;
    }
    // "Other" investing/financing activities as a residual (net total minus
    // every named line item this app tracks) -- the standard way desks
    // reconcile a cash-flow statement to its filed net subtotal when a filer
    // has line items this app doesn't have a dedicated tag for.
    if (row.netCashProvidedByInvestingActivities !== undefined) {
      const known = (row.investmentsInPropertyPlantAndEquipment ?? 0) + (row.acquisitionsNet ?? 0)
        + (row.purchasesOfInvestments ?? 0) + (row.salesMaturitiesOfInvestments ?? 0);
      row.otherInvestingActivities = row.netCashProvidedByInvestingActivities - known;
    }
    if (row.netCashProvidedByFinancingActivities !== undefined) {
      const known = (row.commonStockIssuance ?? 0) + (row.commonStockRepurchased ?? 0) + (row.commonDividendsPaid ?? 0);
      row.otherFinancingActivities = row.netCashProvidedByFinancingActivities - known;
    }
  }
}

// Reads the persisted DB rows back into LseFinancialReport shape -- used as
// a fallback when the live EDGAR fetch below fails, and independently
// covers the (period !== "FY") case now that quarterly rows might exist
// from some other provider writing through the same table in the future.
async function financialReportsFromStore(symbol: string, reportType: string, period: string, query: FinancialReportQuery = {}): Promise<LseFinancialReport[]> {
  const rows = await getFinancialStatementPeriodsForSymbol(symbol, reportType).catch(() => []);
  const filtered = rows.filter((r) => r.period === period);
  const periodEnds = boundFinancialPeriodEnds(filtered.map((r) => r.periodEnd), query);
  return periodEnds.flatMap((end) => filtered.filter((r) => r.periodEnd === end).map((r) => ({
    symbol: symbol.toUpperCase(),
    report_type: r.reportType,
    date: r.periodEnd,
    fiscal_year: r.fiscalYear,
    period: r.period,
    reported_currency: r.reportedCurrency,
    data: JSON.stringify(r.data),
    filing_date: r.filingDate,
  })));

}
/** Keep provider responses bounded while allowing callers to request more history
 * than the old UI-oriented ten/twelve-period truncation. */
export interface FinancialReportQuery {
  limit?: number;
  offset?: number;
}

export const MAX_FINANCIAL_REPORT_PERIODS = 100;

export function boundFinancialPeriodEnds(
  periodEnds: string[],
  query: FinancialReportQuery = {},
): string[] {
  const limit = Math.min(Math.max(Math.trunc(query.limit ?? MAX_FINANCIAL_REPORT_PERIODS), 1), MAX_FINANCIAL_REPORT_PERIODS);
  const offset = Math.max(Math.trunc(query.offset ?? 0), 0);
  return Array.from(new Set(periodEnds)).sort().reverse().slice(offset, offset + limit);
}

function queryOptions(value: number | FinancialReportQuery | undefined): FinancialReportQuery {
  return typeof value === "object" && value !== null ? value : {};
}

export async function getSecFinancialReports(
  symbol: string,
  reportType = "income",
  period = "FY",
  optionsOrUserId?: number | FinancialReportQuery,
): Promise<LseFinancialReport[]> {
  const query = queryOptions(optionsOrUserId);
  // Q4 is not separately filed in a 10-Q for most issuers. Do not derive it
  // from FY minus Q1-Q3: callers receive only explicitly persisted Q4 data.
  if (period === "Q4") return financialReportsFromStore(symbol, reportType, period, query);

  try {
    const resolved = await resolveCik(symbol);
    if (!resolved) throw new Error(`Could not resolve CIK for ${symbol}`);
    const facts = await getCompanyFacts(resolved.cik);
    if (!facts) throw new Error(`No company facts returned for ${symbol}`);

    const fieldMap = reportType === "balance" ? BALANCE_FIELDS : reportType === "cashflow" ? CASHFLOW_FIELDS : INCOME_FIELDS;
    // Use Assets (balance) or NetIncomeLoss (income/cashflow) as the anchor
    // tag to discover which period-end dates actually have a filing for the
    // requested period type, then pull every other field for those dates.
    const anchorTag = reportType === "balance" ? "Assets" : "NetIncomeLoss";
    const anchorPeriods = factsByPeriod(facts, anchorTag, period);
    const anchorFactList = Array.from(anchorPeriods.values());
    const periodEnds = boundFinancialPeriodEnds(anchorFactList.map((f) => f.end), query);

    const rows: LseFinancialReport[] = [];
    for (const end of periodEnds) {
      const row = buildRow(facts, fieldMap, end, period);
      if (Object.keys(row).length === 0) continue;
      deriveAliasesAndTotals(reportType, row);
      const anchorFact = anchorFactList.find((f) => f.end === end);
      rows.push({
        symbol: symbol.toUpperCase(),
        report_type: reportType,
        date: end,
        fiscal_year: String(anchorFact?.fy ?? new Date(end).getFullYear()),
        period,
        reported_currency: "USD",
        data: JSON.stringify(row),
        filing_date: anchorFact?.filed ?? null,
      });
    }

    try {
      const companyId = await upsertCompany({ symbol: symbol.toUpperCase(), name: facts.entityName, cik: resolved.cik });
      await persistFinancialStatementPeriods(
        companyId,
        rows.map((r) => ({
          reportType: r.report_type,
          periodEnd: r.date,
          fiscalYear: r.fiscal_year,
          period: r.period,
          reportedCurrency: r.reported_currency,
          data: JSON.parse(r.data) as Record<string, number>,
          filingDate: r.filing_date,
          source: "sec_edgar",
        })),
      );
    } catch (err) {
      console.warn(`Failed to persist financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
    }

    return rows;
  } catch (err) {
    console.warn(`Live EDGAR financials fetch failed for ${symbol}, falling back to persisted data:`, err instanceof Error ? err.message : err);
    return financialReportsFromStore(symbol, reportType, period, query);
  }
}
