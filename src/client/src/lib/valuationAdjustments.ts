export interface ResearchExpenseVintage {
  ageYears: number;
  expense: number;
}

export interface CapitalizedResearchResult {
  amortizationLifeYears: number;
  researchAsset: number;
  currentAmortization: number;
  currentResearchExpense: number;
  adjustedOperatingIncome: number;
  adjustedInvestedCapital: number;
  vintages: Array<ResearchExpenseVintage & { unamortizedFraction: number; assetValue: number; annualAmortization: number }>;
}

export interface NolTaxYearInput {
  preTaxOperatingIncome: number;
  statutoryTaxRatePct: number;
  newTaxCredits?: number;
}

export interface NolTaxYearResult extends NolTaxYearInput {
  year: number;
  openingNol: number;
  newNolGenerated: number;
  nolUtilized: number;
  closingNol: number;
  taxableIncomeAfterNol: number;
  grossCashTax: number;
  taxCreditsUsed: number;
  cashTax: number;
  cashTaxRatePct: number | null;
}

export interface WorkingCapitalDriverInput {
  revenue: number;
  costOfRevenue: number;
  dsoDays: number;
  dioDays: number;
  dpoDays: number;
  deferredRevenueDays?: number;
  otherOperatingAssetsPctRevenue?: number;
  otherOperatingLiabilitiesPctRevenue?: number;
}

export interface WorkingCapitalDriverResult {
  receivables: number;
  inventory: number;
  payables: number;
  deferredRevenue: number;
  otherOperatingAssets: number;
  otherOperatingLiabilities: number;
  operatingNetWorkingCapital: number;
}

export interface PpeYearInput {
  maintenanceCapex: number;
  growthCapex: number;
  depreciation: number;
  assetDisposals?: number;
}

export interface PpeYearResult extends PpeYearInput {
  year: number;
  openingNetPpe: number;
  totalCapex: number;
  closingNetPpe: number;
  netInvestment: number;
}

export interface DebtYearInput {
  issuance: number;
  contractualMaturities: number;
  discretionaryRepayment?: number;
  cashSweep?: number;
  annualInterestRatePct: number;
}

export interface DebtYearResult extends DebtYearInput {
  year: number;
  openingDebt: number;
  repayment: number;
  closingDebt: number;
  averageDebt: number;
  interestExpense: number;
  netBorrowing: number;
}

export interface DilutionYearInput {
  rsusGranted: number;
  rsusVested?: number;
  optionsOutstanding?: number;
  optionStrikePrice?: number;
  warrantsOutstanding?: number;
  warrantStrikePrice?: number;
  sharePrice: number;
  sharesRepurchased?: number;
  sharesIssuedForAcquisitions?: number;
}

export interface DilutionYearResult extends DilutionYearInput {
  year: number;
  openingBasicShares: number;
  treasuryMethodOptionDilution: number;
  treasuryMethodWarrantDilution: number;
  grossIncrementalShares: number;
  endingBasicShares: number;
  endingDilutedShares: number;
}

const finite = (value: number | null | undefined, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

/**
 * Capitalize R&D/research spending as an economic asset using transparent
 * straight-line amortization. `vintages` must contain the current expense at
 * age 0 plus as many prior annual expenses as the analyst/source can support.
 * Missing historical vintages are never back-filled or synthesized.
 */
export function capitalizeResearchAndDevelopment(args: {
  reportedOperatingIncome: number;
  reportedInvestedCapital: number;
  amortizationLifeYears: number;
  vintages: ResearchExpenseVintage[];
}): CapitalizedResearchResult {
  const life = Math.max(1, Math.round(finite(args.amortizationLifeYears, 1)));
  const normalized = args.vintages
    .filter(vintage => vintage.ageYears >= 0 && vintage.ageYears < life && Number.isFinite(vintage.expense))
    .map(vintage => {
      const age = Math.floor(vintage.ageYears);
      const expense = Math.max(0, vintage.expense);
      const unamortizedFraction = clamp(1 - age / life, 0, 1);
      const annualAmortization = age > 0 ? expense / life : 0;
      return {
        ageYears: age,
        expense,
        unamortizedFraction,
        assetValue: expense * unamortizedFraction,
        annualAmortization,
      };
    })
    .sort((a, b) => a.ageYears - b.ageYears);

  const researchAsset = normalized.reduce((sum, vintage) => sum + vintage.assetValue, 0);
  const currentAmortization = normalized.reduce((sum, vintage) => sum + vintage.annualAmortization, 0);
  const currentResearchExpense = normalized.find(vintage => vintage.ageYears === 0)?.expense ?? 0;
  const adjustedOperatingIncome = finite(args.reportedOperatingIncome) + currentResearchExpense - currentAmortization;
  const adjustedInvestedCapital = finite(args.reportedInvestedCapital) + researchAsset;

  return {
    amortizationLifeYears: life,
    researchAsset,
    currentAmortization,
    currentResearchExpense,
    adjustedOperatingIncome,
    adjustedInvestedCapital,
    vintages: normalized,
  };
}

/**
 * Deterministic cash-tax/NOL roll-forward. Negative operating income creates
 * NOLs. Positive income consumes NOLs only up to the analyst-entered annual
 * utilization percentage. Tax credits are applied after the NOL deduction.
 */
export function buildNolCashTaxSchedule(args: {
  openingNol: number;
  openingTaxCredits?: number;
  nolUtilizationLimitPct?: number;
  years: NolTaxYearInput[];
}): NolTaxYearResult[] {
  let nol = Math.max(0, finite(args.openingNol));
  let taxCredits = Math.max(0, finite(args.openingTaxCredits));
  const limitPct = clamp(finite(args.nolUtilizationLimitPct, 100), 0, 100);

  return args.years.map((input, index) => {
    taxCredits += Math.max(0, finite(input.newTaxCredits));
    const preTax = finite(input.preTaxOperatingIncome);
    const openingNol = nol;
    const newNolGenerated = Math.max(0, -preTax);
    const positiveIncome = Math.max(0, preTax);
    const utilizationCap = positiveIncome * limitPct / 100;
    const nolUtilized = Math.min(openingNol, utilizationCap);
    const taxableIncomeAfterNol = Math.max(0, positiveIncome - nolUtilized);
    const grossCashTax = taxableIncomeAfterNol * clamp(finite(input.statutoryTaxRatePct), 0, 100) / 100;
    const taxCreditsUsed = Math.min(taxCredits, grossCashTax);
    const cashTax = Math.max(0, grossCashTax - taxCreditsUsed);
    taxCredits -= taxCreditsUsed;
    nol = openingNol - nolUtilized + newNolGenerated;
    const cashTaxRatePct = positiveIncome > 0 ? (cashTax / positiveIncome) * 100 : null;
    return {
      ...input,
      year: index + 1,
      openingNol,
      newNolGenerated,
      nolUtilized,
      closingNol: nol,
      taxableIncomeAfterNol,
      grossCashTax,
      taxCreditsUsed,
      cashTax,
      cashTaxRatePct,
    };
  });
}

export function computeWorkingCapitalFromDrivers(input: WorkingCapitalDriverInput): WorkingCapitalDriverResult {
  const revenue = Math.max(0, finite(input.revenue));
  const cogs = Math.max(0, finite(input.costOfRevenue));
  const receivables = revenue * Math.max(0, finite(input.dsoDays)) / 365;
  const inventory = cogs * Math.max(0, finite(input.dioDays)) / 365;
  const payables = cogs * Math.max(0, finite(input.dpoDays)) / 365;
  const deferredRevenue = revenue * Math.max(0, finite(input.deferredRevenueDays)) / 365;
  const otherOperatingAssets = revenue * finite(input.otherOperatingAssetsPctRevenue) / 100;
  const otherOperatingLiabilities = revenue * finite(input.otherOperatingLiabilitiesPctRevenue) / 100;
  const operatingNetWorkingCapital = receivables + inventory + otherOperatingAssets
    - payables - deferredRevenue - otherOperatingLiabilities;
  return { receivables, inventory, payables, deferredRevenue, otherOperatingAssets, otherOperatingLiabilities, operatingNetWorkingCapital };
}

export function buildWorkingCapitalSchedule(args: {
  openingNetWorkingCapital: number;
  years: WorkingCapitalDriverInput[];
}): Array<WorkingCapitalDriverResult & { year: number; openingNetWorkingCapital: number; changeInNetWorkingCapital: number }> {
  let opening = finite(args.openingNetWorkingCapital);
  return args.years.map((input, index) => {
    const computed = computeWorkingCapitalFromDrivers(input);
    const changeInNetWorkingCapital = computed.operatingNetWorkingCapital - opening;
    const result = { ...computed, year: index + 1, openingNetWorkingCapital: opening, changeInNetWorkingCapital };
    opening = computed.operatingNetWorkingCapital;
    return result;
  });
}

export function buildPpeSchedule(openingNetPpe: number, years: PpeYearInput[]): PpeYearResult[] {
  let opening = Math.max(0, finite(openingNetPpe));
  return years.map((input, index) => {
    const maintenanceCapex = Math.max(0, finite(input.maintenanceCapex));
    const growthCapex = Math.max(0, finite(input.growthCapex));
    const depreciation = Math.max(0, finite(input.depreciation));
    const assetDisposals = Math.max(0, finite(input.assetDisposals));
    const totalCapex = maintenanceCapex + growthCapex;
    const closingNetPpe = Math.max(0, opening + totalCapex - depreciation - assetDisposals);
    const netInvestment = totalCapex - depreciation - assetDisposals;
    const result: PpeYearResult = {
      ...input,
      year: index + 1,
      openingNetPpe: opening,
      maintenanceCapex,
      growthCapex,
      depreciation,
      assetDisposals,
      totalCapex,
      closingNetPpe,
      netInvestment,
    };
    opening = closingNetPpe;
    return result;
  });
}

export function buildDebtSchedule(openingDebt: number, years: DebtYearInput[]): DebtYearResult[] {
  let opening = Math.max(0, finite(openingDebt));
  return years.map((input, index) => {
    const issuance = Math.max(0, finite(input.issuance));
    const requestedRepayment = Math.max(0, finite(input.contractualMaturities))
      + Math.max(0, finite(input.discretionaryRepayment))
      + Math.max(0, finite(input.cashSweep));
    const availableDebt = opening + issuance;
    const repayment = Math.min(availableDebt, requestedRepayment);
    const closingDebt = availableDebt - repayment;
    const averageDebt = (opening + closingDebt) / 2;
    const interestExpense = averageDebt * Math.max(0, finite(input.annualInterestRatePct)) / 100;
    const netBorrowing = issuance - repayment;
    const result: DebtYearResult = {
      ...input,
      year: index + 1,
      openingDebt: opening,
      issuance,
      contractualMaturities: Math.max(0, finite(input.contractualMaturities)),
      discretionaryRepayment: Math.max(0, finite(input.discretionaryRepayment)),
      cashSweep: Math.max(0, finite(input.cashSweep)),
      annualInterestRatePct: Math.max(0, finite(input.annualInterestRatePct)),
      repayment,
      closingDebt,
      averageDebt,
      interestExpense,
      netBorrowing,
    };
    opening = closingDebt;
    return result;
  });
}

function treasuryMethodDilution(count: number | undefined, strike: number | undefined, sharePrice: number): number {
  const options = Math.max(0, finite(count));
  const exercise = Math.max(0, finite(strike));
  if (!(sharePrice > 0) || options === 0 || exercise >= sharePrice) return 0;
  return options * (1 - exercise / sharePrice);
}

export function buildDilutedShareSchedule(openingBasicShares: number, years: DilutionYearInput[]): DilutionYearResult[] {
  let opening = Math.max(0, finite(openingBasicShares));
  return years.map((input, index) => {
    const rsusGranted = Math.max(0, finite(input.rsusGranted));
    const rsusVested = Math.max(0, finite(input.rsusVested, rsusGranted));
    const repurchased = Math.max(0, finite(input.sharesRepurchased));
    const acquisitionShares = Math.max(0, finite(input.sharesIssuedForAcquisitions));
    const sharePrice = Math.max(0, finite(input.sharePrice));
    const treasuryMethodOptionDilution = treasuryMethodDilution(input.optionsOutstanding, input.optionStrikePrice, sharePrice);
    const treasuryMethodWarrantDilution = treasuryMethodDilution(input.warrantsOutstanding, input.warrantStrikePrice, sharePrice);
    const endingBasicShares = Math.max(0, opening + rsusVested + acquisitionShares - repurchased);
    const grossIncrementalShares = treasuryMethodOptionDilution + treasuryMethodWarrantDilution;
    const endingDilutedShares = endingBasicShares + grossIncrementalShares;
    const result: DilutionYearResult = {
      ...input,
      year: index + 1,
      openingBasicShares: opening,
      rsusGranted,
      rsusVested,
      sharePrice,
      sharesRepurchased: repurchased,
      sharesIssuedForAcquisitions: acquisitionShares,
      treasuryMethodOptionDilution,
      treasuryMethodWarrantDilution,
      grossIncrementalShares,
      endingBasicShares,
      endingDilutedShares,
    };
    opening = endingBasicShares;
    return result;
  });
}
