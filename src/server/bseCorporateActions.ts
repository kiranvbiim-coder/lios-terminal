/**
 * BSE corporate-actions connector, built to fix a real data-quality gap in
 * the bhavcopy-backed price history (bseBhavcopy.ts): that history stores
 * RAW, unadjusted prices, so any bonus issue or stock split in a company's
 * past shows up as a fake overnight price "crash" that silently corrupts
 * beta, volatility, and CAGR calculations touching that period.
 *
 * Endpoint, VERIFIED LIVE before writing this file:
 *   https://api.bseindia.com/BseIndiaAPI/api/DefaultData/w
 *     ?ddlcategorys=Equity&ddlindustrys=&segment=Equity&strSearch=S
 *     &Fdate={YYYYMMDD}&TDate={YYYYMMDD}&Purposecode=&scripcode={code}
 * Despite BennyThadikaran/BseIndiaApi (the reference client this session
 * cross-checked earlier) describing this as "forthcoming corporate
 * actions," it genuinely returns full history when given a historical
 * Fdate/TDate range -- confirmed against Infosys (500209, 51 actions back
 * to 2000, including real bonus issues in 2014/2015/2018) and ITC (500825,
 * real face-value splits in 2010 and 2018).
 *
 * Two "Purpose" string shapes carry a real price-adjustment ratio (verified
 * against real text, not assumed from a spec):
 *   "Bonus issue 1:1"                        -> shares x(1+1)/1, price /2
 *   "Stock  Split From Rs.10/- to Rs.2/-"     -> shares x10/2,   price /5
 *   (note the double space after "Stock" in BSE's own text -- kept in the
 *   regex rather than normalized, since matching their real string exactly
 *   is safer than assuming it's a typo that won't recur)
 * Canonical dividend and special-dividend events are also consumed when they
 * exist in the local corporate-action store; rights issues and buybacks remain
 * unadjusted because they require a different formula.
 */
import { fetchWithRetry } from "./providerUtils";
import { listCorporateActionsForBseScrip } from "./corporateActionStore";
import type { OHLCVBar } from "./marketData";
import fs from "fs";
import path from "path";
import { dataPath } from "./dataRoot";
const BSE_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Origin": "https://www.bseindia.com",
  "Referer": "https://www.bseindia.com/",
};

// Revalidate periodically because the request includes the current date and
// newly announced actions can affect the current history window.
const ACTION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MIN_ADJUSTMENT_FACTOR = 1e-6;
const MAX_ADJUSTMENT_FACTOR = 1e6;

function cacheDir(): string {
  return dataPath("bse-corporate-actions-cache");
}
function cachePathFor(scripCode: string): string {
  return path.join(cacheDir(), `${scripCode}.json`);
}

export interface SplitBonusAction {
  exDate: string; // ISO
  purpose: string; // raw BSE text, kept for display/audit
  adjustmentFactor: number; // multiply every pre-exDate price by this
}

interface RawActionRow { Ex_date: string; Purpose: string }

function isValidCachedActions(value: unknown): value is SplitBonusAction[] {
  return Array.isArray(value) && value.every((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    const action = candidate as Partial<SplitBonusAction>;
    const parsedFactor = typeof action.purpose === "string" ? parseAdjustmentFactor(action.purpose) : null;
    return typeof action.exDate === "string" &&
      isValidIsoDate(action.exDate) &&
      typeof action.purpose === "string" &&
      typeof action.adjustmentFactor === "number" &&
      isSaneAdjustmentFactor(action.adjustmentFactor) &&
      parsedFactor !== null &&
      Math.abs(parsedFactor - action.adjustmentFactor) <= 1e-12 * Math.max(1, Math.abs(parsedFactor));
  });
}

/** "02 Dec 2014" -> "2014-12-02" */
export function parseExDate(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/);
  if (!m) return null;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const month = months[m[2]];
  if (!month) return null;
  const iso = `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}
function isSaneAdjustmentFactor(value: number): boolean {
  return Number.isFinite(value) && value >= MIN_ADJUSTMENT_FACTOR && value <= MAX_ADJUSTMENT_FACTOR;
}

/** Parses a BSE "Purpose" string into a price-adjustment factor, or null if
 * this action type isn't one this app adjusts for (see file header). */
export function parseAdjustmentFactor(purpose: string): number | null {
  const bonus = purpose.match(/Bonus\s+issue\s+(\d+)\s*:\s*(\d+)/i);
  if (bonus) {
    const num = parseInt(bonus[1], 10);
    const denom = parseInt(bonus[2], 10);
    const factor = denom / (num + denom);
    if (Number.isFinite(num) && Number.isFinite(denom) && denom > 0 && num >= 0 && isSaneAdjustmentFactor(factor)) return factor;
  }
  const split = purpose.match(/Stock\s+Split\s+From\s+Rs\.?\s*(\d+(?:\.\d+)?)\/?-?\s+to\s+Rs\.?\s*(\d+(?:\.\d+)?)\/?-?/i);
  if (split) {
    const oldFv = parseFloat(split[1]);
    const newFv = parseFloat(split[2]);
    const factor = newFv / oldFv;
    if (Number.isFinite(oldFv) && Number.isFinite(newFv) && oldFv > 0 && newFv > 0 && isSaneAdjustmentFactor(factor)) return factor;
  }
  return null;
}

/** Fetches every bonus/split action ever recorded for a BSE scrip code
 * (Fdate is fixed to well before this app's earliest price data, 2007-01-02,
 * so nothing historical is missed), sorted oldest-first. */
export async function getBseSplitBonusActions(scripCode: string): Promise<SplitBonusAction[]> {
  const normalizedScripCode = scripCode.trim();
  if (!/^\d{1,12}$/.test(normalizedScripCode)) {
    throw new RangeError("BSE scrip code must contain 1-12 digits.");
  }
  const cacheFile = cachePathFor(normalizedScripCode);
  try {
    const cacheAge = Date.now() - fs.statSync(cacheFile).mtimeMs;
    if (cacheAge >= 0 && cacheAge < ACTION_CACHE_TTL_MS) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, "utf8")) as unknown;
      if (isValidCachedActions(cached)) return cached;
      throw new TypeError("BSE corporate-action cache failed validation.");
    }
  } catch {
    // fall through to a live fetch
  }

  try {
    const url = `https://api.bseindia.com/BseIndiaAPI/api/DefaultData/w?ddlcategorys=Equity&ddlindustrys=&segment=Equity&strSearch=S&Fdate=20000101&TDate=${new Date().toISOString().slice(0, 10).replace(/-/g, "")}&Purposecode=&scripcode=${normalizedScripCode}`;
    const res = await fetchWithRetry(url, BSE_HEADERS);
    const payload: unknown = await res.json();
    if (!Array.isArray(payload)) throw new TypeError("BSE corporate-action response was not an array.");
    const actions: SplitBonusAction[] = [];
    for (const candidate of payload) {
      if (!candidate || typeof candidate !== "object") continue;
      const row = candidate as Partial<RawActionRow>;
      if (typeof row.Purpose !== "string" || typeof row.Ex_date !== "string") continue;
      const factor = parseAdjustmentFactor(row.Purpose);
      if (factor === null) continue;
      const exDate = parseExDate(row.Ex_date);
      if (!exDate) continue;
      actions.push({ exDate, purpose: row.Purpose, adjustmentFactor: factor });
    }
    actions.sort((a, b) => a.exDate.localeCompare(b.exDate));

    try {
      if (!fs.existsSync(cacheDir())) fs.mkdirSync(cacheDir(), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(actions), "utf8");
    } catch {
      // best-effort cache
    }
    return actions;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn(`BSE corporate actions unavailable for scrip ${scripCode}:`, error.message);
    throw error;
  }
}

export interface CanonicalCorporateActionAdjustment {
  actionType: "split" | "reverse_split" | "bonus_issue" | "dividend" | "special_dividend";
  exDate: string;
  ratioNumerator?: number;
  ratioDenominator?: number;
  cashAmount?: number;
  cashCurrency?: string;
}

export function dedupeCorporateActionAdjustments(actions: CanonicalCorporateActionAdjustment[]): CanonicalCorporateActionAdjustment[] {
  const actionKey = (action: CanonicalCorporateActionAdjustment): string => {
    const kind = action.actionType === "split" || action.actionType === "reverse_split" || action.actionType === "bonus_issue"
      ? "split_like"
      : action.actionType;
    const ratio = action.ratioNumerator === undefined || action.ratioDenominator === undefined
      ? null
      : Math.round((action.ratioNumerator / action.ratioDenominator) * 1e12) / 1e12;
    const currency = action.cashCurrency?.trim().toUpperCase() ?? "INR";
    return JSON.stringify([kind, action.exDate, ratio, action.cashAmount, currency]);
  };
  return actions.filter((action, index, all) =>
    all.findIndex((candidate) => actionKey(candidate) === actionKey(action)) === index,
  );
}

/** Combines the live BSE split/bonus feed with canonical local dividend
 * events, returning one provider-neutral adjustment list for history. */
export async function getBseCorporateActionAdjustments(
  scripCode: string,
  asOfDate?: string,
): Promise<CanonicalCorporateActionAdjustment[]> {
  if (asOfDate !== undefined && !isValidIsoDate(asOfDate)) {
    throw new RangeError(`BSE adjustment as-of date must be a valid ISO date: ${asOfDate}`);
  }
  const legacyActions = await getBseSplitBonusActions(scripCode);
  const adjustments: CanonicalCorporateActionAdjustment[] = legacyActions
    .filter((action) => asOfDate === undefined || action.exDate <= asOfDate)
    .map((action) => ({
      actionType: "split" as const,
      exDate: action.exDate,
      ratioNumerator: 1 / action.adjustmentFactor,
      ratioDenominator: 1,
    }));

  try {
    const canonicalEvents = await listCorporateActionsForBseScrip(scripCode);
    for (const event of canonicalEvents) {
      const isAdjustable = event.action.actionType === "split" ||
        event.action.actionType === "reverse_split" ||
        event.action.actionType === "bonus_issue" ||
        event.action.actionType === "dividend" ||
        event.action.actionType === "special_dividend";
      if (!isAdjustable) continue;
      const exDate = event.action.exDate ?? event.action.effectiveDate;
      if (!exDate || !isValidIsoDate(exDate)) {
        throw new RangeError(`Canonical BSE adjustable action has invalid ISO ex-date: ${exDate ?? "missing"}`);
      }
      if (asOfDate !== undefined && exDate > asOfDate) continue;
      const subjectLegs = event.legs.filter((candidate) => candidate.role === "subject");
      if (subjectLegs.length !== 1) {
        throw new RangeError(`Canonical BSE adjustable action on ${exDate} must have exactly one subject leg.`);
      }
      const leg = subjectLegs[0];
      if (
        event.action.actionType === "split" ||
        event.action.actionType === "reverse_split" ||
        event.action.actionType === "bonus_issue"
      ) {
        if (leg.ratioNumerator === null || leg.ratioDenominator === null) {
          throw new RangeError(`Canonical BSE split action on ${exDate} has incomplete ratio fields.`);
        }
        adjustments.push({
          actionType: event.action.actionType,
          exDate,
          ratioNumerator: leg.ratioNumerator,
          ratioDenominator: leg.ratioDenominator,
        });
      } else if (event.action.actionType === "dividend" || event.action.actionType === "special_dividend") {
        const terms = event.action.terms;
        const termCash = typeof terms.cashAmount === "number" ? terms.cashAmount : undefined;
        const termCurrency = typeof terms.cashCurrency === "string" ? terms.cashCurrency : undefined;
        const cashAmount = leg.cashAmount ?? termCash;
        const cashCurrency = (leg.cashCurrency ?? termCurrency)?.trim().toUpperCase();
        if (cashAmount === undefined) {
          throw new RangeError(`Canonical BSE dividend on ${exDate} has no cash amount.`);
        }
        if (cashCurrency !== undefined && cashCurrency !== "INR") {
          throw new RangeError(`Canonical BSE dividend on ${exDate} uses unsupported currency ${cashCurrency}.`);
        }
        adjustments.push({ actionType: event.action.actionType, exDate, cashAmount, cashCurrency: cashCurrency ?? "INR" });
      }
    }
  } catch (error) {
    console.warn(`Canonical BSE corporate actions unavailable for scrip ${scripCode}:`, error instanceof Error ? error.message : error);
    throw error;
  }

  return dedupeCorporateActionAdjustments(adjustments);
}

/** Standard back-adjustment consumed by chart/history. Split-like actions
 * scale pre-ex-date prices by the inverse share ratio and volume by the
 * share ratio; dividends scale pre-ex-date prices by (reference close -
 * cash dividend) / reference close and leave volume unchanged. */
export function applyCanonicalCorporateActionAdjustments(
  bars: OHLCVBar[],
  actions: CanonicalCorporateActionAdjustment[],
): OHLCVBar[] {
  if (actions.length === 0) return bars;
  const latestBarDate = bars.reduce((latest, bar) => bar.date > latest ? bar.date : latest, bars[0]?.date ?? "");
  const sortedActions = [...actions]
    .filter((action) => action.exDate <= latestBarDate)
    .sort((a, b) => a.exDate.localeCompare(b.exDate));
  if (sortedActions.length === 0) return bars;
  const dividendByDate = new Map<string, { action: CanonicalCorporateActionAdjustment; index: number }>();
  let normalizedActions: CanonicalCorporateActionAdjustment[] = [];
  for (const action of sortedActions) {
    if (action.actionType === "dividend" || action.actionType === "special_dividend") {
      const existingDividend = dividendByDate.get(action.exDate);
      if (existingDividend) {
        const aggregate = {
          ...existingDividend.action,
          cashAmount: (existingDividend.action.cashAmount ?? Number.NaN) + (action.cashAmount ?? Number.NaN),
        };
        normalizedActions = normalizedActions.map((candidate, index) => index === existingDividend.index ? aggregate : candidate);
        dividendByDate.set(action.exDate, { action: aggregate, index: existingDividend.index });
      } else {
        const aggregate = { ...action };
        const index = normalizedActions.length;
        dividendByDate.set(action.exDate, { action: aggregate, index });
        normalizedActions = [...normalizedActions, aggregate];
      }
    } else {
      normalizedActions = [...normalizedActions, action];
    }
  }
  const sorted = [...normalizedActions].sort((a, b) => a.exDate.localeCompare(b.exDate));
  const chronologicalBars = [...bars].sort((a, b) => a.date.localeCompare(b.date));
  const referenceCloseByDate = new Map<string, number | undefined>();
  let priorBarIndex = 0;
  for (const action of sorted) {
    while (priorBarIndex < chronologicalBars.length && chronologicalBars[priorBarIndex].date < action.exDate) {
      priorBarIndex++;
    }
    if (action.actionType === "dividend" || action.actionType === "special_dividend") {
      referenceCloseByDate.set(action.exDate, chronologicalBars[priorBarIndex - 1]?.close);
    }
  }
  return bars.map((bar) => {
    let priceFactor = 1;
    let shareFactor = 1;
    for (const action of sorted) {
      if (bar.date >= action.exDate) continue;
      if (action.actionType === "dividend" || action.actionType === "special_dividend") {
        if (action.cashCurrency !== undefined && action.cashCurrency.toUpperCase() !== "INR") {
          throw new RangeError(`BSE dividend adjustment requires INR cashCurrency, received ${action.cashCurrency}.`);
        }
        if (action.cashAmount === undefined || !Number.isFinite(action.cashAmount) || action.cashAmount < 0) {
          throw new RangeError(`Dividend action on ${action.exDate} requires finite nonnegative cashAmount.`);
        }
        const reference = referenceCloseByDate.get(action.exDate);
        if (reference === undefined || !Number.isFinite(reference) || reference <= 0 || action.cashAmount >= reference) {
          throw new RangeError(`Dividend action on ${action.exDate} has no valid positive pre-ex-date reference close.`);
        }
        priceFactor *= (reference - action.cashAmount) / reference;
      } else {
        if (
          action.ratioNumerator === undefined ||
          action.ratioDenominator === undefined ||
          !Number.isFinite(action.ratioNumerator) ||
          !Number.isFinite(action.ratioDenominator) ||
          action.ratioNumerator <= 0 ||
          action.ratioDenominator <= 0
        ) {
          throw new RangeError(`Split action on ${action.exDate} requires finite positive ratio fields.`);
        }
        const sharesFactor = action.ratioNumerator / action.ratioDenominator;
        if (!isSaneAdjustmentFactor(sharesFactor)) {
          throw new RangeError(`Split action on ${action.exDate} has an unsupported derived share ratio.`);
        }
        priceFactor /= sharesFactor;
        shareFactor *= sharesFactor;
        if (!Number.isFinite(priceFactor) || !Number.isFinite(shareFactor)) {
          throw new RangeError(`Split action on ${action.exDate} overflows cumulative adjustment factors.`);
        }
      }
    }
    if (priceFactor === 1 && shareFactor === 1) return bar;
    return {
      date: bar.date,
      open: bar.open * priceFactor,
      high: bar.high * priceFactor,
      low: bar.low * priceFactor,
      close: bar.close * priceFactor,
      volume: Math.round(bar.volume * shareFactor),
    };
  });
}

/** Compatibility wrapper for the verified BSE split/bonus feed. */
export function applySplitBonusAdjustments(bars: OHLCVBar[], actions: SplitBonusAction[]): OHLCVBar[] {
  return applyCanonicalCorporateActionAdjustments(
    bars,
    actions.map((action) => ({
      actionType: "split",
      exDate: action.exDate,
      ratioNumerator: 1 / action.adjustmentFactor,
      ratioDenominator: 1,
    })),
  );
}
