/**
 * P6-08 seeded retirement sequence-of-returns stress, behind the existing
 * personal-finance calculator and authenticated route. This neither fetches
 * investments nor introduces a second execution, identity or Artifact owner.
 */
import { createHash } from "node:crypto";
import type { P6RetirementProjectionInput, P6RetirementStressAssumptions } from "@shared/p6FinanceContracts";

export interface P6RetirementStressResult {
  engineId: "lios.personal-finance.retirement-stress-v1";
  engineVersion: "1.0.0";
  reproducible: true;
  simulationModel: "independent_lognormal_annual_gross_returns";
  assumptions: P6RetirementProjectionInput & P6RetirementStressAssumptions & {
    accumulationContributionTiming: "monthly_end";
    withdrawalTiming: "retirement_year_start";
    taxesAndFees: "not_modelled";
  };
  yearsUntilRetirement: number;
  paths: number;
  survivingPaths: number;
  survivalProbability: number;
  fundingTargetProbability: number;
  targetPortfolioAtRetirement: number;
  terminalPortfolioP10: number;
  terminalPortfolioMedian: number;
  terminalPortfolioP90: number;
  inputHash: string;
  outputHash: string;
  limitation: string;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Mulberry32 provides a stable PRNG; NOT cryptographic random or inferred market data. */
function seededUniform(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalSample(uniform: () => number): number {
  // Avoid ln(0); deterministic even for the lowest possible RNG output.
  const u = Math.max(uniform(), 1 / 4294967296);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform());
}

function finiteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(label + " must be finite and non-negative.");
}

function validateInputs(input: P6RetirementProjectionInput, stress: P6RetirementStressAssumptions): void {
  if (!input || !stress) throw new Error("Explicit retirement and retirementStress inputs are required.");
  if (!Number.isInteger(input.currentAge) || !Number.isInteger(input.retirementAge)
    || input.currentAge < 0 || input.retirementAge > 120 || input.retirementAge < input.currentAge) {
    throw new Error("Retirement stress requires whole-year ages in increasing order, at most 120.");
  }
  finiteNonnegative(input.currentPortfolio, "currentPortfolio");
  finiteNonnegative(input.monthlyContribution, "monthlyContribution");
  finiteNonnegative(input.annualRetirementSpendingToday, "annualRetirementSpendingToday");
  if (!Number.isFinite(input.annualReturnAssumption) || input.annualReturnAssumption <= -1 || input.annualReturnAssumption > 10) {
    throw new Error("annualReturnAssumption must be finite, greater than -100%, and at most 1000%.");
  }
  if (!Number.isFinite(input.annualInflationAssumption) || input.annualInflationAssumption <= -1 || input.annualInflationAssumption > 10) {
    throw new Error("annualInflationAssumption must be finite, greater than -100%, and at most 1000%.");
  }
  if (!Number.isFinite(input.withdrawalRate) || input.withdrawalRate <= 0 || input.withdrawalRate > 1) {
    throw new Error("withdrawalRate must be finite and within (0, 1].");
  }
  if (!Number.isFinite(stress.annualReturnVolatility) || stress.annualReturnVolatility < 0 || stress.annualReturnVolatility > 2) {
    throw new Error("annualReturnVolatility must be finite and between 0 and 2.");
  }
  if (!Number.isInteger(stress.paths) || stress.paths < 100 || stress.paths > 2000) {
    throw new Error("paths must be an integer between 100 and 2000.");
  }
  if (!Number.isInteger(stress.yearsInRetirement) || stress.yearsInRetirement < 1 || stress.yearsInRetirement > 60) {
    throw new Error("yearsInRetirement must be an integer between 1 and 60.");
  }
  if (!Number.isInteger(stress.seed) || stress.seed < 0 || stress.seed > 0xffffffff) {
    throw new Error("seed must be a 32-bit unsigned integer.");
  }
}

function quantile(sorted: readonly number[], percentile: number): number {
  const position = (sorted.length - 1) * percentile;
  const left = Math.floor(position);
  const right = Math.ceil(position);
  return sorted[left] + (sorted[right] - sorted[left]) * (position - left);
}

function assertResultFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(label + " overflowed or became invalid; the stress run was not accepted.");
  return value;
}

export function projectRetirementStress(
  retirement: P6RetirementProjectionInput,
  stress: P6RetirementStressAssumptions,
): P6RetirementStressResult {
  validateInputs(retirement, stress);
  const yearsUntilRetirement = retirement.retirementAge - retirement.currentAge;
  const inflationFactor = assertResultFinite(
    Math.pow(1 + retirement.annualInflationAssumption, yearsUntilRetirement), "Accumulation inflation factor",
  );
  const annualSpendingAtRetirement = assertResultFinite(
    retirement.annualRetirementSpendingToday * inflationFactor, "Inflation-adjusted annual spending",
  );
  const targetPortfolioAtRetirement = assertResultFinite(
    annualSpendingAtRetirement / retirement.withdrawalRate, "Retirement target",
  );
  // Match requested arithmetic mean and standard deviation with positive
  // gross returns, avoiding impossible simple annual returns below -100%.
  const meanGrossReturn = 1 + retirement.annualReturnAssumption;
  const logSigma = Math.sqrt(Math.log1p(Math.pow(stress.annualReturnVolatility / meanGrossReturn, 2)));
  const logMu = Math.log(meanGrossReturn) - (logSigma * logSigma) / 2;
  const uniform = seededUniform(stress.seed);
  const sampleGrossReturn = () => assertResultFinite(
    Math.exp(logMu + (logSigma === 0 ? 0 : logSigma * normalSample(uniform))),
    "Simulated gross return",
  );

  let survivingPaths = 0;
  let fundedPaths = 0;
  const terminalPortfolios: number[] = [];
  for (let run = 0; run < stress.paths; run += 1) {
    let balance = retirement.currentPortfolio;
    // Same chronological yearly draw drives every month in that year.
    for (let year = 0; year < yearsUntilRetirement; year += 1) {
      const monthlyFactor = Math.pow(sampleGrossReturn(), 1 / 12);
      for (let month = 0; month < 12; month += 1) {
        balance = assertResultFinite(balance * monthlyFactor + retirement.monthlyContribution, "Accumulation portfolio");
      }
    }
    if (balance >= targetPortfolioAtRetirement) fundedPaths += 1;
    let survived = true;
    for (let year = 0; year < stress.yearsInRetirement; year += 1) {
      const requiredSpending = assertResultFinite(
        annualSpendingAtRetirement * Math.pow(1 + retirement.annualInflationAssumption, year),
        "Retirement spending",
      );
      if (balance < requiredSpending) {
        survived = false;
        balance = 0;
        break;
      }
      // Withdraw at start of year: explicitly adverse sequence-risk convention.
      balance = assertResultFinite((balance - requiredSpending) * sampleGrossReturn(), "Retirement portfolio");
    }
    if (survived) survivingPaths += 1;
    terminalPortfolios.push(balance);
  }
  terminalPortfolios.sort((a, b) => a - b);

  const assumptions = {
    ...retirement, ...stress,
    accumulationContributionTiming: "monthly_end" as const,
    withdrawalTiming: "retirement_year_start" as const,
    taxesAndFees: "not_modelled" as const,
  };
  const inputHash = sha256({ engineVersion: "1.0.0", assumptions });
  const output = {
    engineId: "lios.personal-finance.retirement-stress-v1" as const,
    engineVersion: "1.0.0" as const,
    reproducible: true as const,
    simulationModel: "independent_lognormal_annual_gross_returns" as const,
    assumptions,
    yearsUntilRetirement,
    paths: stress.paths,
    survivingPaths,
    survivalProbability: survivingPaths / stress.paths,
    fundingTargetProbability: fundedPaths / stress.paths,
    targetPortfolioAtRetirement,
    terminalPortfolioP10: quantile(terminalPortfolios, 0.10),
    terminalPortfolioMedian: quantile(terminalPortfolios, 0.50),
    terminalPortfolioP90: quantile(terminalPortfolios, 0.90),
    inputHash,
    limitation: "Illustrative seeded model, not a forecast or financial, tax, or legal advice. "
      + "Independent annual returns omit fat tails, serial dependence, taxes, fees and pension entitlements; "
      + "user assumptions are not observed or externally verified market data.",
  };
  return { ...output, outputHash: sha256(output) };
}
