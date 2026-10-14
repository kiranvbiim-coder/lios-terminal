/**
 * Earnings Power Value (EPV) -- Bruce Greenwald's deliberately conservative
 * alternative to a growth DCF: capitalize NORMALIZED, sustainable current
 * earnings as a zero-growth perpetuity (NOPAT / WACC), with no terminal-
 * growth assumption to smuggle in optimism. The payoff is the comparison
 * against Reproduction Cost -- an independent estimate of what it would
 * cost a new entrant to replicate the asset base. EPV meaningfully above
 * reproduction cost is evidence of a real competitive moat (the business
 * earns more than the cost of duplicating its assets); EPV at or below
 * reproduction cost means the market isn't paying for any franchise value
 * at all, which is exactly the kind of unglamorous, high-margin-of-safety
 * setup this method was built to find.
 */

export interface EpvInputs {
  normalizedRevenue: number;
  normalizedEbitMarginPct: number;
  taxRatePct: number;
  waccPct: number;                   // the no-growth discount rate
  reproductionCostOfAssets: number;  // independent estimate of what it would cost to replicate the asset base
  netDebt: number;
  sharesOutstanding: number;
}

export const DEFAULT_EPV_INPUTS: EpvInputs = {
  normalizedRevenue: 1000,
  normalizedEbitMarginPct: 15,
  taxRatePct: 25,
  waccPct: 9,
  reproductionCostOfAssets: 900,
  netDebt: 200,
  sharesOutstanding: 100,
};

export function buildEpvModel(inputs: EpvInputs = DEFAULT_EPV_INPUTS): Record<string, string> {
  const { normalizedRevenue, normalizedEbitMarginPct, taxRatePct, waccPct, reproductionCostOfAssets, netDebt, sharesOutstanding } = inputs;
  const cells: Record<string, string> = {};
  const set = (ref: string, raw: string) => { cells[ref] = raw; };

  set("A1", "EARNINGS POWER VALUE (EPV)");

  set("A3", "ASSUMPTIONS -- normalized, sustainable figures (edit these -- the model recalculates live)");
  set("A4", "Normalized Revenue ($M)");             set("C4", String(normalizedRevenue));
  set("A5", "Normalized EBIT Margin %");             set("C5", String(normalizedEbitMarginPct));
  set("A6", "Tax Rate %");                           set("C6", String(taxRatePct));
  set("A7", "WACC % (no-growth discount rate)");     set("C7", String(waccPct));
  set("A8", "Reproduction Cost of Assets ($M)");     set("C8", String(reproductionCostOfAssets));
  set("A9", "Net Debt ($M)");                        set("C9", String(netDebt));
  set("A10", "Shares Outstanding (M)");              set("C10", String(sharesOutstanding));

  const rEbit = 12; set(`A${rEbit}`, "Normalized EBIT"); set(`C${rEbit}`, "=C4*C5/100");
  const rNopat = rEbit + 1; set(`A${rNopat}`, "NOPAT (EBIT x (1 - Tax Rate))"); set(`C${rNopat}`, `=C${rEbit}*(1-C6/100)`);

  const rEpvOps = rNopat + 2; set(`A${rEpvOps}`, "EPV OF OPERATIONS (NOPAT / WACC, zero growth)"); set(`C${rEpvOps}`, `=C${rNopat}/(C7/100)`);
  const rEpvEquity = rEpvOps + 1; set(`A${rEpvEquity}`, "EPV OF EQUITY (EPV of Ops - Net Debt)"); set(`C${rEpvEquity}`, `=C${rEpvOps}-C9`);
  const rEpvPerShare = rEpvEquity + 1; set(`A${rEpvPerShare}`, "EPV PER SHARE ($)"); set(`C${rEpvPerShare}`, `=C${rEpvEquity}/C10`);

  const rFranchise = rEpvPerShare + 2; set(`A${rFranchise}`, "Franchise (Moat) Value (EPV of Ops - Reproduction Cost)"); set(`C${rFranchise}`, `=C${rEpvOps}-C8`);
  const rFranchiseNote = rFranchise + 1;
  set(`A${rFranchiseNote}`, "Interpretation: > 0 implies a durable competitive advantage; <= 0 implies no franchise premium over asset replacement cost");

  return cells;
}
