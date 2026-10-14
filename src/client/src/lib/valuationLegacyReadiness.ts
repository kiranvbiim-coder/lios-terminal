export interface LegacyValuationReadinessInput {
  spot: number | null | undefined;
  marketCap: number | null | undefined;
  revenue: number | null | undefined;
  sharesOutstanding: number | null | undefined;
  balanceSheetAvailable: boolean;
}

export interface LegacyValuationReadiness {
  canRun: boolean;
  blockers: string[];
  warnings: string[];
  resolvedShares: number | null;
  sharesSource: "reported" | "derived-market-cap-over-spot" | "missing";
}

const positive = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

export function assessLegacyValuationReadiness(input: LegacyValuationReadinessInput): LegacyValuationReadiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!positive(input.spot)) blockers.push("Observed market price is unavailable.");
  if (!positive(input.marketCap)) blockers.push("Observed market capitalization is unavailable.");
  if (!positive(input.revenue)) blockers.push("Observed or normalized revenue is unavailable.");
  if (!input.balanceSheetAvailable) blockers.push("A filed or normalized balance sheet is unavailable; net debt and DuPont balance-sheet inputs would otherwise require heuristics.");

  let resolvedShares: number | null = null;
  let sharesSource: LegacyValuationReadiness["sharesSource"] = "missing";
  if (positive(input.sharesOutstanding)) {
    resolvedShares = input.sharesOutstanding;
    sharesSource = "reported";
  } else if (positive(input.marketCap) && positive(input.spot)) {
    resolvedShares = input.marketCap / input.spot;
    sharesSource = "derived-market-cap-over-spot";
    warnings.push("Shares outstanding are derived from observed market cap ÷ observed spot rather than directly reported.");
  } else {
    blockers.push("Shares outstanding cannot be reported or derived from observed market cap and spot.");
  }

  return { canRun: blockers.length === 0, blockers, warnings, resolvedShares, sharesSource };
}
