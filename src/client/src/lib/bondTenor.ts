// Parses a standard bond tenor code (e.g. "10Y", "3M", "1W", "10-Year",
// "3 Month") out of a symbol or display name into fractional years. Used to
// order a country's bond catalog rows into a proper maturity-ascending
// curve without assuming any particular vendor symbol format -- LSE's
// screenCatalog rows carry a free-text symbol/name, not a structured
// maturity field (see server/lseData.ts's LseCatalogRow), so this only ever
// returns a value when the text unambiguously matches the near-universal
// "<number><D|W|M|Y>" tenor convention (FRED, Treasury.gov, and every major
// data vendor use exactly this notation). Anything else returns null rather
// than guessing, so an unrecognized instrument is excluded from the curve
// instead of silently mis-ordered.
const UNIT_YEARS: Record<string, number> = { D: 1 / 365, W: 7 / 365, M: 1 / 12, Y: 1 };

export function parseTenorYears(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*[-\s]?\s*(day|week|month|year|d|w|m|y)\b/i);
  if (!match) return null;
  const magnitude = Number(match[1]);
  if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
  const unitKey = match[2][0].toUpperCase();
  const unitYears = UNIT_YEARS[unitKey];
  if (unitYears === undefined) return null;
  return magnitude * unitYears;
}

export function formatTenorLabel(years: number): string {
  if (years < 1 / 30) return `${Math.round(years * 365)}D`;
  if (years < 1) return `${Math.round(years * 12)}M`;
  return `${Number.isInteger(years) ? years : years.toFixed(1)}Y`;
}
