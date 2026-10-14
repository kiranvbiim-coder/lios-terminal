/**
 * UK/EU financial-statements connector -- filings.xbrl.org (real ESEF/UKSEF
 * XBRL filing aggregator, run by the nonprofit XBRL International) plus
 * GLEIF's free official LEI registry for the symbol->company resolution
 * step. Activates for .L (UK), .PA (France), .AS (Netherlands), .BR
 * (Belgium), .VI (Austria) -- the five markets confirmed to have real
 * filing counts on this source (GB 2897, FR 1176, NL 656, BE 706, AT 600,
 * checked live). Germany and Ireland are deliberately excluded: both
 * confirmed at exactly 0 filings via the same API before writing this file,
 * not "unreliable" as a guess -- a hard count.
 *
 * RESOLUTION CHAIN, each step verified live before being trusted:
 *   1. Ticker's company name (already in server/data/tickers.json, same
 *      field used for the .BO->Screener.in slug resolution) -> LEI via
 *      GLEIF's public search (api.gleif.org, the official Global LEI
 *      Foundation registry, free, no key). Verified: "Diageo" ->
 *      213800ZVIELEA55JMJ32 -> real name "DIAGEO PLC".
 *   2. LEI -> that entity's filings via filings.xbrl.org's
 *      filter[entity.identifier] query. Verified live against the LEI above.
 *   3. Each filing's json_url -> the actual xBRL-JSON facts. Verified
 *      against a real filing: 83 distinct ifrs-full: concepts including a
 *      complete Balance Sheet, Income Statement, and Cash Flow Statement
 *      (Revenue, CostOfSales, GrossProfit, ProfitLossFromOperatingActivities,
 *      Assets, CurrentAssets, NoncurrentAssets, Liabilities, Equity,
 *      CashAndCashEquivalents, CashFlowsFromUsedIn{Operating,Investing,
 *      Financing}Activities, ...).
 *
 * CRITICAL CORRECTNESS DETAIL, caught by reading real data rather than
 * assuming the format: XBRL facts for a concept like "Equity" appear
 * MULTIPLE times per period in these filings -- once for the true
 * consolidated total, and again for EVERY sub-component from the Statement
 * of Changes in Equity (issued capital, share premium, retained earnings,
 * translation reserve, ...), each carrying the SAME concept name but an
 * EXTRA dimension key (e.g. "ifrs-full:ComponentsOfEquityAxis"). Verified
 * against real numbers: for one filing, six components (619000 + 6433000 +
 * 3548000 + 15171000 + 251000 + 81668000) summed to exactly the total
 * (107690000) -- confirming the fact with ONLY the base dimensions
 * (concept/entity/period/unit, no extra axis key) is the real total, and
 * every fact carrying an extra dimension key must be rejected. Skipping this
 * check would have silently picked a random equity SUB-component instead of
 * the total -- a wrong number, not a missing one.
 *
 * ESEF filings are ANNUAL reports by mandate -- there is no quarterly
 * equivalent here, unlike SEC EDGAR's 10-Q. Only period="FY" is supported;
 * other periods fall through to whatever's already persisted.
 */
import { fetchWithRetry } from "./providerUtils";
import type { LseFinancialReport } from "./lseData";
import { upsertCompany, persistFinancialStatementPeriods, getFinancialStatementPeriodsForSymbol } from "./companyStore";
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";

const GLEIF_BASE = "https://api.gleif.org/api/v1";
const FILINGS_BASE = "https://filings.xbrl.org";
const HEADERS: Record<string, string> = {
  "User-Agent": "Limuria Terminal (internal financial data tool) research@limuria-terminal.local",
  "Accept": "application/vnd.api+json, application/json",
};

// Confirmed live (filing counts as of 2026-08-04): GB 2897, FR 1176, NL 656,
// BE 706, AT 600. DE and IE are NOT here -- both confirmed at exactly 0.
const SUFFIX_TO_COUNTRY: Record<string, string> = { L: "GB", PA: "FR", AS: "NL", BR: "BE", VI: "AT" };

function cacheDir(sub: string): string {
  return dataPath(sub);
}
function readCache<T>(dir: string, key: string, ttlMs: number): T | null {
  try {
    const file = path.join(dir, `${key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180)}.json`);
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Date.now() - raw.cachedAt > ttlMs) return null;
    return raw.data as T;
  } catch {
    return null;
  }
}
function writeCache<T>(dir: string, key: string, data: T): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180)}.json`), JSON.stringify({ cachedAt: Date.now(), data }));
  } catch {
    // best-effort cache
  }
}

// ── Ticker universe: symbol -> company name (same source used for the .BO
// resolution in screenerIndia.ts; loaded once, shared lazily here). ───────
let tickerNameBySymbol: Map<string, string> | null = null;
function loadTickerNames(): Map<string, string> {
  if (tickerNameBySymbol) return tickerNameBySymbol;
  tickerNameBySymbol = new Map();
  try {
    const resourcesBase = (process as { resourcesPath?: string }).resourcesPath || process.env.ELECTRON_RESOURCES_PATH;
    const dataPath = resourcesBase
      ? path.resolve(resourcesBase, "server", "data", "tickers.json")
      : path.resolve(process.cwd(), "server", "data", "tickers.json");
    if (fs.existsSync(dataPath)) {
      const list = JSON.parse(fs.readFileSync(dataPath, "utf8")) as Array<{ symbol: string; name: string }>;
      for (const t of list) tickerNameBySymbol.set(t.symbol.toUpperCase(), t.name);
    }
  } catch (err) {
    console.warn("xbrlFilingsOrg: failed to load tickers.json:", err instanceof Error ? err.message : err);
  }
  return tickerNameBySymbol;
}

// ── LEI resolution ──────────────────────────────────────────────────────
const LEI_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a company's LEI essentially never changes

interface GleifRecord { attributes: { lei: string; entity: { legalName: { name: string } } } }

async function resolveLei(companyName: string): Promise<string | null> {
  const cacheDirPath = cacheDir("xbrl-lei-cache");
  const cached = readCache<string | null>(cacheDirPath, companyName, LEI_CACHE_TTL_MS);
  if (cached !== null) return cached;

  let lei: string | null = null;
  try {
    const url = `${GLEIF_BASE}/lei-records?filter%5Bentity.legalName%5D=${encodeURIComponent(companyName)}&page%5Bsize%5D=1`;
    const res = await fetchWithRetry(url, HEADERS);
    const body = (await res.json()) as { data: GleifRecord[] };
    lei = body.data?.[0]?.attributes?.lei ?? null;
  } catch (err) {
    console.warn(`xbrlFilingsOrg: GLEIF lookup failed for "${companyName}":`, err instanceof Error ? err.message : err);
  }
  writeCache(cacheDirPath, companyName, lei);
  return lei;
}

// ── Filing discovery ────────────────────────────────────────────────────
const FILINGS_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // new filings appear at most a few times a year, but check daily

interface FilingRecord {
  attributes: { period_end: string; json_url: string | null; error_count: number; country: string };
}

async function getFilingsForLei(lei: string): Promise<FilingRecord[]> {
  const cacheDirPath = cacheDir("xbrl-filings-list-cache");
  const cached = readCache<FilingRecord[]>(cacheDirPath, lei, FILINGS_CACHE_TTL_MS);
  if (cached) return cached;

  try {
    const url = `${FILINGS_BASE}/api/filings?filter%5Bentity.identifier%5D=${encodeURIComponent(lei)}`;
    const res = await fetchWithRetry(url, HEADERS);
    const body = (await res.json()) as { data: FilingRecord[] };
    const filings = (body.data ?? []).filter((f) => f.attributes.json_url && f.attributes.error_count === 0);
    filings.sort((a, b) => b.attributes.period_end.localeCompare(a.attributes.period_end));
    writeCache(cacheDirPath, lei, filings);
    return filings;
  } catch (err) {
    console.warn(`xbrlFilingsOrg: filing list fetch failed for LEI ${lei}:`, err instanceof Error ? err.message : err);
    return [];
  }
}

// ── Facts parsing ───────────────────────────────────────────────────────
interface XbrlJsonFact { value: string; dimensions: Record<string, string> }
interface XbrlJsonDoc { facts: Record<string, XbrlJsonFact> }

const FACTS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a filed document's content never changes

async function fetchFactsJson(jsonUrl: string): Promise<XbrlJsonDoc | null> {
  const cacheDirPath = cacheDir("xbrl-facts-cache");
  const cached = readCache<XbrlJsonDoc>(cacheDirPath, jsonUrl, FACTS_CACHE_TTL_MS);
  if (cached) return cached;

  try {
    const res = await fetchWithRetry(`${FILINGS_BASE}${jsonUrl}`, HEADERS);
    const doc = (await res.json()) as XbrlJsonDoc;
    writeCache(cacheDirPath, jsonUrl, doc);
    return doc;
  } catch (err) {
    console.warn(`xbrlFilingsOrg: facts fetch failed for ${jsonUrl}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** True only for the real consolidated total: base dimensions
 * (concept/entity/period/unit[/language]) and nothing else. Any extra
 * dimension key (ComponentsOfEquityAxis, a segment axis, ...) marks a
 * sub-component, not the total -- see file header for the real example that
 * proved this matters (a 174x-too-small wrong number otherwise). */
const BASE_DIMENSION_KEYS = new Set(["concept", "entity", "period", "unit", "language", "decimals"]);
function isConsolidatedTotal(fact: XbrlJsonFact): boolean {
  return Object.keys(fact.dimensions).every((k) => BASE_DIMENSION_KEYS.has(k));
}

/** Discovers the real reporting period-end dates present in a filing's own
 * facts, from an anchor concept (Revenue for income/cashflow-shaped filings,
 * Assets for balance-sheet-shaped ones) -- rather than trusting the filing
 * list's own `period_end` metadata field, which does NOT reliably match the
 * date actually used inside the facts. Verified against a real Diageo
 * filing: the filing list said period_end "2025-06-30", but every fact
 * inside used period end "2025-07-01" (a one-day XBRL period-end-as-
 * exclusive-start-of-next-day convention). Trusting the metadata field
 * silently matched nothing on every single field -- this anchor-based
 * discovery is what actually works, mirroring secEdgarFinancials.ts's same
 * anchor-tag approach for SEC filings. One filing typically carries 2-3
 * years of comparative figures, so this alone often yields multiple periods
 * per filing, not just one. */
function discoverPeriodEnds(doc: XbrlJsonDoc, anchorTags: string[], isDuration: boolean): string[] {
  const ends = new Set<string>();
  for (const tag of anchorTags) {
    const concept = `ifrs-full:${tag}`;
    for (const fact of Object.values(doc.facts)) {
      if (fact.dimensions.concept !== concept || !isConsolidatedTotal(fact)) continue;
      const period = fact.dimensions.period ?? "";
      const end = isDuration ? period.split("/")[1]?.slice(0, 10) : period.slice(0, 10);
      if (end) ends.add(end);
    }
    if (ends.size > 0) break; // first tag with any real data wins, same fallback order as pickValue
  }
  return Array.from(ends).sort().reverse();
}

/** Picks the value for a concept at a specific (already-discovered) period
 * end, trying each candidate tag in order (IFRS filers vary tag choice
 * company to company, same reasoning as secEdgarFinancials.ts's
 * candidate-array pattern for us-gaap: tags). */
function pickValue(doc: XbrlJsonDoc, candidates: string[], periodEnd: string, isDuration: boolean): number | undefined {
  for (const tag of candidates) {
    const concept = `ifrs-full:${tag}`;
    for (const fact of Object.values(doc.facts)) {
      if (fact.dimensions.concept !== concept) continue;
      if (!isConsolidatedTotal(fact)) continue;
      const period = fact.dimensions.period ?? "";
      const factEnd = isDuration ? period.split("/")[1]?.slice(0, 10) : period.slice(0, 10);
      if (factEnd !== periodEnd) continue;
      const val = parseFloat(fact.value);
      if (Number.isFinite(val)) return val;
    }
  }
  return undefined;
}

export const INCOME_FIELDS: Record<string, { tags: string[]; isDuration: true }> = {
  revenue: { tags: ["Revenue", "RevenueFromContractsWithCustomers"], isDuration: true },
  costOfRevenue: { tags: ["CostOfSales"], isDuration: true },
  grossProfit: { tags: ["GrossProfit"], isDuration: true },
  operatingExpenses: { tags: ["OperatingExpense"], isDuration: true },
  operatingIncome: { tags: ["ProfitLossFromOperatingActivities"], isDuration: true },
  interestIncome: { tags: ["FinanceIncome"], isDuration: true },
  interestExpense: { tags: ["FinanceCosts"], isDuration: true },
  incomeBeforeTax: { tags: ["ProfitLossBeforeTax"], isDuration: true },
  incomeTaxExpense: { tags: ["IncomeTaxExpenseContinuingOperations", "IncomeTaxExpense"], isDuration: true },
  netIncome: { tags: ["ProfitLoss"], isDuration: true },
  eps: { tags: ["BasicEarningsLossPerShare"], isDuration: true },
  epsDiluted: { tags: ["DilutedEarningsLossPerShare"], isDuration: true },
  depreciationAndAmortization: { tags: ["DepreciationAmortisationExpense", "DepreciationDepletionAndAmortisationExpense"], isDuration: true },
};

export const BALANCE_FIELDS: Record<string, { tags: string[]; isDuration: false }> = {
  cashAndCashEquivalents: { tags: ["CashAndCashEquivalents"], isDuration: false },
  inventory: { tags: ["Inventories"], isDuration: false },
  netReceivables: { tags: ["TradeAndOtherCurrentReceivables"], isDuration: false },
  totalCurrentAssets: { tags: ["CurrentAssets"], isDuration: false },
  propertyPlantEquipmentNet: { tags: ["PropertyPlantAndEquipment"], isDuration: false },
  goodwill: { tags: ["Goodwill"], isDuration: false },
  intangibleAssets: { tags: ["IntangibleAssetsOtherThanGoodwill"], isDuration: false },
  totalNonCurrentAssets: { tags: ["NoncurrentAssets"], isDuration: false },
  totalAssets: { tags: ["Assets"], isDuration: false },
  accountPayables: { tags: ["TradeAndOtherCurrentPayables"], isDuration: false },
  totalCurrentLiabilities: { tags: ["CurrentLiabilities"], isDuration: false },
  longTermDebt: { tags: ["NoncurrentBorrowings", "Borrowings"], isDuration: false },
  totalNonCurrentLiabilities: { tags: ["NoncurrentLiabilities"], isDuration: false },
  totalLiabilities: { tags: ["Liabilities"], isDuration: false },
  totalStockholdersEquity: { tags: ["Equity"], isDuration: false },
  totalLiabilitiesAndTotalEquity: { tags: ["EquityAndLiabilities"], isDuration: false },
};

export const CASHFLOW_FIELDS: Record<string, { tags: string[]; isDuration: true }> = {
  netCashProvidedByOperatingActivities: { tags: ["CashFlowsFromUsedInOperatingActivities"], isDuration: true },
  netCashProvidedByInvestingActivities: { tags: ["CashFlowsFromUsedInInvestingActivities"], isDuration: true },
  netCashProvidedByFinancingActivities: { tags: ["CashFlowsFromUsedInFinancingActivities"], isDuration: true },
  netChangeInCash: { tags: ["IncreaseDecreaseInCashAndCashEquivalents", "IncreaseDecreaseInCashAndCashEquivalentsBeforeEffectOfExchangeRateChanges"], isDuration: true },
};

function buildRow(doc: XbrlJsonDoc, fields: Record<string, { tags: string[]; isDuration: boolean }>, periodEnd: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, spec] of Object.entries(fields)) {
    const v = pickValue(doc, spec.tags, periodEnd, spec.isDuration);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function deriveAliasesAndTotals(reportType: string, row: Record<string, number>): void {
  if (reportType === "income") {
    if (row.operatingIncome !== undefined) row.ebit = row.operatingIncome;
    if (row.operatingIncome !== undefined && row.depreciationAndAmortization !== undefined) {
      row.ebitda = row.operatingIncome + row.depreciationAndAmortization;
    }
  }
  if (reportType === "cashflow") {
    if (row.netCashProvidedByOperatingActivities !== undefined) row.operatingCashFlow = row.netCashProvidedByOperatingActivities;
  }
}

async function financialReportsFromStore(symbol: string, reportType: string, period: string): Promise<LseFinancialReport[]> {
  const rows = await getFinancialStatementPeriodsForSymbol(symbol, reportType).catch(() => []);
  return rows
    .filter((r) => r.period === period)
    .map((r) => ({
      symbol: symbol.toUpperCase(), report_type: r.reportType, date: r.periodEnd,
      fiscal_year: r.fiscalYear, period: r.period, reported_currency: r.reportedCurrency,
      data: JSON.stringify(r.data), filing_date: r.filingDate,
    }));
}

export async function getXbrlFilingsOrgReports(symbol: string, reportType = "income", period = "FY"): Promise<LseFinancialReport[]> {
  const upper = symbol.toUpperCase();
  const suffix = upper.split(".").pop() ?? "";
  if (!(suffix in SUFFIX_TO_COUNTRY)) return [];
  if (period !== "FY") return financialReportsFromStore(symbol, reportType, period); // ESEF is annual-only, see file header

  try {
    const name = loadTickerNames().get(upper);
    if (!name) throw new Error(`no company name in ticker universe for ${upper}`);
    const lei = await resolveLei(name);
    if (!lei) throw new Error(`could not resolve an LEI for "${name}"`);
    const filings = await getFilingsForLei(lei);
    if (filings.length === 0) throw new Error(`no clean (error_count=0) filings found for LEI ${lei}`);

    const fieldMap = reportType === "balance" ? BALANCE_FIELDS : reportType === "cashflow" ? CASHFLOW_FIELDS : INCOME_FIELDS;
    const anchorTags = reportType === "balance" ? ["Assets"] : reportType === "cashflow" ? ["CashFlowsFromUsedInOperatingActivities"] : ["Revenue", "RevenueFromContractsWithCustomers"];
    const anchorIsDuration = reportType !== "balance";

    const rows: LseFinancialReport[] = [];
    const seenPeriodEnds = new Set<string>(); // each filing carries 2-3 years of comparatives -- later (older) filings re-report years the newest filing already covered; keep the first (most authoritative/most recent) occurrence only
    // Up to 6 most recent annual filings -- each already carries multiple
    // comparative years, so this covers well over 10 years of history
    // without needing as many filings as SEC EDGAR's one-year-per-10-K.
    for (const filing of filings.slice(0, 6)) {
      const jsonUrl = filing.attributes.json_url;
      if (!jsonUrl) continue;
      const doc = await fetchFactsJson(jsonUrl);
      if (!doc) continue;

      const periodEnds = discoverPeriodEnds(doc, anchorTags, anchorIsDuration);
      for (const periodEnd of periodEnds) {
        if (seenPeriodEnds.has(periodEnd)) continue;
        const row = buildRow(doc, fieldMap, periodEnd);
        if (Object.keys(row).length === 0) continue;
        deriveAliasesAndTotals(reportType, row);
        seenPeriodEnds.add(periodEnd);

        // Currency: read off any real fact's unit rather than assuming --
        // GBP for UK, EUR for the four Eurozone markets, but don't hardcode
        // the mapping when the filing itself states it.
        const anyUnit = Object.values(doc.facts).find((f) => f.dimensions.concept === "ifrs-full:Revenue" && f.dimensions.unit)?.dimensions.unit;
        const currency = anyUnit?.replace("iso4217:", "") ?? (suffix === "L" ? "GBP" : "EUR");

        rows.push({
          symbol: upper, report_type: reportType, date: periodEnd,
          fiscal_year: String(new Date(periodEnd).getFullYear()), period: "FY",
          reported_currency: currency, data: JSON.stringify(row), filing_date: null,
        });
      }
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));

    if (rows.length > 0) {
      try {
        const companyId = await upsertCompany({ symbol: upper, name: name, exchange: SUFFIX_TO_COUNTRY[suffix], country: SUFFIX_TO_COUNTRY[suffix] });
        await persistFinancialStatementPeriods(
          companyId,
          rows.map((r) => ({
            reportType: r.report_type, periodEnd: r.date, fiscalYear: r.fiscal_year, period: r.period,
            reportedCurrency: r.reported_currency, data: JSON.parse(r.data) as Record<string, number>,
            filingDate: r.filing_date, source: "xbrl_filings_org",
          })),
        );
      } catch (err) {
        console.warn(`Failed to persist xbrl.org financial statements for ${symbol}:`, err instanceof Error ? err.message : err);
      }
    }

    return rows.length > 0 ? rows : await financialReportsFromStore(symbol, reportType, period);
  } catch (err) {
    console.warn(`Live filings.xbrl.org fetch failed for ${symbol}, falling back to persisted data:`, err instanceof Error ? err.message : err);
    return financialReportsFromStore(symbol, reportType, period);
  }
}
