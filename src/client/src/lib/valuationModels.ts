// Shared valuation math for the Corporate Valuation desk: WACC/cost-of-equity
// build-up, beta levering/unlevering, terminal value methods, the FCFF/FCFE
// distinction, the full EV-to-equity bridge, and a single LBO engine shared
// by the DCF panel's LBO tab and the M&A desk's LBO modeler (previously two
// independent, inconsistent implementations of the same model).
//
// Formulas verified against known relationships before being wired into any
// UI: Hamada lever/unlever round-trips to the input beta; the LBO engine
// reproduces both panels' pre-unification numbers under equivalent inputs
// (single tranche, capex-as-%-of-EBITDA); FCFE + net-debt-financing flows
// reconcile to the same equity value whether built up from FCFF or straight
// from net income.
//
// Real bug found and fixed during a later pass: once every tranche was paid
// down in full, any further free cash flow that year had nowhere to go in
// the paydown loop and was silently discarded -- never added to exit equity,
// never distributed, just dropped. Verified live on a realistic aggressive
// paydown scenario (high growth, low leverage, low capex): 859 of real free
// cash flow vanished on a base of ~2,100 in exit equity, a ~40% understatement.
// Fixed by tracking it explicitly, either accumulated as balance-sheet cash
// to exit (the conservative default) or distributed immediately to the
// sponsor as a real interim dividend recap (opt-in). The recap path also
// makes the existing exit-only CAGR-style IRR formula (moic^(1/n)-1) genuinely
// wrong for the first time -- it's only exact when there's a single cash flow
// at entry and a single one at exit, which recap breaks -- so `irr` is now
// computed by feeding the real per-year sponsor cash-flow array into the same
// Newton-Raphson/bisection solver (`computeIRR`) already used elsewhere in
// this app, not reimplemented. Verified this correctly reproduces the CAGR
// formula exactly when there's no interim distribution, and correctly
// reports a HIGHER IRR than the CAGR shortcut for the same total profit when
// some of it arrives earlier via a recap (22.42% vs. 20.11% IRR on the same
// $150 total profit over 5 years, $50 of it distributed at year 3 instead of
// all $250 at exit) -- the standard, verifiable "cash sooner is worth more"
// identity, not an assumption.
import { computeIRR } from "./quantModels";

export interface WaccInputs {
  riskFreeRate: number; // %
  erp: number; // % equity risk premium
  beta: number; // levered beta
  costOfDebt: number; // % pre-tax
  debtWeight: number; // % of total capital
  taxRate: number; // %
  sizePremium?: number; // % small-cap premium, default 0
  countryRiskPremium?: number; // % sovereign/political risk add-on, default 0
  industryPremium?: number; // % sector-specific add-on, default 0
}

export interface WaccResult {
  costOfEquity: number; // %
  costOfDebtAfterTax: number; // %
  wacc: number; // %
}

// Ke = Rf + β×ERP + size premium + country risk premium + industry premium.
// The three premiums default to zero so this exactly reproduces the plain
// CAPM result when unset -- additive build-up is the standard practitioner
// approach (Duff & Phelps / Ibbotson style) rather than folding them into ERP.
export function computeWacc(inputs: WaccInputs): WaccResult {
  const { riskFreeRate, erp, beta, costOfDebt, debtWeight, taxRate } = inputs;
  const sizePremium = inputs.sizePremium ?? 0;
  const countryRiskPremium = inputs.countryRiskPremium ?? 0;
  const industryPremium = inputs.industryPremium ?? 0;

  const costOfEquity = riskFreeRate + beta * erp + sizePremium + countryRiskPremium + industryPremium;
  const costOfDebtAfterTax = costOfDebt * (1 - taxRate / 100);
  const equityWeight = 100 - debtWeight;
  const wacc = (costOfEquity * equityWeight + costOfDebtAfterTax * debtWeight) / 100;

  return { costOfEquity, costOfDebtAfterTax, wacc };
}

// Hamada equation: strips out the financial-leverage component of a levered
// beta to get the asset (unlevered) beta -- what a peer set's betas should be
// compared on, since leverage differs company to company.
export function unleverBeta(leveredBeta: number, debtToEquity: number, taxRate: number): number {
  return leveredBeta / (1 + (1 - taxRate / 100) * debtToEquity);
}

// Re-levers an unlevered (asset) beta to a target capital structure -- e.g.
// unlever a set of comps, average the asset betas, then relever at the
// subject company's own D/E to get a cleaner beta than its own noisy
// regression beta.
export function leverBeta(unleveredBeta: number, debtToEquity: number, taxRate: number): number {
  return unleveredBeta * (1 + (1 - taxRate / 100) * debtToEquity);
}

// Net debt = short-term debt + long-term debt - cash & equivalents. Negative
// means net cash. This is the standard EV bridge convention; callers should
// prefer this over any market-cap-percentage heuristic whenever real filed
// balance-sheet figures are available.
export function computeNetDebt(shortTermDebt: number, longTermDebt: number, cashAndEquivalents: number): number {
  return shortTermDebt + longTermDebt - cashAndEquivalents;
}

export type TerminalValueMethod = "gordon" | "exitMultiple" | "hybrid" | "valueDriver" | "fadeToMaturity";

export interface TerminalValueInputs {
  method: TerminalValueMethod;
  lastFcf: number; // final explicit-period FCF, for Gordon growth
  lastEbitda: number; // final explicit-period EBITDA, for exit multiple
  discountRate: number; // % (WACC for FCFF, Ke for FCFE)
  terminalGrowth: number; // %
  exitMultiple: number; // x EBITDA
  hybridWeight?: number; // 0-100, weight on Gordon growth vs exit multiple; default 50
  lastNopat?: number; // final explicit-period NOPAT, for the value-driver method; defaults to lastFcf when omitted
  roic?: number; // % return on invested capital, for the value-driver method; default 15
  fadeStartGrowth?: number; // % near-term growth rate at the start of the fade, for fadeToMaturity; defaults to terminalGrowth
  fadeYears?: number; // years over which growth fades linearly to terminalGrowth, for fadeToMaturity; default 5
}

// Terminal value at the end of the explicit forecast, undiscounted (callers
// discount it back at discountRate^n themselves, matching the existing DCF
// worksheet's PV-of-TV step). "hybrid" sanity-checks Gordon growth (which
// can run away if terminalGrowth is set too close to the discount rate)
// against a market-based exit multiple by blending the two. "valueDriver"
// is the standard Gordon-with-ROIC value-driver formula (McKinsey/Koller):
// TV = NOPAT_(n+1) × (1 - g/ROIC) / (r - g), with NOPAT_(n+1) =
// NOPAT_n × (1+g). This makes the reinvestment assumption behind growth
// explicit instead of hiding it inside a single FCF figure.
// "fadeToMaturity" uses the standard closed-form H-Model (Fuller & Hsia): a
// linear fade of the growth rate from fadeStartGrowth down to terminalGrowth
// over fadeYears, avoiding an unrealistic sudden drop from a high
// explicit-period growth rate to a low terminal rate.
export function terminalValue(inputs: TerminalValueInputs): number {
  const finite = (value: number | undefined, fallback = 0): number =>
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  const { method } = inputs;
  const lastFcf = finite(inputs.lastFcf);
  const lastEbitda = finite(inputs.lastEbitda);
  const discountRate = finite(inputs.discountRate);
  const terminalGrowth = finite(inputs.terminalGrowth);
  const exitMultiple = finite(inputs.exitMultiple);
  const r = discountRate / 100;
  const g = terminalGrowth / 100;
  const denominator = r - g;
  const gordon = denominator > 0 ? (lastFcf * (1 + g)) / denominator : 0;

  if (method === "gordon") return Number.isFinite(gordon) ? gordon : 0;
  if (method === "exitMultiple") {
    const exit = lastEbitda * exitMultiple;
    return Number.isFinite(exit) ? exit : 0;
  }
  if (method === "hybrid") {
    const exit = lastEbitda * exitMultiple;
    const weight = Math.max(0, Math.min(100, finite(inputs.hybridWeight, 50))) / 100;
    const blended = gordon * weight + exit * (1 - weight);
    return Number.isFinite(blended) ? blended : 0;
  }
  if (method === "valueDriver") {
    // NOPAT_(n+1) = NOPAT_n × (1+g); steady-state reinvestment is g/ROIC.
    const roic = finite(inputs.roic, 0) / 100;
    const lastNopat = finite(inputs.lastNopat, lastFcf);
    if (!(denominator > 0) || !(roic > 0)) return 0;
    const value = (lastNopat * (1 + g) * (1 - g / roic)) / denominator;
    return Number.isFinite(value) ? value : 0;
  }

  // Standard H-model (Fuller & Hsia): TV = FCF_n ×
  // [1+g_L+H×(g_S−g_L)] / (r−g_L), where H is half the explicit linear
  // fade period. fadeStartGrowth is the post-forecast starting rate.
  if (!(denominator > 0)) return 0;
  const fadeYears = Math.max(0, finite(inputs.fadeYears, 5));
  const fadeStartGrowth = finite(inputs.fadeStartGrowth, terminalGrowth) / 100;
  const h = fadeYears / 2;
  const value = (lastFcf * (1 + g + h * (fadeStartGrowth - g))) / denominator;
  return Number.isFinite(value) ? value : 0;
}

// FCFE from FCFF: subtract the after-tax interest burden the unlevered FCFF
// figure never included, then add back net new borrowing. netBorrowing > 0
// means debt increased (a cash inflow to equity holders); < 0 means the
// company paid down more debt than it raised.
export function fcfeFromFcff(fcff: number, interestExpense: number, taxRate: number, netBorrowing: number): number {
  return fcff - interestExpense * (1 - taxRate / 100) + netBorrowing;
}

export interface EvToEquityBridgeInputs {
  enterpriseValue: number;
  netDebt: number;
  preferredEquity?: number; // default 0
  minorityInterest?: number; // default 0
  pensionLiabilities?: number; // default 0 -- treated as a debt-like claim
  leaseAdjustments?: number; // default 0 -- capitalized operating leases not already in net debt
  nonOperatingAssets?: number; // default 0 -- added back (e.g. excess cash, land held for sale)
  jointVentureStakes?: number; // default 0 -- added back at estimated fair value
}

export interface EvToEquityBridgeResult {
  equityValue: number;
  totalDeductions: number;
  totalAddbacks: number;
}

// Full EV -> equity bridge. The plain "EV - net debt" shortcut only holds
// when there's no preferred equity, minority interest, or off-balance-sheet
// claims/assets -- for a real institutional model those need their own line
// items rather than being silently ignored.
export function evToEquityBridge(inputs: EvToEquityBridgeInputs): EvToEquityBridgeResult {
  const preferredEquity = inputs.preferredEquity ?? 0;
  const minorityInterest = inputs.minorityInterest ?? 0;
  const pensionLiabilities = inputs.pensionLiabilities ?? 0;
  const leaseAdjustments = inputs.leaseAdjustments ?? 0;
  const nonOperatingAssets = inputs.nonOperatingAssets ?? 0;
  const jointVentureStakes = inputs.jointVentureStakes ?? 0;

  const totalDeductions = inputs.netDebt + preferredEquity + minorityInterest + pensionLiabilities + leaseAdjustments;
  const totalAddbacks = nonOperatingAssets + jointVentureStakes;
  const equityValue = Math.max(0, inputs.enterpriseValue - totalDeductions + totalAddbacks);

  return { equityValue, totalDeductions, totalAddbacks };
}

export interface LboTranche {
  id: string;
  label: string;
  leverageMult: number; // x entry EBITDA
  interestRate: number; // % per annum
}

export interface LboInputs {
  entryEbitda: number;
  entryMultiple: number; // x EBITDA
  exitMultiple: number; // x EBITDA
  ebitdaGrowthRate: number; // % per annum, flat across the hold
  capexPctOfEbitda: number; // % of EBITDA reinvested each year
  holdYears: number;
  tranches: LboTranche[]; // paid down in array order (index 0 = most senior)
  // Once every tranche is fully repaid, any further free cash flow that year
  // is real money with nowhere left to go in the paydown loop. false
  // (default): retained as balance-sheet cash, added to exit equity --
  // conservative, no extra assumption needed. true: distributed to the
  // sponsor immediately as a real interim dividend recap, which is what
  // creates a genuine multi-period cash-flow stream (and is why `irr` below
  // is computed with a real IRR solver rather than the exit-only CAGR
  // shortcut that was correct before this option existed).
  distributeExcessCashAsRecap?: boolean;
}

export interface LboYearResult {
  year: number;
  ebitda: number;
  interest: number;
  capex: number;
  freeCashFlow: number;
  debtPaidDown: number;
  totalDebt: number;
  excessCashDistributed: number; // >0 only when distributeExcessCashAsRecap and debt is already fully retired
}

export interface LboResult {
  entryEV: number;
  entryDebt: number;
  sponsorEntryEquity: number;
  exitEbitda: number;
  exitEV: number;
  exitDebt: number;
  accumulatedCash: number; // retained excess FCF added to exit equity (0 if distributeExcessCashAsRecap)
  sponsorExitEquity: number; // exitEV - exitDebt + accumulatedCash
  sponsorCashFlows: number[]; // real per-year array: index 0 = -sponsorEntryEquity, index holdYears includes exit proceeds
  totalSponsorProceeds: number; // sum of every positive sponsor cash flow (interim recaps + exit)
  moic: number; // totalSponsorProceeds / sponsorEntryEquity -- total value, not just exit-value
  irr: number | null; // from computeIRR on sponsorCashFlows; null only if computeIRR can't bracket a root
  yearly: LboYearResult[];
  trancheBalancesRemaining: number[];
}

// Single shared LBO engine: multi-tranche debt paid down in seniority order
// (most senior tranche first) against free cash flow = EBITDA - interest -
// capex, over a fixed hold period, exiting at exitMultiple x terminal EBITDA.
// A single-tranche deal (most LBO calculators' default) is just tranches
// with one entry.
export function runLboModel(inputs: LboInputs): LboResult {
  const { entryEbitda, entryMultiple, exitMultiple, ebitdaGrowthRate, capexPctOfEbitda, holdYears, tranches, distributeExcessCashAsRecap = false } = inputs;

  const entryEV = entryEbitda * entryMultiple;
  const balances = tranches.map((t) => entryEbitda * t.leverageMult);
  const entryDebt = balances.reduce((s, b) => s + b, 0);
  const sponsorEntryEquity = Math.max(1e-6, entryEV - entryDebt);

  let ebitda = entryEbitda;
  let accumulatedCash = 0;
  const yearly: LboYearResult[] = [];
  const interimDistributions: number[] = []; // one entry per year, 0 unless recapping

  for (let year = 1; year <= holdYears; year++) {
    ebitda = ebitda * (1 + ebitdaGrowthRate / 100);
    const interest = balances.reduce((sum, bal, i) => sum + bal * (tranches[i].interestRate / 100), 0);
    const capex = ebitda * (capexPctOfEbitda / 100);
    const freeCashFlow = Math.max(0, ebitda - interest - capex);

    let remaining = freeCashFlow;
    let paidThisYear = 0;
    for (let i = 0; i < balances.length && remaining > 0; i++) {
      const pay = Math.min(balances[i], remaining);
      balances[i] -= pay;
      remaining -= pay;
      paidThisYear += pay;
    }

    // `remaining` here is exactly the free cash flow left over once every
    // tranche is at zero -- previously discarded silently.
    let excessCashDistributed = 0;
    if (remaining > 0) {
      if (distributeExcessCashAsRecap) { excessCashDistributed = remaining; interimDistributions.push(remaining); }
      else { accumulatedCash += remaining; interimDistributions.push(0); }
    } else {
      interimDistributions.push(0);
    }

    yearly.push({
      year, ebitda, interest, capex, freeCashFlow,
      debtPaidDown: paidThisYear,
      totalDebt: balances.reduce((s, b) => s + b, 0),
      excessCashDistributed,
    });
  }

  const exitDebt = balances.reduce((s, b) => s + b, 0);
  const exitEbitda = ebitda;
  const exitEV = exitEbitda * exitMultiple;
  const sponsorExitEquity = Math.max(0, exitEV - exitDebt + accumulatedCash);

  const sponsorCashFlows = [-sponsorEntryEquity, ...interimDistributions.slice(0, -1), interimDistributions[holdYears - 1] + sponsorExitEquity];
  const totalSponsorProceeds = sponsorCashFlows.slice(1).reduce((s, cf) => s + cf, 0);
  const moic = totalSponsorProceeds / sponsorEntryEquity;
  const irr = computeIRR(sponsorCashFlows);

  return {
    entryEV, entryDebt, sponsorEntryEquity,
    exitEbitda, exitEV, exitDebt, accumulatedCash, sponsorExitEquity,
    sponsorCashFlows, totalSponsorProceeds, moic, irr, yearly,
    trancheBalancesRemaining: balances,
  };
}

export interface CarryWaterfallInputs {
  lpCapital: number; // the LP's invested capital -- pass sponsorEntryEquity from LboResult
  sponsorCashFlows: number[]; // pass straight from LboResult -- index 0 is the entry outflow (negative)
  hurdleRatePct: number; // preferred return, e.g. 8
  carryPct: number; // GP carry above the hurdle, e.g. 20
}

export interface CarryWaterfallResult {
  lpNetCashFlows: number[]; // same shape as sponsorCashFlows, LP's share only
  lpNetMoic: number;
  lpNetIrr: number | null;
  gpCarryTotal: number;
  gpCarryPctOfTotalProfit: number; // sanity/reporting figure, not an input
  returnOfCapital: number;
  preferredProfitPaid: number;
  catchupPaid: number;
}

// Standard whole-fund/European-style carry waterfall: (1) return of capital,
// (2) preferred return (hurdle) to the LP, (3) 100% GP catch-up until the GP
// has carryPct of the profit distributed so far, (4) remaining profit split
// (1-carryPct)/carryPct. This is a real, well-known structure with a
// verifiable identity: with a full 100% catch-up, the GP always ends up with
// exactly carryPct of total profit above return of capital, regardless of
// the hurdle rate -- verified against that identity (20.00% exactly on a
// $150-profit/$100-capital/5yr/8%-hurdle/20%-carry case) before shipping.
//
// Simplification, stated plainly rather than hidden: this applies the
// waterfall to the deal's AGGREGATE distributions and then allocates the
// LP's resulting share back across the same years the sponsor actually
// received cash, in proportion to each year's share of total distributions.
// A fully rigorous American-style deal-by-deal waterfall would instead walk
// the tiers chronologically as cash actually arrives, which can cross tier
// boundaries at different times. For a single-deal LBO (not a multi-deal
// fund), the aggregate-then-allocate approach here is the standard
// simplification used in practice for a single transaction's waterfall.
export function applyCarryWaterfall(inputs: CarryWaterfallInputs): CarryWaterfallResult {
  const { lpCapital, sponsorCashFlows, hurdleRatePct, carryPct } = inputs;
  const h = hurdleRatePct / 100, k = carryPct / 100;
  const holdYears = sponsorCashFlows.length - 1;

  const totalDistributions = sponsorCashFlows.slice(1).reduce((s, cf) => s + cf, 0);
  const roc = Math.min(lpCapital, totalDistributions);
  let remaining = totalDistributions - roc;

  const preferredProfitTarget = lpCapital * (Math.pow(1 + h, holdYears) - 1);
  const preferredProfitPaid = Math.min(remaining, preferredProfitTarget);
  remaining -= preferredProfitPaid;

  const catchupTarget = (k / (1 - k)) * preferredProfitPaid;
  const catchupPaid = Math.min(remaining, catchupTarget);
  remaining -= catchupPaid;

  const lpSplit = remaining * (1 - k);
  const gpSplit = remaining * k;

  const lpTotal = roc + preferredProfitPaid + lpSplit;
  const gpCarryTotal = catchupPaid + gpSplit;

  const lpNetCashFlows = sponsorCashFlows.map((cf, i) => {
    if (i === 0) return -lpCapital;
    if (totalDistributions <= 0) return 0;
    return lpTotal * (cf / totalDistributions);
  });

  const totalProfit = totalDistributions - lpCapital;
  const gpCarryPctOfTotalProfit = totalProfit > 0 ? (gpCarryTotal / totalProfit) * 100 : 0;

  return {
    lpNetCashFlows,
    lpNetMoic: lpTotal / lpCapital,
    lpNetIrr: computeIRR(lpNetCashFlows),
    gpCarryTotal, gpCarryPctOfTotalProfit,
    returnOfCapital: roc, preferredProfitPaid, catchupPaid,
  };
}

// ─── Liquidation Value ─────────────────────────────────────────────────────

export interface LiquidationValueInputs {
  cash: number;
  receivables: number;
  inventory: number;
  ppe: number; // net property, plant & equipment
  otherAssets: number;
  totalLiabilities: number;
  // Forced-sale recovery rates by asset category, in %. The defaults below
  // are standard textbook ranges from distressed-investing/restructuring
  // practice (cash converts near 100%; receivables, inventory and PP&E
  // recover progressively less under forced-sale timelines) -- they are
  // industry-typical ASSUMPTIONS, not empirical data about this specific
  // company, and every one is user-editable, matching how size/country/
  // industry premiums are handled in the WACC builder above.
  cashRecoveryPct?: number; // default 100
  receivablesRecoveryPct?: number; // default 80 (typical range ~75-90%)
  inventoryRecoveryPct?: number; // default 60 (typical range ~50-70%)
  ppeRecoveryPct?: number; // default 50 (typical range ~40-60%)
  otherAssetsRecoveryPct?: number; // default 25 -- intangibles/other assets recover least in a forced sale
  liquidationCostPct?: number; // default 10 -- trustee/wind-down costs, % of gross recovery
}

export interface LiquidationValueResult {
  recoveryByCategory: { cash: number; receivables: number; inventory: number; ppe: number; otherAssets: number };
  grossRecovery: number;
  liquidationCosts: number;
  netRecovery: number;
  liquidationValue: number; // netRecovery - totalLiabilities; the residual to equity holders in an orderly wind-down
}

/**
 * Liquidation value: forced-sale recovery of each balance-sheet asset
 * category at an editable recovery-rate assumption, net of liquidation
 * costs (trustee fees, wind-down expenses) and total liabilities. This is
 * the floor valuation a distressed or deeply out-of-favor company should
 * be worth even if operations stopped and the balance sheet were wound
 * down today.
 */
export function computeLiquidationValue(inputs: LiquidationValueInputs): LiquidationValueResult {
  const finite = (value: number): number => Number.isFinite(value) ? value : 0;
  const pct = (value: number | undefined, fallback: number): number =>
    Math.max(0, Math.min(100, finite(value ?? fallback)));
  const recoveryByCategory = {
    cash: finite(inputs.cash) * pct(inputs.cashRecoveryPct, 100) / 100,
    receivables: finite(inputs.receivables) * pct(inputs.receivablesRecoveryPct, 80) / 100,
    inventory: finite(inputs.inventory) * pct(inputs.inventoryRecoveryPct, 60) / 100,
    ppe: finite(inputs.ppe) * pct(inputs.ppeRecoveryPct, 50) / 100,
    otherAssets: finite(inputs.otherAssets) * pct(inputs.otherAssetsRecoveryPct, 25) / 100,
  };
  const grossRecovery = Object.values(recoveryByCategory).reduce((s, v) => s + v, 0);
  const liquidationCosts = grossRecovery * pct(inputs.liquidationCostPct, 10) / 100;
  const netRecovery = grossRecovery - liquidationCosts;
  const liquidationValue = netRecovery - finite(inputs.totalLiabilities);
  return { recoveryByCategory, grossRecovery, liquidationCosts, netRecovery, liquidationValue };
}

// ─── Replacement (Reproduction) Cost ────────────────────────────────────────

export interface ReplacementCostInputs {
  cash: number;
  receivables: number;
  inventory: number;
  netPPE: number;
  otherOperatingAssets: number;
  // Independent estimate of the cost to recreate intangible assets a
  // balance sheet doesn't carry at replacement value at all -- brand,
  // customer relationships, assembled workforce, an acquired distribution
  // network. No live data source exists for this; it is Greenwald's own
  // EPV-method convention (see templates/epv.ts) to take it as an explicit
  // analyst estimate rather than infer one, and this function follows the
  // same convention.
  intangibleRebuildCost: number;
  totalLiabilities: number;
  // Replacement multiples vs. book value, as decimals (1.0 = reproduces at
  // book). Cash and receivables reproduce at (near) face value; inventory
  // and PP&E typically cost MORE to rebuild new today than their net book
  // value reflects, since accumulated depreciation and historical-cost
  // accounting don't track current construction/replacement cost. These
  // are editable, industry-typical assumptions, not company-specific data.
  receivablesReplacementMultiple?: number; // default 1.0
  inventoryReplacementMultiple?: number; // default 1.1
  ppeReplacementMultiple?: number; // default 1.3
}

export interface ReplacementCostResult {
  byCategory: { cash: number; receivables: number; inventory: number; ppe: number; intangibles: number; otherOperatingAssets: number };
  reproductionCostOfAssets: number; // gross, before liabilities
  reproductionCostOfNetAssets: number; // reproductionCostOfAssets - totalLiabilities
}

/**
 * Replacement (reproduction) cost of the net operating asset base: what it
 * would cost a new entrant to rebuild the business's assets from scratch
 * today, restating each filed balance-sheet category at an editable
 * replacement multiple rather than book or liquidation value. Generalizes
 * the single manual `reproductionCostOfAssets` figure the EPV template
 * (templates/epv.ts) already takes as an opaque input into a reusable,
 * auditable build-up from real filed balance-sheet line items. Greenwald's
 * EPV-vs-Reproduction-Cost comparison (this function's own
 * `reproductionCostOfNetAssets` against an independently computed EPV) is
 * the actual moat test: EPV meaningfully above reproduction cost is
 * evidence of a durable competitive advantage.
 */
export function computeReplacementCost(inputs: ReplacementCostInputs): ReplacementCostResult {
  const finite = (value: number): number => Number.isFinite(value) ? value : 0;
  const multiple = (value: number | undefined, fallback: number): number =>
    Math.max(0, finite(value ?? fallback));
  const byCategory = {
    cash: Math.max(0, finite(inputs.cash)),
    receivables: Math.max(0, finite(inputs.receivables)) * multiple(inputs.receivablesReplacementMultiple, 1),
    inventory: Math.max(0, finite(inputs.inventory)) * multiple(inputs.inventoryReplacementMultiple, 1.1),
    ppe: Math.max(0, finite(inputs.netPPE)) * multiple(inputs.ppeReplacementMultiple, 1.3),
    intangibles: Math.max(0, finite(inputs.intangibleRebuildCost)),
    otherOperatingAssets: Math.max(0, finite(inputs.otherOperatingAssets)),
  };
  const reproductionCostOfAssets = Object.values(byCategory).reduce((s, v) => s + v, 0);
  const reproductionCostOfNetAssets = reproductionCostOfAssets - finite(inputs.totalLiabilities);
  return { byCategory, reproductionCostOfAssets, reproductionCostOfNetAssets };
}

export interface CreditRatingBand {
  minCoverage: number; // x, EBIT / Interest Expense, inclusive lower bound of this band
  rating: string;
  spreadPct: number; // % indicative credit spread over the risk-free rate for this band
}

// Damodaran-style "synthetic rating" table: maps an interest-coverage
// ratio to an illustrative letter-rating band and indicative credit
// spread, for estimating a marginal cost of debt when no live bond rating
// or market spread exists (private companies, unrated issuers, or a
// hypothetical capital structure). These bands and spreads are standard,
// widely-used illustrative assumptions from credit-analysis practice --
// explicitly NOT a live feed from any rating agency, matching the same
// "illustrative, not agency methodology" framing already used for the
// simplified rating band in templates/creditAnalysis.ts. Every threshold
// and spread is a caller-editable assumption; this table is only the
// default.
export const DEFAULT_CREDIT_RATING_TABLE: CreditRatingBand[] = [
  { minCoverage: 8.5, rating: "AAA", spreadPct: 0.75 },
  { minCoverage: 6.5, rating: "AA", spreadPct: 1.00 },
  { minCoverage: 5.5, rating: "A+", spreadPct: 1.15 },
  { minCoverage: 4.25, rating: "A", spreadPct: 1.30 },
  { minCoverage: 3.0, rating: "A-", spreadPct: 1.55 },
  { minCoverage: 2.5, rating: "BBB", spreadPct: 2.10 },
  { minCoverage: 2.25, rating: "BB+", spreadPct: 2.80 },
  { minCoverage: 2.0, rating: "BB", spreadPct: 3.50 },
  { minCoverage: 1.75, rating: "B+", spreadPct: 4.25 },
  { minCoverage: 1.5, rating: "B", spreadPct: 5.50 },
  { minCoverage: 1.25, rating: "B-", spreadPct: 6.50 },
  { minCoverage: 0.8, rating: "CCC", spreadPct: 8.50 },
  { minCoverage: 0.5, rating: "CC", spreadPct: 10.50 },
  { minCoverage: -Infinity, rating: "D", spreadPct: 14.00 },
];

export interface SyntheticRatingResult {
  rating: string;
  spreadPct: number;
  costOfDebt: number; // % = riskFreeRate + spreadPct
  interestCoverage: number;
}

/**
 * Synthetic-rating-driven marginal cost of debt: maps a real interest-
 * coverage ratio (EBIT / Interest Expense) to a rating band and indicative
 * credit spread via `table` (defaults to DEFAULT_CREDIT_RATING_TABLE),
 * then adds that spread to the risk-free rate. Generalizes the IF/AND
 * rating-band formula already used narrowly in templates/creditAnalysis.ts's
 * "ILLUSTRATIVE CREDIT PROFILE" row into a shared, reusable, fully
 * overridable function.
 */
export function syntheticCreditRating(
  interestCoverage: number,
  riskFreeRate: number, // %
  table: CreditRatingBand[] = DEFAULT_CREDIT_RATING_TABLE,
): SyntheticRatingResult {
  const coverage = Number.isFinite(interestCoverage) ? interestCoverage : -Infinity;
  const rf = Number.isFinite(riskFreeRate) ? riskFreeRate : 0;
  const sorted = table
    .filter((band) => Number.isFinite(band.minCoverage) || band.minCoverage === -Infinity)
    .filter((band) => Number.isFinite(band.spreadPct) && typeof band.rating === "string")
    .slice()
    .sort((a, b) => b.minCoverage - a.minCoverage);
  const band = sorted.find((candidate) => coverage >= candidate.minCoverage);
  if (!band) return { rating: "NR", spreadPct: 0, costOfDebt: rf, interestCoverage: coverage };
  return {
    rating: band.rating,
    spreadPct: band.spreadPct,
    costOfDebt: rf + band.spreadPct,
    interestCoverage: coverage,
  };
}

// ─── Factor-Based Cost of Equity ────────────────────────────────────────────

export interface FactorCostOfEquityInputs {
  riskFreeRate: number; // % annualized
  factorLoadings: number[]; // regression betas (e.g. from olsRegression in quantModels.ts), one per factor
  factorPremia: number[]; // % annualized long-run premium per factor, same order as factorLoadings
}

export interface FactorCostOfEquityResult {
  costOfEquity: number; // %
  factorContributions: number[]; // % contribution of each factor (loading x premium), same order as inputs
}

/**
 * Factor-based cost of equity: Ke = Rf + Σ(factor loading × factor risk
 * premium). Inputs use percentage units, so a loading of 1.2 and a premium
 * of 5 produce a 6 percentage-point contribution.
 */
export function factorCostOfEquity(inputs: FactorCostOfEquityInputs): FactorCostOfEquityResult {
  const riskFreeRate = Number.isFinite(inputs.riskFreeRate) ? inputs.riskFreeRate : 0;
  const n = Math.min(inputs.factorLoadings.length, inputs.factorPremia.length);
  const factorContributions = Array.from({ length: n }, (_, i) => {
    const loading = Number.isFinite(inputs.factorLoadings[i]) ? inputs.factorLoadings[i] : 0;
    const premium = Number.isFinite(inputs.factorPremia[i]) ? inputs.factorPremia[i] : 0;
    return loading * premium;
  });
  const costOfEquity = riskFreeRate + factorContributions.reduce((s, c) => s + c, 0);
  return { costOfEquity: Number.isFinite(costOfEquity) ? costOfEquity : riskFreeRate, factorContributions };
}
