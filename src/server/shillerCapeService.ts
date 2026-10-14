import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assertLocalByodRuntime } from "./runtimeSecurity";

/**
 * Shiller CAPE uses a user-supplied, locally permitted monthly series.
 * LIOS_SHILLER_CAPE_FILE points to a JSON array of CapeMonth records; no
 * series is bundled or downloaded. Supplying a path does not grant data
 * redistribution rights. As-of always comes from the last validated row.
 */
export interface CapeMonth {
  year: number;
  month: number; // 1-12
  cape: number;
  realPrice: number | null;
  realEarnings: number | null;
}

export interface CapeSnapshot {
  current: CapeMonth;
  percentile: number; // 0-100, this month's cape rank within the full series
  mean: number;
  median: number;
  min: { cape: number; year: number; month: number };
  max: { cape: number; year: number; month: number };
  count: number;
  series: Array<{ year: number; month: number; cape: number }>;
  asOf: string;
  source: {
    contentHash: string;
    byteLength: number;
    sourceRefs: string[];
  };
}

function loadCapeSeries(): { series: CapeMonth[]; contentHash: string; byteLength: number } {
  assertLocalByodRuntime("Shiller CAPE local file source");
  const configuredPath = process.env.LIOS_SHILLER_CAPE_FILE?.trim();
  if (!configuredPath) {
    throw new Error("Shiller CAPE source unavailable. Supply a licensed local JSON series via LIOS_SHILLER_CAPE_FILE; no dataset is bundled or downloaded.");
  }

  let bytes: Buffer;
  try {
    const filePath = fs.realpathSync(path.resolve(configuredPath));
    if (!fs.statSync(filePath).isFile()) throw new Error("not a regular file");
    bytes = fs.readFileSync(filePath);
  } catch {
    throw new Error("Shiller CAPE source unavailable: LIOS_SHILLER_CAPE_FILE must identify a readable regular local JSON file.");
  }

  let rows: unknown;
  try {
    rows = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Invalid Shiller CAPE source: expected a JSON array of monthly records.");
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Invalid Shiller CAPE source: the monthly record array must not be empty.");
  }
  let previousMonth = -1;
  const now = new Date();
  const latestMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  for (const [index, row] of rows.entries()) {
    const invalid = (detail: string): never => {
      throw new Error(`Invalid Shiller CAPE source at row ${index + 1}: ${detail}.`);
    };
    if (!row || typeof row !== "object" || Array.isArray(row)) invalid("expected a monthly record");
    const { year, month, cape, realPrice, realEarnings } = row;
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
      invalid("year and month must describe a valid calendar month");
    }
    const monthIndex = year * 12 + month - 1;
    if (monthIndex <= previousMonth) invalid("months must be unique and in strictly increasing chronological order");
    if (monthIndex > latestMonth) invalid("as-of month cannot be in the future");
    if (typeof cape !== "number" || !Number.isFinite(cape) || cape <= 0) invalid("CAPE must be a finite positive number");
    if (realPrice !== null && (typeof realPrice !== "number" || !Number.isFinite(realPrice) || realPrice <= 0)) {
      invalid("realPrice must be a finite positive number or null");
    }
    // Losses are valid earnings observations; null is unavailable, never zero-filled.
    if (realEarnings !== null && (typeof realEarnings !== "number" || !Number.isFinite(realEarnings))) {
      invalid("realEarnings must be a finite number or null");
    }
    previousMonth = monthIndex;
  }
  return { series: rows as CapeMonth[], contentHash: crypto.createHash("sha256").update(bytes).digest("hex"), byteLength: bytes.length };
}

export function getCapeSnapshot(): CapeSnapshot {
  const { series, contentHash, byteLength } = loadCapeSeries();
  const current = series[series.length - 1];
  const sorted = [...series].sort((a, b) => a.cape - b.cape);
  const rank = sorted.filter((m) => m.cape <= current.cape).length;
  const percentile = (rank / sorted.length) * 100;
  const mean = series.reduce((sum, m) => sum + m.cape, 0) / series.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1].cape + sorted[mid].cape) / 2 : sorted[mid].cape;
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  if (![mean, median, mean * 100, median * 100].every(Number.isFinite)) {
    throw new Error("Invalid Shiller CAPE source: observations exceed the finite snapshot calculation range.");
  }

  return {
    current,
    asOf: `${String(current.year).padStart(4, "0")}-${String(current.month).padStart(2, "0")}-01T00:00:00.000Z`,
    source: { contentHash, byteLength, sourceRefs: [`file-content:${contentHash}`] },
    percentile: Math.round(percentile * 10) / 10,
    mean: Math.round(mean * 100) / 100,
    median: Math.round(median * 100) / 100,
    min: { cape: min.cape, year: min.year, month: min.month },
    max: { cape: max.cape, year: max.year, month: max.month },
    count: series.length,
    // Preserve every supplied monthly observation, without invented history.
    series: series.map((m) => ({ year: m.year, month: m.month, cape: m.cape })),
  };
}
