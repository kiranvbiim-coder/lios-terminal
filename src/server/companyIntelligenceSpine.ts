/**
 * Company Intelligence Data Spine: the vertical slice tying together every
 * piece built in this session's Data Spine phase --
 *
 *   query -> resolve entity -> fetch quote + statements (with conflict
 *   detection) + filings + insider activity, concurrently -> one composite,
 *   honestly-labeled snapshot.
 *
 * Deliberately NOT a hot/auto-refresh path: resolveFinancialStatements
 * alone calls up to 8 real providers concurrently (see
 * financialStatementsBroker.ts), so this is for an explicit "deep dive on
 * this company" action, not a page-load or ticker-tape path.
 *
 * Every sub-fetch is independently null-safe: SEC EDGAR filings/insider
 * data only exist for US SEC filers, so a non-US symbol (RELIANCE.NS,
 * BP.L, 7203.T) or a non-company entity (BTC-USD) legitimately has
 * filings: null / insiders: null -- that's not a fetch failure, it's an
 * honest "not applicable" distinct from "we tried and it broke" (failures
 * are captured separately per sub-fetch rather than silently merged into
 * the same null).
 */
import { resolveEntity } from "./entityResolver";
import { getQuotes, type Quote } from "./marketData";
import { resolveFinancialStatements } from "./financialStatementsBroker";
import { getCompanyFilings, getInsiderTransactions, type EdgarCompanyInput, type EdgarFilingSummary, type EdgarInsiderTransaction } from "./secEdgarData";
import type { CapabilityResolution } from "./capabilityBroker";
import type { LseFinancialReport } from "./lseData";

type ResolvedEntity = Awaited<ReturnType<typeof resolveEntity>>;

export interface CompanySnapshot {
  query: string;
  entity: ResolvedEntity;
  resolutionStatus: "resolved" | "ambiguous" | "unresolved" | "failed";
  quote: Quote | null;
  financials: CapabilityResolution<LseFinancialReport[]> | null;
  /** null when this symbol isn't a US SEC filer (not applicable), not when the fetch failed -- failures are captured in `subsystemFailures` instead. */
  filings: EdgarFilingSummary[] | null;
  insiders: EdgarInsiderTransaction[] | null;
  subsystemFailures: Array<{ subsystem: "entity" | "quote" | "financials" | "filings" | "insiders"; message: string }>;
  generatedAt: string;
}

/** Existing provider seams; injectable for bounded orchestration/HTTP tests. */
export interface CompanySnapshotDependencies {
  resolveEntity: typeof resolveEntity;
  getQuotes: typeof getQuotes;
  resolveFinancialStatements: typeof resolveFinancialStatements;
  getCompanyFilings: typeof getCompanyFilings;
  getInsiderTransactions: typeof getInsiderTransactions;
}

const defaultDependencies: CompanySnapshotDependencies = {
  resolveEntity, getQuotes, resolveFinancialStatements, getCompanyFilings, getInsiderTransactions,
};

async function settle<T>(subsystem: CompanySnapshot["subsystemFailures"][number]["subsystem"], fn: () => Promise<T>, failures: CompanySnapshot["subsystemFailures"], fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    failures.push({ subsystem, message: error instanceof Error ? error.message : String(error) });
    return fallback;
  }
}

export async function buildCompanySnapshot(query: string, overrides: Partial<CompanySnapshotDependencies> = {}): Promise<CompanySnapshot> {
  const upper = query.trim().toUpperCase();
  const subsystemFailures: CompanySnapshot["subsystemFailures"] = [];
  const dependencies = { ...defaultDependencies, ...overrides };
  // Identity is a prerequisite, never one concurrent fetch beside raw-query providers.
  const entity = await settle("entity", () => dependencies.resolveEntity(query.trim()), subsystemFailures, null);
  const snapshot: CompanySnapshot = {
    query: upper,
    entity,
    resolutionStatus: subsystemFailures.length ? "failed" : !entity ? "unresolved" : "ambiguous" in entity ? "ambiguous" : "resolved",
    quote: null,
    financials: null,
    filings: null,
    insiders: null,
    subsystemFailures,
    generatedAt: new Date().toISOString(),
  };
  if (!entity || "ambiguous" in entity) return snapshot;

  // The issuer's display symbol / legacy row is not a listing. Only the
  // canonical, hydrated listing may drive quote/statement retrieval.
  const symbol = entity.listing?.symbol ?? null;
  const cik = entity.cik ?? entity.resolution.match?.identifiers.find((identifier) => identifier.type === "cik")?.value;
  const secInput: EdgarCompanyInput | null = cik && /^\d{1,10}$/.test(cik)
    ? { entityId: entity.id, cik, name: entity.name, symbol }
    : symbol;

  const [quotes, financials, filings, insiders] = await Promise.all([
    symbol ? settle("quote", () => dependencies.getQuotes([symbol]), subsystemFailures, [] as Quote[]) : [],
    symbol ? settle("financials", () => dependencies.resolveFinancialStatements(symbol, "income", "FY"), subsystemFailures, null) : null,
    secInput ? settle("filings", () => dependencies.getCompanyFilings(secInput), subsystemFailures, [] as EdgarFilingSummary[]) : [],
    secInput ? settle("insiders", () => dependencies.getInsiderTransactions(secInput), subsystemFailures, [] as EdgarInsiderTransaction[]) : [],
  ]);

  return {
    ...snapshot,
    quote: quotes[0] ?? null,
    financials,
    filings: filings.length ? filings : null,
    insiders: insiders.length ? insiders : null,
    generatedAt: new Date().toISOString(),
  };
}
