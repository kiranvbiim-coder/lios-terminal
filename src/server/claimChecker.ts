/**
 * Claim checker v2: every figure in AI prose must be traceable to the deterministic result (or the
 * user's own message). AI may explain, but it must not introduce numbers, so a figure that cannot be
 * found in the authoritative text is reported and the caller withholds the prose.
 *
 * A matching number alone is not a verified claim (roadmap §0.0.12 D). A figure verifies only when an
 * authoritative figure agrees on value, on explicit sign, on currency when both state one, and on
 * metric when both are labelled. Small counts are not gated, but unsupported ones are reported as
 * `unchecked` so callers never imply full verification. Qualitative statements are out of scope.
 */
export interface ClaimCheckResult {
  ok: boolean;
  checked: number;
  unverified: string[];
  /** Small counts the checker does not gate on and could not find in the sources. */
  unchecked: string[];
  /** True only when every figure, including small counts, was found in the sources. */
  allFiguresChecked: boolean;
}

interface Figure {
  raw: string;
  value: number;
  decimals: number;
  percent: boolean;
  hasUnit: boolean;
  explicitSign: boolean;
  currency: string | null;
  metrics: string[];
}

const MULTIPLIERS: Record<string, number> = {
  k: 1e3, thousand: 1e3,
  m: 1e6, mm: 1e6, million: 1e6,
  b: 1e9, bn: 1e9, billion: 1e9,
  t: 1e12, trillion: 1e12,
};

const CURRENCY_SYMBOLS: Record<string, string> = { "$": "USD", "us$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR" };
const ISO_CURRENCY = "USD|EUR|GBP|JPY|INR|CHF|CAD|AUD|CNY|HKD";

// Canonical metric groups. A labelled claim must use only groups its source figure carries.
const METRIC_PATTERNS: Array<[string, RegExp]> = [
  ["revenue", /\b(revenue|revenues|sales|top[- ]line)\b/i],
  ["growth", /\b(growth|grew|grow|increase[sd]?|decline[sd]?|yoy|y\/y)\b/i],
  ["margin", /\bmargins?\b/i],
  ["eps", /\b(eps|earnings per share)\b/i],
  ["ebitda", /\bebitda\b/i],
  ["ebit", /\b(ebit|operating income|operating profit)\b/i],
  ["net_income", /\b(net income|net profit|net earnings)\b/i],
  ["fcf", /\b(fcf|free cash flow)\b/i],
  ["price", /\b(price|trades?|trading|last|close[ds]?|quote[ds]?)\b/i],
  ["market_cap", /\b(market cap|market capitali[sz]ation)\b/i],
  ["multiple", /\b(p\/e|pe ratio|multiple|ev\/ebitda)\b/i],
  ["wacc", /\b(wacc|discount rate|cost of capital)\b/i],
  ["yield", /\b(yield|dividend)\b/i],
  ["rsi", /\brsi\b/i],
  ["volatility", /\b(volatility|vol)\b/i],
  ["beta", /\bbeta\b/i],
  ["debt", /\b(debt|leverage)\b/i],
  ["return", /\b(return|roe|roic|roa)\b/i],
  ["level", /\b(support|resistance|target)\b/i],
];

const FIGURE = /(?<![\w.])([-+−]?)(us\$|\$|€|£|¥|₹)?(\d[\d,]*(?:\.\d+)?)\s?(%|bps|bp|x|k|mm|m|bn|b|t|thousand|million|billion|trillion)?(?![\w])/gi;
// Clause boundaries for metric labels; a decimal point is not a boundary.
const BOUNDARY = /[;\n]|[.!?:](?=\s|$)|,\s/g;

function metricsIn(text: string): string[] {
  return METRIC_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([metric]) => metric);
}

function extractFigures(text: string): Figure[] {
  // Ordered-list markers ("1.", "2)") are formatting, not figures.
  const cleaned = text.replace(/^\s*\d+[.)]\s+/gm, "");
  const matches = [...cleaned.matchAll(FIGURE)];
  const figures: Figure[] = [];
  matches.forEach((match, index) => {
    const digits = match[3].replace(/,/g, "");
    const unit = (match[4] ?? "").toLowerCase();
    const base = Number(digits);
    if (!Number.isFinite(base)) return;
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const previousEnd = index > 0 ? (matches[index - 1].index ?? 0) + matches[index - 1][0].length : 0;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index ?? cleaned.length : cleaned.length;

    const before = cleaned.slice(Math.max(previousEnd, start - 48), start);
    const after = cleaned.slice(end, Math.min(nextStart, end + 32));
    const beforeClause = before.split(BOUNDARY).pop() ?? "";
    const afterClause = after.split(BOUNDARY)[0] ?? "";
    const labelled = metricsIn(beforeClause);

    const symbol = match[2]?.toLowerCase();
    const isoAfter = new RegExp(`^\\s?(${ISO_CURRENCY})\\b`).exec(after)?.[1];
    const isoBefore = new RegExp(`\\b(${ISO_CURRENCY})\\s?$`).exec(before)?.[1];
    const sign = match[1] === "-" || match[1] === "−" ? -1 : 1;
    figures.push({
      raw: match[0].trim(),
      value: sign * base * (MULTIPLIERS[unit] ?? 1),
      decimals: digits.includes(".") ? digits.split(".")[1].length : 0,
      percent: unit === "%",
      hasUnit: unit !== "" || Boolean(symbol),
      explicitSign: match[1] !== "",
      currency: (symbol ? CURRENCY_SYMBOLS[symbol] : null) ?? isoAfter ?? isoBefore ?? null,
      // A label normally precedes its figure; "8.2% revenue growth" falls back to what follows.
      metrics: labelled.length > 0 ? labelled : metricsIn(afterClause),
    });
  });
  return figures;
}

function unitScale(claim: Figure): number {
  // A claim like "$1.2 billion" is precise to 0.05 billion, not 0.05 dollars.
  const unit = /(thousand|million|billion|trillion|bn|mm|k|m|b|t)\s*$/.exec(claim.raw.toLowerCase())?.[1];
  return unit ? MULTIPLIERS[unit] ?? 1 : 1;
}

function valueMatches(claim: Figure, source: Figure): boolean {
  const tolerance = 0.5 * Math.pow(10, -claim.decimals) * unitScale(claim) + 1e-9 * Math.max(1, Math.abs(source.value));
  // "15.3%" in prose may be 0.153 in an engine table, and vice versa.
  const candidates = claim.percent ? [source.value, source.value * 100, source.value / 100] : [source.value];
  return candidates.some((candidate) =>
    claim.explicitSign
      ? Math.abs(claim.value - candidate) <= tolerance
      : Math.abs(Math.abs(claim.value) - Math.abs(candidate)) <= tolerance,
  );
}

function matches(claim: Figure, source: Figure): boolean {
  if (claim.currency && source.currency && claim.currency !== source.currency) return false;
  if (claim.metrics.length > 0 && source.metrics.length > 0
    && !claim.metrics.every((metric) => source.metrics.includes(metric))) return false;
  return valueMatches(claim, source);
}

export function checkClaims(prose: string, authoritativeSources: readonly string[]): ClaimCheckResult {
  const sources = authoritativeSources.flatMap((text) => extractFigures(text));
  // Calendar years are not financial claims.
  const figures = extractFigures(prose).filter((figure) =>
    figure.hasUnit || figure.decimals > 0 || figure.value < 1900 || figure.value > 2100);
  const unverified: string[] = [];
  const unchecked: string[] = [];
  let checked = 0;
  for (const figure of figures) {
    const found = sources.some((source) => matches(figure, source));
    if (!figure.hasUnit && figure.decimals === 0 && Math.abs(figure.value) <= 10) {
      if (!found && !unchecked.includes(figure.raw)) unchecked.push(figure.raw);
      continue;
    }
    checked += 1;
    if (!found && !unverified.includes(figure.raw)) unverified.push(figure.raw);
  }
  return {
    ok: unverified.length === 0,
    checked,
    unverified,
    unchecked,
    allFiguresChecked: unverified.length === 0 && unchecked.length === 0,
  };
}
