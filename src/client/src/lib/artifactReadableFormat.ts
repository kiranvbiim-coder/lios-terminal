// Display-only helpers that turn recorded Artifact values into labels and text a person can read.
// Nothing here mutates or rounds a stored value: every formatted number keeps its exact string
// in `exact`, and callers expose it (tooltip / "Show full precision") so no precision is lost.

const ACRONYMS: Readonly<Record<string, string>> = {
  wacc: "WACC", fcf: "FCF", fcfe: "FCFE", fcff: "FCFF", ebitda: "EBITDA", ebit: "EBIT", eps: "EPS", pv: "PV", ev: "EV",
  roic: "ROIC", roe: "ROE", roa: "ROA", capm: "CAPM", var: "VaR", cvar: "CVaR", cagr: "CAGR", npv: "NPV", irr: "IRR",
  id: "ID", usd: "USD", nav: "NAV", dcf: "DCF", pnl: "P&L", sec: "SEC", ttm: "TTM", ytd: "YTD", ipo: "IPO", esg: "ESG",
  bps: "bps", eur: "EUR", gbp: "GBP", url: "URL", api: "API", fx: "FX", pe: "P/E", ps: "P/S", pb: "P/B", sotp: "SOTP", hrp: "HRP",
};

const LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  waccPct: "WACC",
  waccGridPct: "WACC grid",
  terminalGrowthPct: "Terminal growth",
  terminalGrowthGridPct: "Terminal growth grid",
  netDebt: "Net debt",
  sharesOutstanding: "Shares outstanding",
  freeCashFlows: "Free cash flows",
  valuePerShare: "Value per share",
  valuePerShareMatrix: "Value per share",
  pvExplicitCashFlows: "PV of explicit cash flows",
  pvTerminalValue: "PV of terminal value",
  terminalValue: "Terminal value",
  enterpriseValue: "Enterprise value",
  equityValue: "Equity value",
  exitMultiple: "Exit multiple",
  terminalMetric: "Terminal metric",
  terminalMethod: "Terminal method",
  bearCase: "Bear case",
  bullCase: "Bull case",
  baseCase: "Base case",
  sharpe: "Sharpe ratio",
  sortino: "Sortino ratio",
  maxDrawdownPct: "Max drawdown",
  totalReturnPct: "Total return",
  strategyRef: "Strategy",
  portfolioRef: "Portfolio",
};

/** `netDebt` -> "Net debt", `waccPct` -> "WACC", `free_cash_flows` -> "Free cash flows". */
export function humanizeKey(key: string): string {
  const override = LABEL_OVERRIDES[key];
  if (override) return override;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_.\-/]+/)
    .filter(Boolean);
  while (words.length > 1 && /^(pct|percent|percentage)$/i.test(words[words.length - 1])) words.pop();
  const rendered = words.map((word, index) => {
    const acronym = ACRONYMS[word.toLowerCase()];
    if (acronym) return acronym;
    const lower = word.toLowerCase();
    return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
  });
  return rendered.join(" ") || key;
}

export type ReadableUnit = "percent" | "bps" | "per_share" | "money" | "plain";

// Money is classified only by this explicit allow-list of exact keys; name-pattern guessing mislabels
// fractions such as costImpact or capRate. Unlisted keys are shown as plain numbers.
const MONEY_KEYS: Readonly<Record<string, true>> = {
  netDebt: true, freeCashFlows: true, pvExplicitCashFlows: true, terminalValue: true, pvTerminalValue: true,
  enterpriseValue: true, equityValue: true, marketValue: true, marketEquityValue: true, notional: true,
  pnl: true, realizedPnl: true, unrealizedPnl: true, marketCap: true, revenue: true, currentRevenue: true,
  bookValueEquity: true, proceeds: true,
};

export function unitForKey(key: string): ReadableUnit {
  if (/(Pct|Percent|Percentage)$/.test(key)) return "percent";
  if (/Bps$/i.test(key)) return "bps";
  if (/PerShare$/i.test(key) || /^perShare/i.test(key)) return "per_share";
  if (Object.hasOwn(MONEY_KEYS, key)) return "money";
  return "plain";
}

export interface ReadableValue {
  /** Text for display; may be rounded or scaled. */
  text: string;
  /** Exact stored value as text when the display was formatted; null when `text` already is exact. */
  exact: string | null;
}

export interface ReadableFormatOptions {
  /** Show every digit as stored instead of display rounding/scaling. */
  showExact?: boolean;
  /** Optional ISO currency code recorded with the Artifact; no currency is assumed when absent. */
  currency?: string | null;
  /** Omit the trailing "per share" unit (for table cells whose heading already names the unit). */
  bare?: boolean;
}

const EN = "en-US";

function exactNumber(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function groupNumber(value: number, maxFraction: number): string {
  return new Intl.NumberFormat(EN, { maximumFractionDigits: maxFraction }).format(value);
}

function currencySymbol(currency: string | null | undefined): string {
  if (!currency || !/^[A-Za-z]{3}$/.test(currency)) return "";
  try {
    const part = new Intl.NumberFormat(EN, { style: "currency", currency: currency.toUpperCase(), currencyDisplay: "code" })
      .formatToParts(0).find(item => item.type === "currency");
    return part ? `${part.value} ` : "";
  } catch { return ""; }
}

/** Keeps whole-number and ordinary magnitudes tidy but never rounds a small value to zero. */
function magnitudeAware(value: number, maxFraction: number): string {
  if (value !== 0 && Math.abs(value) < 1) return new Intl.NumberFormat(EN, { maximumSignificantDigits: 4 }).format(value);
  return groupNumber(value, maxFraction);
}

function genericNumber(value: number): string {
  if (Number.isInteger(value)) return groupNumber(value, 0);
  return magnitudeAware(value, 4);
}

export function formatReadableNumber(key: string, value: number, options: ReadableFormatOptions = {}): ReadableValue {
  const exact = exactNumber(value);
  if (!Number.isFinite(value)) return { text: exact, exact: null };
  const unit = unitForKey(key);
  const symbol = currencySymbol(options.currency);
  if (options.showExact) {
    const suffix = unit === "percent" ? "%" : unit === "bps" ? " bps" : unit === "per_share" && !options.bare ? " per share" : "";
    return { text: `${unit === "money" || unit === "per_share" ? symbol : ""}${exact}${suffix}`, exact: null };
  }
  let text: string;
  if (unit === "percent") text = `${magnitudeAware(value, 4)}%`;
  else if (unit === "bps") text = `${magnitudeAware(value, 2)} bps`;
  else if (unit === "per_share") text = `${symbol}${magnitudeAware(value, 2)}${options.bare ? "" : " per share"}`;
  else if (unit === "money") {
    const abs = Math.abs(value);
    if (abs >= 1e12) text = `${symbol}${groupNumber(value / 1e12, 2)} trillion`;
    else if (abs >= 1e9) text = `${symbol}${groupNumber(value / 1e9, 2)} billion`;
    else if (abs >= 1e6) text = `${symbol}${groupNumber(value / 1e6, 2)} million`;
    else text = `${symbol}${magnitudeAware(value, 2)}`;
  } else text = genericNumber(value);
  return { text, exact: text === exact ? null : exact };
}

const HASH = /^[a-f0-9]{64}$/;
const ENUM_LIKE = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)+$/;
const NUMERIC_TEXT = /^-?\d+(?:\.\d+)?$/;

export function formatReadableScalar(key: string, value: unknown, options: ReadableFormatOptions = {}): ReadableValue {
  if (value === null || value === undefined) return { text: "Not recorded", exact: null };
  if (typeof value === "number") return formatReadableNumber(key, value, options);
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", exact: null };
  if (typeof value === "bigint") return { text: String(value), exact: null };
  if (typeof value === "string") {
    if (HASH.test(value)) return { text: `${value.slice(0, 10)}…${value.slice(-6)}`, exact: value };
    // Numeric text is an exact stored decimal; never coerce it through a float.
    if (NUMERIC_TEXT.test(value)) return { text: value, exact: null };
    if (ENUM_LIKE.test(value)) return { text: humanizeKey(value.replaceAll("-", "_")), exact: null };
    return { text: value, exact: null };
  }
  return { text: "Detailed value", exact: null };
}

export interface ReadableRow {
  id: string;
  label: string;
  text: string;
  exact: string | null;
}

const MAX_LIST_ITEMS = 24;
const MAX_NESTED_ITEMS = 25;
const MAX_DEPTH = 3;

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || ["string", "number", "boolean", "bigint"].includes(typeof value);
}

function listText(key: string, items: unknown[], options: ReadableFormatOptions): ReadableValue {
  const shown = items.slice(0, MAX_LIST_ITEMS).map(item => formatReadableScalar(key, item, options));
  const text = shown.map(item => item.text).join(", ") + (items.length > MAX_LIST_ITEMS ? `, … ${items.length - MAX_LIST_ITEMS} more` : "");
  const anyExact = shown.some(item => item.exact !== null);
  return { text, exact: anyExact ? items.slice(0, MAX_LIST_ITEMS).map(item => isScalar(item) ? String(item) : "").join(", ") : null };
}

/** Flatten a recorded object into labelled rows. Never emits JSON; deep structures are summarized. */
export function readableRows(values: Record<string, unknown>, options: ReadableFormatOptions = {}, prefix: string[] = [], depth = 0): ReadableRow[] {
  const rows: ReadableRow[] = [];
  for (const [key, value] of Object.entries(values)) {
    const labelParts = [...prefix, humanizeKey(key)];
    const label = labelParts.join(" › ");
    const id = labelParts.join("/") + `#${rows.length}`;
    if (isScalar(value)) {
      const formatted = formatReadableScalar(key, value, options);
      rows.push({ id, label, ...formatted });
    } else if (Array.isArray(value)) {
      if (!value.length) rows.push({ id, label, text: "None recorded", exact: null });
      else if (value.every(isScalar)) rows.push({ id, label, ...listText(key, value, options) });
      else if (value.every(Array.isArray)) {
        value.slice(0, MAX_NESTED_ITEMS).forEach((row, index) => {
          rows.push({ id: `${id}/${index}`, label: `${label} · row ${index + 1}`, ...listText(key, row as unknown[], options) });
        });
        if (value.length > MAX_NESTED_ITEMS) rows.push({ id: `${id}/more`, label, text: `${value.length - MAX_NESTED_ITEMS} more recorded rows (see Expert view)`, exact: null });
      } else if (depth >= MAX_DEPTH) {
        rows.push({ id, label, text: `${value.length} recorded items (see Expert view)`, exact: null });
      } else {
        value.slice(0, MAX_NESTED_ITEMS).forEach((item, index) => {
          if (typeof item === "object" && item !== null) rows.push(...readableRows(item as Record<string, unknown>, options, [...labelParts, `#${index + 1}`], depth + 1));
          else rows.push({ id: `${id}/${index}`, label: `${label} · item ${index + 1}`, ...formatReadableScalar(key, item, options) });
        });
        if (value.length > MAX_NESTED_ITEMS) rows.push({ id: `${id}/more`, label, text: `${value.length - MAX_NESTED_ITEMS} more recorded items (see Expert view)`, exact: null });
      }
    } else if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      if (!Object.keys(record).length) rows.push({ id, label, text: "None recorded", exact: null });
      else if (depth >= MAX_DEPTH) rows.push({ id, label, text: "Detailed record (see Expert view)", exact: null });
      else rows.push(...readableRows(record, options, labelParts, depth + 1));
    } else {
      rows.push({ id, label, text: "Detailed value (see Expert view)", exact: null });
    }
  }
  return rows;
}

// ---- Plain-language trust labels -------------------------------------------------------------

export type TrustTone = "good" | "caution" | "neutral";
export interface TrustLabel { label: string; detail: string; tone: TrustTone }

const PROVENANCE: Readonly<Record<string, TrustLabel>> = {
  live: { label: "Recorded as live inputs", detail: "The result records live input classification and source references. Inspect evidence for binding and current rights.", tone: "neutral" },
  delayed: { label: "Recorded as delayed inputs", detail: "The result records delayed input classification and source references. Inspect evidence for binding and age.", tone: "neutral" },
  historical: { label: "Recorded historical inputs", detail: "The result records historical input classification and source references. References alone do not establish immutable source custody.", tone: "neutral" },
  cached: { label: "Recorded saved inputs", detail: "The result records cached input classification; inspect source bindings and age before relying on it.", tone: "neutral" },
  fallback: { label: "Fallback source", detail: "A fallback source was used because the preferred one was unavailable. Check freshness before relying on it.", tone: "caution" },
  manual: { label: "Manual inputs you supplied", detail: "Every input was typed or approved by you; no connected data source backs these numbers.", tone: "neutral" },
  synthetic: { label: "Sample data", detail: "Illustrative sample data, not real market or company data.", tone: "caution" },
  model_derived: { label: "Derived from another model", detail: "Inputs came from the recorded output of another model run.", tone: "neutral" },
};

const VALIDATION: Readonly<Record<string, TrustLabel>> = {
  known_answer: { label: "Method has known-answer checks", detail: "The method has known-answer coverage; this scenario is not independently qualified by that status.", tone: "neutral" },
  regression_tested: { label: "Regression tested", detail: "Automated tests guard this calculation against unintended change.", tone: "good" },
  implementation_reviewed: { label: "Implementation reviewed", detail: "The implementation was reviewed but not benchmarked against external results.", tone: "neutral" },
  benchmark_required: { label: "Not yet benchmarked", detail: "This model has not been benchmarked against external results.", tone: "caution" },
  research_only: { label: "Research use only", detail: "Intended for exploration, not for decisions that need validated numbers.", tone: "caution" },
  not_started: { label: "Not validated", detail: "No validation has been recorded for this model.", tone: "caution" },
};

const SOURCE_BOUND: Readonly<Record<string, true>> = { live: true, delayed: true, historical: true, cached: true, fallback: true };

/** Source-bound claims need recorded sources; without any, the honest label is "Source not recorded". */
export function provenanceTrustLabel(classification: unknown, sourceCount?: number): TrustLabel {
  if (typeof classification === "string" && PROVENANCE[classification]) {
    if (!Object.hasOwn(SOURCE_BOUND, classification) || (typeof sourceCount === "number" && sourceCount > 0)) return PROVENANCE[classification];
    return { label: "Source not recorded", detail: "The data was classified as provider-sourced, but this Artifact records no sources, so that cannot be confirmed.", tone: "caution" };
  }
  return { label: "Source not recorded", detail: "This Artifact does not record where its inputs came from.", tone: "caution" };
}

export function validationTrustLabel(level: unknown): TrustLabel | null {
  if (typeof level === "string" && VALIDATION[level]) return VALIDATION[level];
  return null;
}

/** "valuation/dcf-sensitivity" -> "DCF sensitivity"; falls back to the model id's last segment. */
export function modelDisplayName(summary: Record<string, unknown>, modelId?: string | null): string {
  const path = typeof summary.modelPath === "string" ? summary.modelPath : null;
  const source = path ?? (typeof modelId === "string" && modelId ? modelId : "");
  const last = source.split(/[/.]/).filter(Boolean).pop();
  return last ? humanizeKey(last) : "Valuation";
}

// ---- Heat shading ----------------------------------------------------------------------------

export function heatIntensity(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

/** Amber heat ramp that stays readable under light text on the dark Artifact surface. */
export function heatBackground(intensity: number): string {
  return `rgba(252, 211, 77, ${(0.04 + 0.5 * intensity).toFixed(3)})`;
}

/** Stored-record keys that describe the run rather than the analysis; surfaced as trust labels instead. */
export const RUN_METADATA_KEYS: Readonly<Record<string, true>> = {
  modelPath: true, modelId: true, modelVersion: true, validationLevel: true, dataClassification: true,
  inputSnapshotHash: true, outputSnapshotHash: true, professionalReconciliation: true, professionalExport: true,
};

export function omitKeys(values: Record<string, unknown>, keys: Readonly<Record<string, true>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([key]) => !Object.hasOwn(keys, key)));
}

export function formatSavedAt(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(EN, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date) + " UTC";
}

/** Narrow a recorded value to a plain object (not an array); null otherwise. Fields stay `unknown`. */
export function recordOrNull(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
