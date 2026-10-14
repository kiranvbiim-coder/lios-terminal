/**
 * SEC EDGAR connector -- the official, free, public source Form 3/4/5
 * insider filings come from directly (data.sec.gov / www.sec.gov), the same
 * primary source every commercial insider-trading reseller (including LSE)
 * repackages. No API key, no ToS restriction on redistribution -- this is
 * public-domain US government data. SEC's fair-access policy requires a
 * descriptive User-Agent identifying the requester; no rate-limit account
 * needed as long as requests stay reasonable (well under their ~10 req/sec
 * guidance, helped by the disk cache below).
 *
 * Unlike a flattened resale feed, this reads the raw Form 4 XML directly, so
 * it carries the real SEC transaction code (P/S/A/D/F/M/G/...) per line item
 * -- letting the UI distinguish an actual open-market buy or sell (P/S) from
 * routine equity-comp mechanics (RSU vesting, tax withholding, option
 * exercise) that a flattened "Sale"/"Purchase" label collapses together.
 *
 * Same disk-cache resilience pattern as lseData.ts/cftcData.ts. Filed
 * documents never change once accepted, so per-filing XML is cached
 * indefinitely (keyed by accession number); the "recent filings" list has a
 * short TTL since new filings land within 2 business days of a trade.
 */
import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";
import { upsertCompany, persistFilings, getFilingsForSymbol, getFilingsForCompanyId } from "./companyStore";
import { dataPath } from "./dataRoot";
import { buildSecSubmissionsUrl, buildSecFilingArchiveUrl, buildSecFilingIndexUrl, normalizeSecAccession, safeSecArchiveFileName } from "./edgartoolsSecUrls";

const USER_AGENT = "Limuria Terminal (internal research tool) contact@limuria-terminal.local";
const RECENT_FILINGS_TTL_MS = 30 * 60 * 1000;
const TICKER_MAP_TTL_MS = 24 * 60 * 60 * 1000;

const XML = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "", trimValues: true, parseTagValue: false });

function cacheDir(): string {
  return dataPath("edgar-cache");
}

function cachePathFor(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 180);
  return path.join(cacheDir(), `${safe}.json`);
}

function readCache<T>(key: string): { data: T; cachedAt: number } | null {
  try {
    const file = cachePathFor(key);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, "utf8"));
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

// filings themselves are immutable once accepted -- cache forever (ttlMs omitted)
async function edgarFetchJson<T>(url: string, cacheKey: string, ttlMs?: number): Promise<T | null> {
  const cached = readCache<T>(cacheKey);
  if (cached && (ttlMs === undefined || Date.now() - cached.cachedAt < ttlMs)) return cached.data;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`SEC EDGAR returned ${res.status} for ${url}`);
    const data = (await res.json()) as T;
    writeCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn(`SEC EDGAR fetch failed for ${url}, falling back to cache:`, err instanceof Error ? err.message : err);
    return cached?.data ?? null;
  }
}

async function edgarFetchText(url: string, cacheKey: string): Promise<string | null> {
  const cached = readCache<string>(cacheKey);
  if (cached) return cached.data;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) throw new Error(`SEC EDGAR returned ${res.status} for ${url}`);
    const text = await res.text();
    writeCache(cacheKey, text);
    return text;
  } catch (err) {
    console.warn(`SEC EDGAR fetch failed for ${url}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

let tickerMapPromise: Promise<Map<string, { cik: string; name: string }>> | null = null;

async function getTickerMap(): Promise<Map<string, { cik: string; name: string }>> {
  if (!tickerMapPromise) {
    tickerMapPromise = (async () => {
      const raw = await edgarFetchJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
        "https://www.sec.gov/files/company_tickers.json",
        "company_tickers",
        TICKER_MAP_TTL_MS,
      );
      const map = new Map<string, { cik: string; name: string }>();
      if (raw) {
        for (const row of Object.values(raw)) {
          map.set(row.ticker.toUpperCase(), { cik: String(row.cik_str).padStart(10, "0"), name: row.title });
        }
      }
      return map;
    })();
  }
  return tickerMapPromise;
}

export async function resolveCik(ticker: string): Promise<{ cik: string; name: string } | null> {
  const map = await getTickerMap();
  return map.get(ticker.toUpperCase()) ?? null;
}

/** A resolved P5 entity, not a CIK encoded as a ticker. Existing string callers remain listing-based. */
export interface EdgarCompanyIdentity {
  entityId: number;
  cik: string;
  name: string;
  symbol?: string | null;
}
export type EdgarCompanyInput = string | EdgarCompanyIdentity;

function validateEdgarIdentity(input: EdgarCompanyIdentity): void {
  if (!Number.isSafeInteger(input.entityId) || input.entityId < 1 || !/^\d{1,10}$/.test(input.cik) || !input.name.trim()) {
    throw new Error("A resolved entity id, legal name and valid CIK are required.");
  }
}

function edgarInputLabel(input: EdgarCompanyInput): string {
  return typeof input === "string" ? input : input.name;
}

/** Bulk accessor for the same cached company_tickers.json getTickerMap()
 * already fetches for single-symbol resolveCik() lookups -- used by
 * instrumentUniverseIngestion.ts's P0.4 ingestion pipeline so it doesn't
 * duplicate this fetch+cache against the same free, no-auth SEC endpoint. */
export async function getAllSecCompanyTickers(): Promise<Array<{ cik: string; ticker: string; name: string }>> {
  const map = await getTickerMap();
  return Array.from(map.entries()).map(([ticker, info]) => ({ cik: info.cik, ticker, name: info.name }));
}

interface SubmissionsFile {
  name: string;
  filingCount?: number;
  filingFrom?: string;
  filingTo?: string;
}

export interface SubmissionRows {
  form: string[];
  filingDate: string[];
  accessionNumber: string[];
  primaryDocument?: string[];
}

interface SubmissionsResponse {
  filings: { recent: SubmissionRows; files?: SubmissionsFile[] };
}

// SEC's official code definitions (Form 4 transactionCode) -- used to label
// each row so a viewer can tell a real market transaction from routine
// equity-comp mechanics.
export const TRANSACTION_CODE_LABELS: Record<string, string> = {
  P: "Open Market Purchase",
  S: "Open Market Sale",
  A: "Grant / Award",
  D: "Disposition to Issuer",
  F: "Tax Withholding (Shares)",
  M: "Option/Derivative Exercise",
  G: "Gift",
  C: "Conversion of Derivative",
  X: "In-the-Money Option Exercise",
  I: "Discretionary Transaction",
  J: "Other (See Footnote)",
  K: "Equity Swap Transaction",
  U: "Tender of Shares",
  W: "Acquisition/Disposition by Will/Laws of Descent",
  Z: "Deposit/Withdrawal (Voting Trust)",
};

// P and S are the only codes representing genuine open-market cash trades --
// everything else is compensation mechanics (vesting, withholding, gifts,
// exercises) that shouldn't be read as a market signal the same way.
export const OPEN_MARKET_CODES = new Set(["P", "S"]);

export interface EdgarInsiderTransaction {
  symbol: string | null;
  issuerName: string;
  filerName: string;
  filerTitle: string | null;
  isDirector: boolean;
  isOfficer: boolean;
  isTenPercentOwner: boolean;
  transactionDate: string;
  transactionCode: string;
  transactionCodeLabel: string;
  isOpenMarket: boolean;
  securityTitle: string;
  isDerivative: boolean;
  shares: number | null;
  pricePerShare: number | null;
  value: number | null;
  acquiredDisposed: "A" | "D" | null;
  sharesOwnedAfter: number | null;
  accessionNumber: string;
  filingUrl: string;
}

function val(node: any): string | null {
  if (node === undefined || node === null) return null;
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (typeof node === "object" && "value" in node) return String(node.value);
  return null;
}

function numVal(node: any): number | null {
  const v = val(node);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

async function findRawXmlName(cik: string, accession: string): Promise<string | null> {
  const id = normalizeSecAccession(accession);
  const url = buildSecFilingArchiveUrl(cik, accession, "index.json");
  const data = await edgarFetchJson<{ directory: { item: Array<{ name: string }> } }>(url, `idx_${cik}_${id.digits}`);
  const items = data?.directory?.item;
  if (!Array.isArray(items)) return null;
  const xmlFile = items.find((i) => typeof i?.name === "string" && i.name.toLowerCase().endsWith(".xml") && safeSecArchiveFileName(i.name));
  return xmlFile?.name ?? null;
}

function parseForm4(xml: string, symbol: string | null, accessionNumber: string, filingUrl: string): EdgarInsiderTransaction[] {
  let doc: any;
  try {
    doc = XML.parse(xml)?.ownershipDocument;
  } catch {
    return [];
  }
  if (!doc) return [];

  // A filing may disclose a trading symbol; missing disclosure stays null.
  // Neither CIK nor legal name is a substitute ticker.
  const observedSymbol = symbol ?? (val(doc.issuer?.issuerTradingSymbol)?.trim().toUpperCase() || null);
  const issuerName = val(doc.issuer?.issuerName) ?? symbol ?? "Unknown issuer";
  const owner = asArray(doc.reportingOwner)[0] ?? doc.reportingOwner;
  const filerName = val(owner?.reportingOwnerId?.rptOwnerName) ?? "Unknown";
  const rel = owner?.reportingOwnerRelationship;
  const isDirector = val(rel?.isDirector) === "true" || val(rel?.isDirector) === "1";
  const isOfficer = val(rel?.isOfficer) === "true" || val(rel?.isOfficer) === "1";
  const isTenPercentOwner = val(rel?.isTenPercentOwner) === "true" || val(rel?.isTenPercentOwner) === "1";
  const filerTitle = val(rel?.officerTitle);

  const rows: EdgarInsiderTransaction[] = [];

  const buildRow = (tx: any, isDerivative: boolean): EdgarInsiderTransaction | null => {
    const code = val(tx.transactionCoding?.transactionCode) ?? "";
    const date = val(tx.transactionDate) ?? "";
    if (!date) return null;
    const shares = numVal(tx.transactionAmounts?.transactionShares);
    const price = numVal(tx.transactionAmounts?.transactionPricePerShare);
    const acqDisp = val(tx.transactionAmounts?.transactionAcquiredDisposedCode) as "A" | "D" | null;
    return {
      symbol: observedSymbol,
      issuerName,
      filerName,
      filerTitle,
      isDirector,
      isOfficer,
      isTenPercentOwner,
      transactionDate: date,
      transactionCode: code,
      transactionCodeLabel: TRANSACTION_CODE_LABELS[code] ?? `Code ${code}`,
      isOpenMarket: OPEN_MARKET_CODES.has(code),
      securityTitle: val(tx.securityTitle) ?? "Common Stock",
      isDerivative,
      shares,
      pricePerShare: price,
      value: shares !== null && price !== null ? shares * price : null,
      acquiredDisposed: acqDisp,
      sharesOwnedAfter: numVal(tx.postTransactionAmounts?.sharesOwnedFollowingTransaction),
      accessionNumber,
      filingUrl,
    };
  };

  for (const tx of asArray(doc.nonDerivativeTable?.nonDerivativeTransaction)) {
    const row = buildRow(tx, false);
    if (row) rows.push(row);
  }
  for (const tx of asArray(doc.derivativeTable?.derivativeTransaction)) {
    const row = buildRow(tx, true);
    if (row) rows.push(row);
  }
  return rows;
}
export interface EdgarPageOptions {
  page?: number;
  limit?: number;
  from?: string;
  to?: string;
  cursor?: string;
}

export interface EdgarInsiderPage {
  rows: EdgarInsiderTransaction[];
  page: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  from: string | null;
  to: string | null;
  coverage: "provider-continuation" | "bounded" | "persisted-cache";
}

export interface EdgarFilingsPage {
  rows: EdgarFilingSummary[];
  page: number;
  limit: number;
  returnedCount: number;
  totalCount: number;
  hasMore: boolean;
  nextCursor: string | null;
  from: string | null;
  to: string | null;
  coverage: "provider-continuation" | "bounded" | "persisted-cache";
}

const MAX_SUBMISSION_FILES = 32;
const MAX_SUBMISSION_ROWS = 25_000;

function parseEdgarDate(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})$/.exec(value.trim());
  const parsed = match ? new Date(`${match[1]}T00:00:00.000Z`) : null;
  if (!match || !parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[1]) {
    throw new Error("SEC date filters must use YYYY-MM-DD.");
  }
  return match[1];
}

export function normalizeEdgarPageOptions(options: EdgarPageOptions = {}): { page: number; limit: number; from: string | null; to: string | null; cursor: string | undefined } {
  const cursorPage = options.cursor === undefined ? null : /^\d+$/.test(options.cursor) && Number(options.cursor) >= 1 && Number(options.cursor) <= 10_000 ? Number(options.cursor) : null;
  if (options.cursor !== undefined && cursorPage === null) throw new Error("SEC cursor must be a positive page number up to 10000.");
  const requestedPage = Number.isFinite(options.page) ? Math.max(1, Math.floor(options.page!)) : 1;
  const page = cursorPage ?? Math.min(requestedPage, 10_000);
  const from = parseEdgarDate(options.from);
  const to = parseEdgarDate(options.to);
  if (from && to && from > to) throw new Error("SEC date filter 'from' must not be after 'to'.");
  const limit = Number.isFinite(options.limit) ? Math.min(Math.max(Math.floor(options.limit!), 1), 100) : 20;
  return { page, limit, from, to, cursor: options.cursor };
}

export interface SubmissionRecord {
  form: string;
  filingDate: string;
  accessionNumber: string;
}

export function mergeSubmissionRecords(recent: SubmissionRows, older: SubmissionRows[]): SubmissionRecord[] {
  return [recent, ...older]
    .flatMap((rows) => recordsFromRows(rows))
    .sort((a, b) => b.filingDate.localeCompare(a.filingDate) || b.accessionNumber.localeCompare(a.accessionNumber))
    .slice(0, MAX_SUBMISSION_ROWS);
}

function recordsFromRows(rows: SubmissionRows): SubmissionRecord[] {
  const records: SubmissionRecord[] = [];
  const count = Math.min(rows.form.length, rows.filingDate.length, rows.accessionNumber.length);
  for (let index = 0; index < count; index++) {
    records.push({ form: rows.form[index], filingDate: rows.filingDate[index], accessionNumber: rows.accessionNumber[index] });
  }
  return records;
}

function safeSubmissionFileName(name: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name) ? name : null;
}

async function getAllSubmissionRecords(cik: string, submissions: SubmissionsResponse): Promise<SubmissionRecord[]> {
  const olderRows: SubmissionRows[] = [];
  const files = (submissions.filings.files ?? []).slice(0, MAX_SUBMISSION_FILES);
  for (const file of files) {
    const name = safeSubmissionFileName(file.name);
    if (!name) continue;
    const older = await edgarFetchJson<SubmissionRows>(
      `https://data.sec.gov/submissions/${name}`,
      `submissions_file_${cik}_${name}`,
      RECENT_FILINGS_TTL_MS,
    );
    if (older) olderRows.push(older);
    if (olderRows.reduce((count, rows) => count + rows.form.length, submissions.filings.recent.form.length) >= MAX_SUBMISSION_ROWS) break;
  }
  return mergeSubmissionRecords(submissions.filings.recent, olderRows);
}
export function pageSubmissionRecords<T>(records: T[], page: number, limit: number): { rows: T[]; start: number; total: number; hasMore: boolean } {
  const start = (Math.max(1, page) - 1) * Math.max(1, limit);
  const rows = records.slice(start, start + Math.max(1, limit));
  return { rows, start, total: records.length, hasMore: start + rows.length < records.length };
}

function inDateRange(date: string, from: string | null, to: string | null): boolean {
  return (!from || date >= from) && (!to || date <= to);
}

async function loadEdgarRecords(input: EdgarCompanyInput): Promise<{ cik: string; name: string; symbol: string | null; records: SubmissionRecord[]; coverage: EdgarInsiderPage["coverage"] } | null> {
  if (typeof input !== "string") validateEdgarIdentity(input);
  const resolved = typeof input === "string" ? await resolveCik(input) : { cik: input.cik.padStart(10, "0"), name: input.name };
  if (!resolved) return null;
  const submissions = await edgarFetchJson<SubmissionsResponse>(
    buildSecSubmissionsUrl(resolved.cik),
    `submissions_${resolved.cik}`,
    RECENT_FILINGS_TTL_MS,
  );
  if (!submissions) return null;
  const coverage = (submissions.filings.files?.length ?? 0) > MAX_SUBMISSION_FILES ? "bounded" : "provider-continuation";
  const symbol = typeof input === "string" ? input.trim().toUpperCase() : input.symbol?.trim().toUpperCase() || null;
  return { cik: resolved.cik, name: resolved.name, symbol, records: await getAllSubmissionRecords(resolved.cik, submissions), coverage };
}

export async function getInsiderTransactionsPage(input: EdgarCompanyInput, options: EdgarPageOptions = {}): Promise<EdgarInsiderPage> {
  const normalized = normalizeEdgarPageOptions(options);
  const loaded = await loadEdgarRecords(input);
  if (!loaded) {
    return { rows: [], page: normalized.page, limit: normalized.limit, returnedCount: 0, totalCount: 0, hasMore: false, nextCursor: null, from: normalized.from, to: normalized.to, coverage: "persisted-cache" };
  }
  const candidates = loaded.records.filter((record) => record.form === "4" && /^\d{10}-\d{2}-\d{6}$/.test(record.accessionNumber) && inDateRange(record.filingDate, normalized.from, normalized.to));
  const page = pageSubmissionRecords(candidates, normalized.page, normalized.limit);
  const selected = page.rows;
  const rows = (await Promise.all(selected.map(async (record) => {
    const accession = normalizeSecAccession(record.accessionNumber);
    const xmlName = await findRawXmlName(loaded.cik, accession.dashed);
    if (!xmlName) return [];
    const xmlUrl = buildSecFilingArchiveUrl(loaded.cik, accession.dashed, xmlName);
    const filingUrl = buildSecFilingIndexUrl(loaded.cik, accession.dashed);
    const xml = await edgarFetchText(xmlUrl, `xml_${loaded.cik}_${accession.digits}`);
    return xml ? parseForm4(xml, loaded.symbol, accession.dashed, filingUrl) : [];
  }))).flat().sort((a, b) => b.transactionDate.localeCompare(a.transactionDate) || a.accessionNumber.localeCompare(b.accessionNumber));
  try {
    if (typeof input === "string") await upsertCompany({ symbol: input.toUpperCase(), name: loaded.name, cik: loaded.cik });
  } catch (err) {
    console.warn(`Failed to persist company for ${edgarInputLabel(input)}:`, err instanceof Error ? err.message : err);
  }
  const hasMore = page.hasMore;
  return {
    rows, page: normalized.page, limit: normalized.limit, returnedCount: rows.length,
    totalCount: candidates.length, hasMore, nextCursor: hasMore ? String(normalized.page + 1) : null,
    from: normalized.from, to: normalized.to, coverage: loaded.coverage,
  };
}

export async function getInsiderTransactions(input: EdgarCompanyInput, limit = 20): Promise<EdgarInsiderTransaction[]> {
  return (await getInsiderTransactionsPage(input, { limit })).rows;
}



export interface EdgarFilingSummary {
  formType: string;
  filedDate: string;
  accessionNumber: string;
  filingUrl: string;
}

/**
 * Full recent-filings list (10-K, 10-Q, 8-K, 4, DEF 14A, ...), not just
 * Form 4 -- covers the "SEC/Regulatory Filings" data-coverage item that
 * getInsiderTransactions (Form 4 only) doesn't. Persists company + filing
 * metadata to the DB (see companyStore.ts) so this survives independently
 * of the disk cache and gives a stable companyId for future work to key off.
 */
export async function getCompanyFilingsPage(input: EdgarCompanyInput, options: EdgarPageOptions = {}): Promise<EdgarFilingsPage> {
  const normalized = normalizeEdgarPageOptions(options);
  if (typeof input !== "string") validateEdgarIdentity(input);
  try {
    const loaded = await loadEdgarRecords(input);
    if (!loaded) throw new Error(`Could not retrieve SEC submissions for ${edgarInputLabel(input)}`);
    const filtered = loaded.records.filter((record) => /^\d{10}-\d{2}-\d{6}$/.test(record.accessionNumber) && inDateRange(record.filingDate, normalized.from, normalized.to));
    const page = pageSubmissionRecords(filtered, normalized.page, normalized.limit);
    const selected = page.rows;
    const rows = selected.map((record) => ({
      formType: record.form,
      filedDate: record.filingDate,
      accessionNumber: record.accessionNumber,
      filingUrl: buildSecFilingIndexUrl(loaded.cik, record.accessionNumber),
    }));
    try {
      // A resolved entity already exists. Do not materialize a listing from its CIK/name.
      const companyId = typeof input === "string"
        ? await upsertCompany({ symbol: input.toUpperCase(), name: loaded.name, cik: loaded.cik })
        : input.entityId;
      await persistFilings(companyId, rows);
    } catch (err) {
      console.warn(`Failed to persist filings for ${edgarInputLabel(input)}:`, err instanceof Error ? err.message : err);
    }
    const hasMore = page.hasMore;
    return {
      rows, page: normalized.page, limit: normalized.limit, returnedCount: rows.length,
      totalCount: filtered.length, hasMore, nextCursor: hasMore ? String(normalized.page + 1) : null,
      from: normalized.from, to: normalized.to, coverage: loaded.coverage,
    };
  } catch (err) {
    console.warn(`Live EDGAR filings fetch failed for ${edgarInputLabel(input)}, falling back to persisted data:`, err instanceof Error ? err.message : err);
    const persisted = await (typeof input === "string"
      ? getFilingsForSymbol(input, MAX_SUBMISSION_ROWS)
      : getFilingsForCompanyId(input.entityId, MAX_SUBMISSION_ROWS)).catch(() => []);
    const filtered = persisted.filter((filing) => inDateRange(filing.filedDate, normalized.from, normalized.to));
    const start = (normalized.page - 1) * normalized.limit;
    const rows = filtered.slice(start, start + normalized.limit).map((filing) => ({
      formType: filing.formType,
      filedDate: filing.filedDate,
      accessionNumber: filing.accessionNumber,
      filingUrl: filing.filingUrl,
    }));
    const hasMore = start + rows.length < filtered.length;
    return {
      rows, page: normalized.page, limit: normalized.limit, returnedCount: rows.length,
      totalCount: filtered.length, hasMore, nextCursor: hasMore ? String(normalized.page + 1) : null,
      from: normalized.from, to: normalized.to, coverage: "persisted-cache",
    };
  }
}

export async function getCompanyFilings(input: EdgarCompanyInput, limit = 40): Promise<EdgarFilingSummary[]> {
  return (await getCompanyFilingsPage(input, { limit })).rows;
}
