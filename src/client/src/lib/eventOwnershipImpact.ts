import type { EdgarFilingSummary, EdgarInsiderTransaction } from "./useOfficialSources";
import type { LseDividend, LseInsiderTrade, LseOptionFlowPrint, LseStockSplit } from "./useLse";

export type EventKind = "insider_transaction" | "filing" | "dividend" | "split" | "options_flow" | "cot_positioning";
export type EventImpactFlag =
  | "open_market_buy"
  | "open_market_sell"
  | "ownership_change"
  | "derivative_transaction"
  | "filing_cluster"
  | "dividend"
  | "split"
  | "estimate_event_date"
  | "options_flow"
  | "cot_positioning";
export type EventStatus = "available";

export interface EventOwnershipRecord {
  id: string;
  kind: EventKind;
  occurredAt: string;
  title: string;
  source: string;
  provider: string;
  status: EventStatus;
  asOf: string;
  period: string | null;
  unit: string | null;
  sourceUrl: string | null;
  flags: EventImpactFlag[];
  categories: string[];
  details: Record<string, string | number | boolean | null>;
}

export interface EventOwnershipInput {
  ticker: string;
  secInsiders?: EdgarInsiderTransaction[];
  secFilings?: EdgarFilingSummary[];
  lseInsiders?: LseInsiderTrade[];
  dividends?: LseDividend[];
  splits?: LseStockSplit[];
  optionsFlow?: LseOptionFlowPrint[];
  cot?: Array<{ symbol?: string; date?: string; [key: string]: unknown }>;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface EventOwnershipTimeline {
  rows: EventOwnershipRecord[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

function validDate(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function inRange(value: string, from?: string, to?: string): boolean {
  if (from && value < from) return false;
  if (to && value > `${to}T23:59:59.999Z`) return false;
  return true;
}

/** Deterministic Form 4/LSE ownership semantics; never infers price impact. */
export function classifyOwnershipTransaction(input: {
  code?: string | null;
  codeLabel?: string | null;
  isOpenMarket?: boolean;
  acquiredDisposed?: "A" | "D" | null;
  isDerivative?: boolean;
}): EventImpactFlag[] {
  const flags: EventImpactFlag[] = [];
  const code = (input.code ?? "").toUpperCase();
  const label = (input.codeLabel ?? "").toUpperCase();
  const acquired = input.acquiredDisposed === "A" || code === "P" || code === "P-PURCHASE" || label.includes("PURCHASE");
  const disposed = input.acquiredDisposed === "D" || code === "S" || code === "S-SALE" || label.includes("SALE");
  if (input.isOpenMarket && acquired) flags.push("open_market_buy");
  if (input.isOpenMarket && disposed) flags.push("open_market_sell");
  if (acquired || disposed) flags.push("ownership_change");
  if (input.isDerivative) flags.push("derivative_transaction");
  return flags;
}

function categoriesFor(kind: EventKind, flags: EventImpactFlag[]): string[] {
  const categories = new Set<string>();
  if (kind === "insider_transaction") {
    categories.add("ownership");
    categories.add("governance");
  }
  if (kind === "filing") {
    categories.add("disclosure");
    categories.add("valuation inputs");
  }
  if (kind === "dividend") {
    categories.add("cash return");
    categories.add("valuation inputs");
  }
  if (kind === "split") categories.add("capital structure");
  if (kind === "options_flow") {
    categories.add("derivatives");
    categories.add("volatility / liquidity");
  }
  if (kind === "cot_positioning") categories.add("market positioning");
  if (flags.includes("filing_cluster")) categories.add("disclosure cadence");
  return [...categories];
}

function record(base: Omit<EventOwnershipRecord, "status" | "categories">): EventOwnershipRecord {
  return { ...base, status: "available", categories: categoriesFor(base.kind, base.flags) };
}

/**
 * Combines only rows returned by the supplied providers into a chronological,
 * paged event ledger. Missing/invalid dates are omitted rather than invented.
 */
export function buildEventOwnershipTimeline(input: EventOwnershipInput): EventOwnershipTimeline {
  if (input.from && input.to && input.from > input.to) throw new Error("Event date range start must be on or before end.");
  const events: EventOwnershipRecord[] = [];
  const ticker = input.ticker.toUpperCase();

  for (const [index, tx] of (input.secInsiders ?? []).entries()) {
    if (!validDate(tx.transactionDate) || !inRange(tx.transactionDate, input.from, input.to)) continue;
    const flags = classifyOwnershipTransaction({ code: tx.transactionCode, codeLabel: tx.transactionCodeLabel, isOpenMarket: tx.isOpenMarket, acquiredDisposed: tx.acquiredDisposed, isDerivative: tx.isDerivative });
    events.push(record({
      id: `sec-insider:${tx.accessionNumber}:${index}`,
      kind: "insider_transaction",
      occurredAt: tx.transactionDate,
      title: `${tx.filerName} · ${tx.transactionCodeLabel || tx.transactionCode}`,
      source: "SEC EDGAR Form 4",
      provider: "SEC EDGAR",
      asOf: tx.transactionDate,
      period: null,
      unit: tx.securityTitle || "shares",
      sourceUrl: tx.filingUrl,
      flags,
      details: { ticker, filer: tx.filerName, role: tx.filerTitle, code: tx.transactionCode, security: tx.securityTitle, shares: tx.shares, value: tx.value, ownership: tx.isDerivative ? "derivative" : "direct" },
    }));
  }

  for (const [index, tx] of (input.lseInsiders ?? []).entries()) {
    if (!validDate(tx.transaction_date) || !inRange(tx.transaction_date, input.from, input.to)) continue;
    const acquiredDisposed = tx.acquisition_or_disposition === "A" || tx.acquisition_or_disposition === "D" ? tx.acquisition_or_disposition : null;
    const flags = classifyOwnershipTransaction({ code: tx.transaction_type, codeLabel: tx.transaction_type, isOpenMarket: /purchase|sale/i.test(tx.transaction_type), acquiredDisposed, isDerivative: false });
    events.push(record({
      id: `lse-insider:${tx.symbol}:${tx.transaction_date}:${index}`,
      kind: "insider_transaction",
      occurredAt: tx.transaction_date,
      title: `${tx.reporting_name || "Unnamed insider"} · ${tx.transaction_type || tx.form_type || "Transaction"}`,
      source: "LSE insider trades",
      provider: "London Strategic Edge",
      asOf: tx.transaction_date,
      period: null,
      unit: tx.security_name || "shares",
      sourceUrl: tx.url,
      flags,
      details: { ticker: tx.symbol, filer: tx.reporting_name, code: tx.transaction_type, shares: tx.securities_transacted, price: tx.price, ownership: "direct" },
    }));
  }

  for (const [index, filing] of (input.secFilings ?? []).entries()) {
    if (!validDate(filing.filedDate) || !inRange(filing.filedDate, input.from, input.to)) continue;
    events.push(record({
      id: `sec-filing:${filing.accessionNumber}:${index}`,
      kind: "filing",
      occurredAt: filing.filedDate,
      title: `SEC ${filing.formType} filing`,
      source: "SEC EDGAR filing index",
      provider: "SEC EDGAR",
      asOf: filing.filedDate,
      period: null,
      unit: "filing",
      sourceUrl: filing.filingUrl,
      flags: ["filing_cluster"],
      details: { ticker, form: filing.formType, accession: filing.accessionNumber },
    }));
  }

  for (const [index, dividend] of (input.dividends ?? []).entries()) {
    if (!validDate(dividend.effective_date) || !inRange(dividend.effective_date, input.from, input.to)) continue;
    events.push(record({
      id: `lse-dividend:${dividend.symbol}:${dividend.effective_date}:${index}`,
      kind: "dividend",
      occurredAt: dividend.effective_date,
      title: `${dividend.symbol} · dividend ${dividend.dividend_amount} ${dividend.currency}`,
      source: "LSE dividends reference",
      provider: "London Strategic Edge",
      asOf: dividend.effective_date,
      period: dividend.frequency,
      unit: dividend.currency,
      sourceUrl: null,
      flags: ["dividend"],
      details: { ticker: dividend.symbol, amount: dividend.dividend_amount, currency: dividend.currency, declarationDate: dividend.declaration_date, recordDate: dividend.record_date, paymentDate: dividend.payment_date },
    }));
  }

  for (const [index, split] of (input.splits ?? []).entries()) {
    if (!validDate(split.effective_date) || !inRange(split.effective_date, input.from, input.to)) continue;
    events.push(record({
      id: `lse-split:${split.symbol}:${split.effective_date}:${index}`,
      kind: "split",
      occurredAt: split.effective_date,
      title: `${split.symbol} · stock split ${split.split_from}:${split.split_to}`,
      source: "LSE stock splits reference",
      provider: "London Strategic Edge",
      asOf: split.effective_date,
      period: null,
      unit: "ratio",
      sourceUrl: null,
      flags: ["split"],
      details: { ticker: split.symbol, from: split.split_from, to: split.split_to },
    }));
  }

  for (const [index, flow] of (input.optionsFlow ?? []).entries()) {
    if (!validDate(flow.ts) || !inRange(flow.ts, input.from, input.to)) continue;
    events.push(record({
      id: `lse-options:${flow.id}:${index}`,
      kind: "options_flow",
      occurredAt: flow.ts,
      title: `${flow.underlying} · ${flow.contract_type.toUpperCase()} options flow`,
      source: "LSE options flow",
      provider: "London Strategic Edge",
      asOf: flow.ts,
      period: flow.expiry,
      unit: "premium",
      sourceUrl: null,
      flags: ["options_flow"],
      details: { ticker: flow.underlying, contract: flow.contract_type, strike: flow.strike, expiry: flow.expiry, premium: flow.premium, volume: flow.volume, underlyingPrice: flow.underlying_price },
    }));
  }

  for (const [index, row] of (input.cot ?? []).entries()) {
    if (!validDate(row.date) || !inRange(row.date, input.from, input.to)) continue;
    events.push(record({
      id: `cot:${row.symbol || ticker}:${row.date}:${index}`,
      kind: "cot_positioning",
      occurredAt: row.date,
      title: `${row.symbol || ticker} · COT positioning report`,
      source: "CFTC COT",
      provider: "CFTC",
      asOf: row.date,
      period: "weekly",
      unit: "contracts",
      sourceUrl: "https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm",
      flags: ["cot_positioning"],
      details: { ticker: row.symbol || ticker, openInterest: typeof row.open_interest === "number" ? row.open_interest : null },
    }));
  }

  events.sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.id.localeCompare(right.id));
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const limit = Math.max(1, Math.floor(input.limit ?? 25));
  const start = (page - 1) * limit;
  return { rows: events.slice(start, start + limit), total: events.length, page, limit, hasMore: start + limit < events.length };
}