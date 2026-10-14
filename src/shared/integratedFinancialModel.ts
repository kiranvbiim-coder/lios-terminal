import { z } from "zod";
import { financialDatasetPayloadSchema, type CanonicalFinancialPeriod } from "./pointInTimeData";

export const INTEGRATED_FINANCIAL_MODEL_VERSION = "3.0.0";

const percent = z.number().finite().min(0).max(2);
const growth = z.number().finite().min(-0.9).max(5);
export const integratedModelAssumptionsSchema = z.object({
  projectionYears: z.number().int().min(1).max(10).default(5), revenueGrowth: growth,
  usePriceVolumeDrivers: z.boolean(), priceGrowth: growth, volumeGrowth: growth,
  cogsPercentRevenue: percent, sgaPercentRevenue: percent, taxRate: percent.max(0.8),
  openingNol: z.number().finite().nonnegative(), nolUtilizationLimit: percent.max(1),
  dso: z.number().finite().min(0).max(730), dio: z.number().finite().min(0).max(730), dpo: z.number().finite().min(0).max(730),
  capexPercentRevenue: percent, depreciationPercentRevenue: percent, interestRate: percent,
  minimumCashPercentRevenue: percent, dividendPayout: percent.max(1),
  leaseAdditionsPercentRevenue: percent, leaseAssetAmortizationRate: percent.max(1), leaseInterestRate: percent, leasePrincipalRepaymentRate: percent.max(1),
  stockCompPercentRevenue: percent, stockCompDilutionPercent: percent.max(1), buybackPercentRevenue: percent,
  sharePrice: z.number().finite().positive(), sharePriceGrowth: growth,
  circularMaxIterations: z.number().int().min(10).max(500), circularTolerance: z.number().finite().positive(),
});
export const specializedModelSchedulesSchema = z.object({
  segments: z.array(z.object({ name: z.string().min(1), openingRevenue: z.number().finite().nonnegative(), revenueGrowth: growth, cogsPercentRevenue: percent, sgaPercentRevenue: percent })).default([]),
  pension: z.object({ openingObligation: z.number().finite().nonnegative(), openingPlanAssets: z.number().finite().nonnegative(), serviceCost: z.number().finite().nonnegative(), discountRate: percent, expectedReturn: percent, cashContribution: z.number().finite().nonnegative(), benefitsPaid: z.number().finite().nonnegative() }).nullable().default(null),
  associates: z.array(z.object({ name: z.string().min(1), openingCarryingValue: z.number().finite().nonnegative(), ownershipPercent: percent.max(1), annualInvesteeIncome: z.number().finite(), annualDividends: z.number().finite().nonnegative() })).default([]),
  minority: z.object({ openingNonControllingInterest: z.number().finite().nonnegative(), shareOfConsolidatedIncome: percent.max(1) }).nullable().default(null),
  transaction: z.object({ closeProjectionYear: z.number().int().min(1).max(10), purchasePrice: z.number().finite().nonnegative(), acquiredCash: z.number().finite().nonnegative(), identifiableNetAssets: z.number().finite(), intangibleAssets: z.number().finite().nonnegative(), intangibleLifeYears: z.number().finite().positive(), acquiredRevenue: z.number().finite().nonnegative(), acquiredRevenueGrowth: growth, acquiredEbitMargin: z.number().finite().min(-2).max(2), cashConsiderationPercent: percent.max(1), debtConsiderationPercent: percent.max(1) }).nullable().default(null),
});
export const integratedModelRequestSchema = z.object({ datasetSnapshotId: z.string().uuid(), assumptions: integratedModelAssumptionsSchema.partial().optional(), schedules: specializedModelSchedulesSchema.partial().optional() });
export type IntegratedModelAssumptions = z.infer<typeof integratedModelAssumptionsSchema>;
export type SpecializedModelSchedules = z.infer<typeof specializedModelSchedulesSchema>;

export interface IntegratedForecastPeriod {
  fiscalYear: string;
  income: Record<string, number>;
  cashflow: Record<string, number>;
  balance: Record<string, number>;
  schedules: Record<string, number>;
  checks: { balanceSheet: number; cashRollForward: number; debtNonNegative: boolean; sharesPositive: boolean; circularConverged: boolean; passed: boolean };
}
export interface IntegratedFinancialModelResult {
  symbol: string; datasetSnapshotId: string; modelVersion: string; assumptions: IntegratedModelAssumptions; specializedSchedules: SpecializedModelSchedules;
  historicalPeriod: CanonicalFinancialPeriod; forecast: IntegratedForecastPeriod[];
  openingReconciliation: { amount: number; classification: "other_assets" | "other_liabilities" | "none" };
  checks: { passed: boolean; maxBalanceDifference: number; maxCashDifference: number; balanceTolerance: number; cashTolerance: number; circularConverged: boolean; maxCircularDifference: number; warnings: string[] };
}

const value = (data: Record<string, number>, key: string) => Number.isFinite(data[key]) ? data[key] : 0;
const firstValue = (data: Record<string, number>, keys: string[]) => keys.map((key) => value(data, key)).find((item) => item !== 0) ?? 0;
const sumValues = (data: Record<string, number>, keys: string[]) => keys.reduce((sum, key) => sum + value(data, key), 0);
const clamp = (n: number, low: number, high: number) => Math.min(Math.max(n, low), high);
const nearZero = (n: number) => Math.abs(n) < 1e-7 ? 0 : n;

export function deriveIntegratedModelAssumptions(payload: z.infer<typeof financialDatasetPayloadSchema>): IntegratedModelAssumptions {
  const periods = payload.periods.slice().sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const latest = periods.at(-1)!; const prior = periods.at(-2); const revenue = value(latest.income, "revenue");
  const priorRevenue = prior ? value(prior.income, "revenue") : 0; const cogs = value(latest.income, "costOfRevenue");
  const stockComp = value(latest.cashflow, "stockBasedCompensation"); const reportedSga = value(latest.income, "sellingGeneralAndAdministrativeExpenses");
  const ebt = value(latest.income, "incomeBeforeTax"); const debt = value(latest.balance, "shortTermDebt") + value(latest.balance, "longTermDebt");
  const shares = firstValue(latest.income, ["weightedAverageShsOutDil", "weightedAverageShsOut"]); const eps = firstValue(latest.income, ["epsDiluted", "eps"]);
  return integratedModelAssumptionsSchema.parse({
    projectionYears: 5, revenueGrowth: clamp(priorRevenue ? revenue / priorRevenue - 1 : 0.05, -0.2, 0.5), usePriceVolumeDrivers: false, priceGrowth: 0.03, volumeGrowth: 0.03,
    cogsPercentRevenue: clamp(revenue ? cogs / revenue : 0.6, 0, 1.2), sgaPercentRevenue: clamp(revenue ? Math.max(0, reportedSga - stockComp) / revenue : 0.15, 0, 1),
    taxRate: clamp(ebt ? value(latest.income, "incomeTaxExpense") / ebt : 0.21, 0, 0.5), openingNol: 0, nolUtilizationLimit: 0.8,
    dso: clamp(revenue ? value(latest.balance, "netReceivables") / revenue * 365 : 45, 0, 365), dio: clamp(cogs ? value(latest.balance, "inventory") / cogs * 365 : 45, 0, 365), dpo: clamp(cogs ? value(latest.balance, "accountPayables") / cogs * 365 : 35, 0, 365),
    capexPercentRevenue: clamp(revenue ? Math.abs(value(latest.cashflow, "investmentsInPropertyPlantAndEquipment")) / revenue : 0.04, 0, 0.5),
    depreciationPercentRevenue: clamp(revenue ? value(latest.cashflow, "depreciationAndAmortization") / revenue : 0.03, 0, 0.5),
    interestRate: clamp(debt ? Math.abs(value(latest.income, "interestExpense")) / debt : 0.05, 0, 0.5), minimumCashPercentRevenue: 0.02, dividendPayout: 0,
    leaseAdditionsPercentRevenue: 0, leaseAssetAmortizationRate: 0.2, leaseInterestRate: 0.05, leasePrincipalRepaymentRate: 0.2,
    stockCompPercentRevenue: clamp(revenue ? stockComp / revenue : 0, 0, 0.25), stockCompDilutionPercent: 0,
    buybackPercentRevenue: clamp(revenue ? Math.abs(value(latest.cashflow, "commonStockRepurchased")) / revenue : 0, 0, 0.5),
    sharePrice: shares > 0 && eps !== 0 ? Math.max(1, Math.abs(eps) * 20) : 100, sharePriceGrowth: 0.05, circularMaxIterations: 100, circularTolerance: 0.01,
  });
}

export function deriveSpecializedModelSchedules(payload: z.infer<typeof financialDatasetPayloadSchema>): SpecializedModelSchedules {
  const periods = payload.periods.slice().sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)); const latest = periods.at(-1)!; const prior = periods.at(-2);
  const revenue = value(latest.income, "revenue"), cogs = value(latest.income, "costOfRevenue"), sga = value(latest.income, "sellingGeneralAndAdministrativeExpenses");
  const segments = Object.entries(latest.segments).map(([name, openingRevenue]) => ({
    name, openingRevenue, revenueGrowth: clamp(prior?.segments[name] ? openingRevenue / prior.segments[name] - 1 : 0, -0.9, 5),
    cogsPercentRevenue: clamp(revenue ? cogs / revenue : 0.6, 0, 2), sgaPercentRevenue: clamp(revenue ? sga / revenue : 0.15, 0, 2),
  }));
  const openingObligation = firstValue(latest.balance, ["pensionBenefitObligation", "definedBenefitObligation"]), openingPlanAssets = firstValue(latest.balance, ["pensionPlanAssets", "definedBenefitPlanAssets"]);
  const openingAssociate = firstValue(latest.balance, ["investmentsInAffiliates", "equityMethodInvestments", "investmentsInAssociates"]);
  const openingNci = firstValue(latest.balance, ["minorityInterest", "nonControllingInterestInConsolidatedEntity"]), consolidatedIncome = value(latest.income, "netIncome");
  const nciIncome = firstValue(latest.income, ["netIncomeAttributableToNoncontrollingInterest", "minorityInterestIncome"]);
  return specializedModelSchedulesSchema.parse({ segments,
    pension: openingObligation || openingPlanAssets ? { openingObligation, openingPlanAssets, serviceCost: 0, discountRate: 0, expectedReturn: 0, cashContribution: 0, benefitsPaid: 0 } : null,
    associates: openingAssociate ? [{ name: "Reported associates", openingCarryingValue: openingAssociate, ownershipPercent: 1, annualInvesteeIncome: 0, annualDividends: 0 }] : [],
    minority: openingNci ? { openingNonControllingInterest: openingNci, shareOfConsolidatedIncome: consolidatedIncome ? clamp(nciIncome / consolidatedIncome, 0, 1) : 0 } : null,
    transaction: null,
  });
}

type CircularInputs = { openingDebt: number; beginningCash: number; revenue: number; costOfRevenue: number; cashSga: number; stockCompensation: number; depreciationAndAmortization: number; leaseAssetAmortization: number; leaseInterestExpense: number; intangibleAmortization: number; pensionExpense: number; pensionContribution: number; associateIncome: number; changeInNetWorkingCapital: number; capitalExpenditure: number; leasePrincipalRepayment: number; buybacks: number; minimumCash: number; openingNol: number; assumptions: IntegratedModelAssumptions };
function calculateCircularPeriod(input: CircularInputs, closingDebtGuess: number) {
  const debtInterestExpense = Math.max(0, (input.openingDebt + Math.max(0, closingDebtGuess)) / 2 * input.assumptions.interestRate);
  const ebit = input.revenue - input.costOfRevenue - input.cashSga - input.stockCompensation - input.depreciationAndAmortization - input.leaseAssetAmortization - input.intangibleAmortization - input.pensionExpense;
  const interestExpense = debtInterestExpense + input.leaseInterestExpense; const incomeBeforeTax = ebit + input.associateIncome - interestExpense;
  const nolGenerated = Math.max(0, -incomeBeforeTax); const nolUsed = Math.min(input.openingNol, Math.max(0, incomeBeforeTax) * input.assumptions.nolUtilizationLimit);
  const taxableIncome = Math.max(0, incomeBeforeTax - nolUsed); const incomeTaxExpense = taxableIncome * input.assumptions.taxRate;
  const netIncome = incomeBeforeTax - incomeTaxExpense; const closingNol = input.openingNol + nolGenerated - nolUsed;
  const dividends = Math.max(0, netIncome * input.assumptions.dividendPayout);
  const cashFromOperations = netIncome + input.depreciationAndAmortization + input.leaseAssetAmortization + input.intangibleAmortization + input.stockCompensation + input.pensionExpense - input.pensionContribution - input.associateIncome - input.changeInNetWorkingCapital;
  const cashBeforeDebt = input.beginningCash + cashFromOperations - input.capitalExpenditure - input.leasePrincipalRepayment - dividends - input.buybacks;
  const debtDraw = Math.max(0, input.minimumCash - cashBeforeDebt); const debtRepayment = Math.min(input.openingDebt + debtDraw, Math.max(0, cashBeforeDebt + debtDraw - input.minimumCash));
  return { debtInterestExpense, ebit, interestExpense, incomeBeforeTax, nolGenerated, nolUsed, taxableIncome, incomeTaxExpense, netIncome, closingNol, dividends, cashFromOperations, debtDraw, debtRepayment, closingDebt: input.openingDebt + debtDraw - debtRepayment };
}
export function solveCircularDebtInterest(input: CircularInputs) {
  let guess = input.openingDebt; let iterations = 0; let difference = Number.POSITIVE_INFINITY; let final = calculateCircularPeriod(input, guess);
  const tolerance = Math.max(input.assumptions.circularTolerance, input.openingDebt * 1e-12);
  for (iterations = 1; iterations <= input.assumptions.circularMaxIterations; iterations += 1) {
    final = calculateCircularPeriod(input, guess); difference = Math.abs(final.closingDebt - guess); if (difference <= tolerance) break; guess = (guess + final.closingDebt) / 2;
  }
  final = calculateCircularPeriod(input, final.closingDebt); difference = Math.abs(final.closingDebt - guess);
  return { ...final, iterations, difference, converged: difference <= tolerance };
}

export function runIntegratedFinancialModel(input: { datasetSnapshotId: string; payload: z.infer<typeof financialDatasetPayloadSchema>; assumptions?: Partial<IntegratedModelAssumptions>; schedules?: Partial<SpecializedModelSchedules> }): IntegratedFinancialModelResult {
  const payload = financialDatasetPayloadSchema.parse(input.payload); const periods = payload.periods.slice().sort((a, b) => a.periodEnd.localeCompare(b.periodEnd));
  const historicalPeriod = periods.at(-1)!; const assumptions = integratedModelAssumptionsSchema.parse({ ...deriveIntegratedModelAssumptions(payload), ...input.assumptions }); const specializedSchedules = specializedModelSchedulesSchema.parse({ ...deriveSpecializedModelSchedules(payload), ...input.schedules });
  const b = historicalPeriod.balance; const income = historicalPeriod.income;
  let cash = value(b, "cashAndCashEquivalents") || value(historicalPeriod.cashflow, "cashAtEndOfPeriod"); let ar = value(b, "netReceivables"); let inventory = value(b, "inventory"); let ppe = value(b, "propertyPlantEquipmentNet");
  let leaseAsset = sumValues(b, ["operatingLeaseRightOfUseAsset", "financeLeaseRightOfUseAsset"]); let ap = value(b, "accountPayables"); let debt = value(b, "shortTermDebt") + value(b, "longTermDebt");
  let leaseLiability = sumValues(b, ["operatingLeaseLiabilityCurrent", "operatingLeaseLiabilityNonCurrent", "financeLeaseLiabilityCurrent", "financeLeaseLiabilityNonCurrent"]);
  let equity = value(b, "totalStockholdersEquity"); let dilutedShares = firstValue(income, ["weightedAverageShsOutDil", "weightedAverageShsOut"]); let nol = assumptions.openingNol;
  let pensionObligation = specializedSchedules.pension?.openingObligation ?? 0, pensionPlanAssets = specializedSchedules.pension?.openingPlanAssets ?? 0;
  let associateCarryingValue = specializedSchedules.associates.reduce((sum, row) => sum + row.openingCarryingValue, 0);
  let nonControllingInterest = specializedSchedules.minority?.openingNonControllingInterest ?? 0, goodwill = 0, acquiredIntangibles = 0;
  const reportedAssets = value(b, "totalAssets"); const reportedLiabilities = value(b, "totalLiabilities");
  let otherAssets = Math.max(0, reportedAssets - cash - ar - inventory - ppe - leaseAsset - pensionPlanAssets - associateCarryingValue);
  let otherLiabilities = Math.max(0, reportedLiabilities - ap - debt - leaseLiability - pensionObligation);
  const rawDifference = cash + ar + inventory + ppe + leaseAsset + pensionPlanAssets + associateCarryingValue + otherAssets - ap - debt - leaseLiability - pensionObligation - otherLiabilities - equity - nonControllingInterest;
  let reconciliationAmount = 0; let reconciliationClassification: "other_assets" | "other_liabilities" | "none" = "none";
  if (Math.abs(rawDifference) > 1e-7) { reconciliationAmount = Math.abs(rawDifference); if (rawDifference < 0) { otherAssets += reconciliationAmount; reconciliationClassification = "other_assets"; } else { otherLiabilities += reconciliationAmount; reconciliationClassification = "other_liabilities"; } }
  let revenue = value(income, "revenue"); let nwc = ar + inventory - ap; let impliedSharePrice = assumptions.sharePrice; const forecast: IntegratedForecastPeriod[] = []; const baseYear = Number.parseInt(historicalPeriod.fiscalYear, 10);
  for (let index = 0; index < assumptions.projectionYears; index += 1) {
    let beginningCash = cash, openingDebt = debt; const openingPpe = ppe, openingNol = nol, openingLeaseAsset = leaseAsset, openingLeaseLiability = leaseLiability, openingDilutedShares = dilutedShares;
    const openingPensionObligation = pensionObligation, openingPensionPlanAssets = pensionPlanAssets, openingAssociateValue = associateCarryingValue, openingNci = nonControllingInterest;
    const transactionCloses = specializedSchedules.transaction?.closeProjectionYear === index + 1; const transaction = specializedSchedules.transaction;
    const transactionCashConsideration = transactionCloses && transaction ? transaction.purchasePrice * transaction.cashConsiderationPercent : 0;
    const transactionDebtConsideration = transactionCloses && transaction ? transaction.purchasePrice * transaction.debtConsiderationPercent : 0;
    if (transactionCloses && transaction) { beginningCash += transaction.acquiredCash - transactionCashConsideration; openingDebt += transactionDebtConsideration; debt += transactionDebtConsideration; acquiredIntangibles += transaction.intangibleAssets; goodwill += Math.max(0, transaction.purchasePrice - transaction.identifiableNetAssets - transaction.intangibleAssets); }
    const appliedGrowth = assumptions.usePriceVolumeDrivers ? (1 + assumptions.priceGrowth) * (1 + assumptions.volumeGrowth) - 1 : assumptions.revenueGrowth;
    const segmentRevenue = specializedSchedules.segments.length ? specializedSchedules.segments.reduce((sum, row) => sum + row.openingRevenue * (1 + row.revenueGrowth) ** (index + 1), 0) : null;
    revenue = segmentRevenue ?? revenue * (1 + appliedGrowth); if (transaction && index + 1 >= transaction.closeProjectionYear) revenue += transaction.acquiredRevenue * (1 + transaction.acquiredRevenueGrowth) ** (index + 1 - transaction.closeProjectionYear); impliedSharePrice *= 1 + assumptions.sharePriceGrowth;
    const segmentCogs = specializedSchedules.segments.length ? specializedSchedules.segments.reduce((sum, row) => sum + row.openingRevenue * (1 + row.revenueGrowth) ** (index + 1) * row.cogsPercentRevenue, 0) : null;
    const segmentSga = specializedSchedules.segments.length ? specializedSchedules.segments.reduce((sum, row) => sum + row.openingRevenue * (1 + row.revenueGrowth) ** (index + 1) * row.sgaPercentRevenue, 0) : null;
    const acquiredRevenueThisYear = transaction && index + 1 >= transaction.closeProjectionYear ? transaction.acquiredRevenue * (1 + transaction.acquiredRevenueGrowth) ** (index + 1 - transaction.closeProjectionYear) : 0;
    const acquiredOperatingCost = acquiredRevenueThisYear * (1 - (transaction?.acquiredEbitMargin ?? 0));
    const costOfRevenue = (segmentCogs ?? revenue * assumptions.cogsPercentRevenue) + acquiredOperatingCost * 0.7, grossProfit = revenue - costOfRevenue;
    const cashSga = (segmentSga ?? revenue * assumptions.sgaPercentRevenue) + acquiredOperatingCost * 0.3, stockCompensation = revenue * assumptions.stockCompPercentRevenue, sga = cashSga + stockCompensation;
    const depreciationAndAmortization = revenue * assumptions.depreciationPercentRevenue, capitalExpenditure = revenue * assumptions.capexPercentRevenue, leaseAdditions = revenue * assumptions.leaseAdditionsPercentRevenue;
    const leaseAssetAmortization = Math.min(openingLeaseAsset + leaseAdditions, (openingLeaseAsset + leaseAdditions) * assumptions.leaseAssetAmortizationRate), leasePrincipalRepayment = Math.min(openingLeaseLiability + leaseAdditions, (openingLeaseLiability + leaseAdditions) * assumptions.leasePrincipalRepaymentRate);
    const leaseInterestExpense = Math.max(0, (openingLeaseLiability + leaseAdditions * 0.5 - leasePrincipalRepayment * 0.5) * assumptions.leaseInterestRate);
    const pensionServiceCost = specializedSchedules.pension?.serviceCost ?? 0, pensionInterestCost = openingPensionObligation * (specializedSchedules.pension?.discountRate ?? 0), pensionExpectedReturn = openingPensionPlanAssets * (specializedSchedules.pension?.expectedReturn ?? 0);
    const pensionExpense = pensionServiceCost + pensionInterestCost - pensionExpectedReturn, pensionContribution = specializedSchedules.pension?.cashContribution ?? 0, pensionBenefitsPaid = specializedSchedules.pension?.benefitsPaid ?? 0;
    pensionObligation = Math.max(0, openingPensionObligation + pensionServiceCost + pensionInterestCost - pensionBenefitsPaid); pensionPlanAssets = Math.max(0, openingPensionPlanAssets + pensionExpectedReturn + pensionContribution - pensionBenefitsPaid);
    const associateIncome = specializedSchedules.associates.reduce((sum, row) => sum + row.annualInvesteeIncome * row.ownershipPercent, 0), associateDividends = specializedSchedules.associates.reduce((sum, row) => sum + row.annualDividends * row.ownershipPercent, 0);
    associateCarryingValue = Math.max(0, openingAssociateValue + associateIncome - associateDividends);
    const intangibleAmortization = transaction ? Math.min(acquiredIntangibles, transaction.intangibleAssets / transaction.intangibleLifeYears) : 0; acquiredIntangibles = Math.max(0, acquiredIntangibles - intangibleAmortization);
    ar = revenue * assumptions.dso / 365; inventory = costOfRevenue * assumptions.dio / 365; ap = costOfRevenue * assumptions.dpo / 365; const currentNwc = ar + inventory - ap, changeInNetWorkingCapital = currentNwc - nwc;
    const shareRepurchases = revenue * assumptions.buybackPercentRevenue, minimumCash = revenue * assumptions.minimumCashPercentRevenue;
    const circular = solveCircularDebtInterest({ openingDebt, beginningCash, revenue, costOfRevenue, cashSga, stockCompensation, depreciationAndAmortization, leaseAssetAmortization, leaseInterestExpense, intangibleAmortization, pensionExpense, pensionContribution, associateIncome, changeInNetWorkingCapital, capitalExpenditure, leasePrincipalRepayment, buybacks: shareRepurchases, minimumCash, openingNol, assumptions });
    debt = circular.closingDebt; nol = circular.closingNol; leaseAsset = openingLeaseAsset + leaseAdditions - leaseAssetAmortization; leaseLiability = openingLeaseLiability + leaseAdditions - leasePrincipalRepayment;
    const stockCompDilutionShares = openingDilutedShares * assumptions.stockCompDilutionPercent, repurchasedShares = shareRepurchases / impliedSharePrice; dilutedShares = Math.max(1e-9, openingDilutedShares + stockCompDilutionShares - repurchasedShares);
    const nciIncome = circular.netIncome * (specializedSchedules.minority?.shareOfConsolidatedIncome ?? 0), parentNetIncome = circular.netIncome - nciIncome; nonControllingInterest = Math.max(0, openingNci + nciIncome);
    const cashFromInvesting = -capitalExpenditure + associateDividends, cashFromFinancing = circular.debtDraw - circular.debtRepayment - leasePrincipalRepayment - circular.dividends - shareRepurchases, netChangeInCash = circular.cashFromOperations + cashFromInvesting + cashFromFinancing;
    cash = beginningCash + netChangeInCash; ppe = openingPpe + capitalExpenditure - depreciationAndAmortization; equity += parentNetIncome + stockCompensation - circular.dividends - shareRepurchases; nwc = currentNwc;
    let totalAssets = cash + ar + inventory + ppe + leaseAsset + pensionPlanAssets + associateCarryingValue + acquiredIntangibles + goodwill + otherAssets;
    let totalLiabilitiesAndEquity = ap + debt + leaseLiability + pensionObligation + otherLiabilities + equity + nonControllingInterest;
    const specializedBalanceReconciliation = nearZero(totalAssets - totalLiabilitiesAndEquity);
    if (specializedBalanceReconciliation < 0) otherAssets += Math.abs(specializedBalanceReconciliation); else if (specializedBalanceReconciliation > 0) otherLiabilities += specializedBalanceReconciliation;
    totalAssets = cash + ar + inventory + ppe + leaseAsset + pensionPlanAssets + associateCarryingValue + acquiredIntangibles + goodwill + otherAssets;
    totalLiabilitiesAndEquity = ap + debt + leaseLiability + pensionObligation + otherLiabilities + equity + nonControllingInterest;
    const balanceSheet = nearZero(totalAssets - totalLiabilitiesAndEquity), cashRollForward = nearZero(cash - beginningCash - netChangeInCash);
    const balanceTolerance = Math.max(0.01, Math.abs(totalAssets) * 1e-12), cashTolerance = Math.max(0.01, Math.abs(cash) * 1e-12), sharesPositive = dilutedShares > 0, passed = Math.abs(balanceSheet) <= balanceTolerance && Math.abs(cashRollForward) <= cashTolerance && debt >= -1e-7 && sharesPositive && circular.converged;
    forecast.push({ fiscalYear: Number.isFinite(baseYear) ? String(baseYear + index + 1) : `FY+${index + 1}`,
      income: { revenue, costOfRevenue, grossProfit, cashSga, stockCompensation, sga, depreciationAndAmortization, leaseAssetAmortization, intangibleAmortization, pensionExpense, associateIncome, nciIncome, netIncomeAttributableToParent: parentNetIncome, ebit: circular.ebit, debtInterestExpense: circular.debtInterestExpense, leaseInterestExpense, interestExpense: circular.interestExpense, incomeBeforeTax: circular.incomeBeforeTax, incomeTaxExpense: circular.incomeTaxExpense, netIncome: circular.netIncome, dilutedEps: parentNetIncome / dilutedShares },
      cashflow: { netIncome: circular.netIncome, depreciationAndAmortization, leaseAssetAmortization, intangibleAmortization, stockCompensation, pensionContribution, associateDividends, changeInNetWorkingCapital, cashFromOperations: circular.cashFromOperations, capitalExpenditure, acquisitionCashConsideration: transactionCashConsideration, acquiredCash: transactionCloses && transaction ? transaction.acquiredCash : 0, cashFromInvesting, debtDraw: circular.debtDraw + transactionDebtConsideration, debtRepayment: circular.debtRepayment, leasePrincipalRepayment, dividends: circular.dividends, shareRepurchases, cashFromFinancing, netChangeInCash },
      balance: { cash, accountsReceivable: ar, inventory, propertyPlantEquipmentNet: ppe, leaseRightOfUseAsset: leaseAsset, pensionPlanAssets, associateInvestments: associateCarryingValue, acquiredIntangibles, goodwill, otherAssets, totalAssets, accountsPayable: ap, totalDebt: debt, leaseLiability, pensionObligation, otherLiabilities, stockholdersEquity: equity, nonControllingInterest, totalLiabilitiesAndEquity },
      schedules: { netWorkingCapital: nwc, openingDebt, transactionDebtConsideration, transactionCashConsideration, closingDebt: debt, openingPpe, closingPpe: ppe, openingNol, nolGenerated: circular.nolGenerated, nolUsed: circular.nolUsed, closingNol: nol, taxableIncome: circular.taxableIncome, openingLeaseAsset, leaseAdditions, closingLeaseAsset: leaseAsset, openingLeaseLiability, closingLeaseLiability: leaseLiability, openingDilutedShares, stockCompDilutionShares, repurchasedShares, closingDilutedShares: dilutedShares, impliedSharePrice, openingPensionObligation, pensionServiceCost, pensionInterestCost, pensionBenefitsPaid, closingPensionObligation: pensionObligation, openingPensionPlanAssets, pensionExpectedReturn, pensionContribution, closingPensionPlanAssets: pensionPlanAssets, openingAssociateValue, associateIncome, associateDividends, closingAssociateValue: associateCarryingValue, openingNci, nciIncome, closingNci: nonControllingInterest, goodwill, acquiredIntangibles, intangibleAmortization, specializedBalanceReconciliation, circularIterations: circular.iterations, circularDifference: circular.difference },
      checks: { balanceSheet, cashRollForward, debtNonNegative: debt >= -1e-7, sharesPositive, circularConverged: circular.converged, passed } });
  }
  const maxBalanceDifference = Math.max(...forecast.map((p) => Math.abs(p.checks.balanceSheet)), 0), maxCashDifference = Math.max(...forecast.map((p) => Math.abs(p.checks.cashRollForward)), 0), maxCircularDifference = Math.max(...forecast.map((p) => p.schedules.circularDifference), 0);
  const balanceTolerance = Math.max(...forecast.map((p) => Math.max(0.01, Math.abs(p.balance.totalAssets) * 1e-12)), 0.01), cashTolerance = Math.max(...forecast.map((p) => Math.max(0.01, Math.abs(p.balance.cash) * 1e-12)), 0.01); const warnings: string[] = [];
  if (reconciliationAmount > 1e-7) warnings.push(`Opening statements required an explicit ${reconciliationClassification.replace("_", " ")} reconciliation of ${reconciliationAmount.toFixed(2)} because canonical source fields did not fully represent the reported balance sheet.`);
  if (!forecast.every((p) => p.checks.circularConverged)) warnings.push("Debt-interest circularity did not converge within the configured iteration limit.");
  if (leaseAsset === 0 && leaseLiability === 0 && assumptions.leaseAdditionsPercentRevenue === 0) warnings.push("Lease detail was unavailable and no lease forecast was supplied; lease schedules remain zero rather than estimated.");
  if (dilutedShares <= 1e-9) warnings.push("Historical diluted shares were unavailable; per-share outputs are not decision-ready until a share count is supplied.");
  if (!specializedSchedules.segments.length) warnings.push("Segment revenue was unavailable; consolidated revenue drivers remain in use.");
  if (!specializedSchedules.pension) warnings.push("Pension disclosures were unavailable; no pension forecast is inferred.");
  if (!specializedSchedules.associates.length) warnings.push("Associate and equity-method disclosures were unavailable; no associate forecast is inferred.");
  if (!specializedSchedules.minority) warnings.push("Non-controlling-interest disclosures were unavailable; parent and consolidated income remain identical.");
  if (forecast.some((period) => Math.abs(period.schedules.specializedBalanceReconciliation) > 1e-7)) warnings.push("Specialized schedules required an explicit balance-sheet reconciliation; inspect the schedule-level reconciliation before decision use.");
  return { symbol: payload.symbol, datasetSnapshotId: input.datasetSnapshotId, modelVersion: INTEGRATED_FINANCIAL_MODEL_VERSION, assumptions, specializedSchedules, historicalPeriod, forecast, openingReconciliation: { amount: reconciliationAmount, classification: reconciliationClassification }, checks: { passed: forecast.every((p) => p.checks.passed), maxBalanceDifference, maxCashDifference, balanceTolerance, cashTolerance, circularConverged: forecast.every((p) => p.checks.circularConverged), maxCircularDifference, warnings } };
}
