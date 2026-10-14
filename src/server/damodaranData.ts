/**
 * Real industry-benchmark data from Aswath Damodaran's NYU Stern dataset
 * pages (https://pages.stern.nyu.edu/~adamodar/) -- free, no API key,
 * updated by Damodaran several times a year. Two files fetched directly:
 * betas.xls (industry unlevered/levered beta) and wacc.xls (industry cost
 * of equity/debt/capital). Confirmed live before building this: both are
 * genuine current .xls workbooks (Composite Document File V2, last-saved
 * metadata shows Damodaran's own name, dated within this dataset year --
 * not stale mirrors), ~96 industries each, real per-industry figures (e.g.
 * Advertising industry beta 1.21, unlevered beta 0.93 in betas.xls;
 * Advertising cost of capital 7.81% in wacc.xls).
 *
 * This closes a real gap in the existing WACC/DCF valuation models
 * (client/src/lib/valuationModels.ts's leverBeta()/computeWacc()): those
 * take beta and cost-of-debt as bare numeric inputs with no real per-
 * industry reference point, so a user either has to already know a
 * reasonable unlevered beta for their industry or guess. This module gives
 * a real, sourced default.
 *
 * These files update a handful of times a year, not intraday -- an
 * in-memory cache with a generous TTL is the right shape, no need for disk
 * persistence (the whole dataset is under 100KB parsed).
 */
import * as XLSX from "xlsx";
import { getCached, setCached, type CacheLike } from "./providerUtils";

const BETAS_URL = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/betas.xls";
const WACC_URL = "https://pages.stern.nyu.edu/~adamodar/pc/datasets/wacc.xls";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days -- Damodaran updates a few times a year, not more

export interface DamodaranIndustryBenchmark {
  industry: string;
  numberOfFirms: number | null;
  beta: number | null;
  unleveredBeta: number | null;
  unleveredBetaCorrectedForCash: number | null;
  debtToEquity: number | null;
  costOfEquityPct: number | null;
  afterTaxCostOfDebtPct: number | null;
  wacc: number | null;
}

const cache = new Map<string, { expiresAt: number; value: unknown }>() as CacheLike<DamodaranIndustryBenchmark[]>;

function findHeaderRow(rows: unknown[][], mustContain: string): number {
  for (let i = 0; i < rows.length; i++) {
    if (Array.isArray(rows[i]) && rows[i].some((cell) => typeof cell === "string" && cell.trim() === mustContain)) {
      return i;
    }
  }
  return -1;
}

function toRecords(rows: unknown[][], headerRowIdx: number): Array<Record<string, unknown>> {
  const headers = rows[headerRowIdx] as unknown[];
  const records: Array<Record<string, unknown>> = [];
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.length === 0) continue;
    const industryName = row[0];
    if (typeof industryName !== "string" || !industryName.trim()) continue;
    const record: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (typeof h === "string" && h.trim()) record[h.trim()] = row[idx];
    });
    records.push(record);
  }
  return records;
}

async function fetchWorkbookRows(url: string, sheetName: string): Promise<unknown[][]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Damodaran dataset fetch failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[sheetName] || workbook.Sheets[workbook.SheetNames[workbook.SheetNames.length - 1]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function getDamodaranIndustryBenchmarks(): Promise<DamodaranIndustryBenchmark[]> {
  const cached = getCached(cache, "industry-benchmarks");
  if (cached) return cached;

  const [betaRows, waccRows] = await Promise.all([
    fetchWorkbookRows(BETAS_URL, "Industry Averages"),
    fetchWorkbookRows(WACC_URL, "Industry Averages"),
  ]);

  const betaHeaderIdx = findHeaderRow(betaRows, "Industry Name");
  const waccHeaderIdx = findHeaderRow(waccRows, "Industry Name");
  if (betaHeaderIdx === -1 || waccHeaderIdx === -1) {
    throw new Error("Damodaran dataset layout changed -- could not locate 'Industry Name' header row.");
  }

  const betaRecords = toRecords(betaRows, betaHeaderIdx);
  const waccRecords = toRecords(waccRows, waccHeaderIdx);
  const waccByIndustry = new Map(waccRecords.map((r) => [String(r["Industry Name"]).trim(), r]));

  const benchmarks: DamodaranIndustryBenchmark[] = betaRecords.map((r) => {
    const industry = String(r["Industry Name"]).trim();
    const waccRow = waccByIndustry.get(industry);
    return {
      industry,
      numberOfFirms: num(r["Number of firms"]),
      beta: num(r["Beta"]),
      unleveredBeta: num(r["Unlevered beta"]),
      unleveredBetaCorrectedForCash: num(r["Unlevered beta corrected for cash"]),
      debtToEquity: num(r["D/E Ratio"]),
      costOfEquityPct: waccRow ? num(waccRow["Cost of Equity"]) : null,
      afterTaxCostOfDebtPct: waccRow ? num(waccRow["After-tax Cost of Debt"]) : null,
      wacc: waccRow ? num(waccRow["Cost of Capital"]) : null,
    };
  });

  return setCached(cache, "industry-benchmarks", benchmarks, CACHE_TTL_MS);
}

export async function getDamodaranIndustryBenchmark(industry: string): Promise<DamodaranIndustryBenchmark | null> {
  const all = await getDamodaranIndustryBenchmarks();
  const needle = industry.trim().toLowerCase();
  return (
    all.find((b) => b.industry.toLowerCase() === needle) ||
    all.find((b) => b.industry.toLowerCase().includes(needle) || needle.includes(b.industry.toLowerCase())) ||
    null
  );
}
