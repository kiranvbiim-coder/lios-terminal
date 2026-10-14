/**
 * Macro economics engines: cross-domain shock routing, country comparison,
 * and policy scenario analysis. These complement the existing Python sidecar
 * engines (Taylor Rule, Phillips Curve, Leontief, Gini) and the FRED/World
 * Bank/BLS data connectors.
 *
 * All functions are deterministic and pure.
 */

// ─── Cross-Domain Macro Shock Engine ──────────────────────────────────────

export type ShockType =
  | "rates"
  | "inflation"
  | "fx"
  | "commodity"
  | "gdp"
  | "unemployment"
  | "credit_spread"
  | "equity_market";

export interface MacroShockInputs {
  shockType: ShockType;
  shockMagnitude: number;       // decimal change (e.g. 0.01 = 100bps rate hike)
  /** Sector sensitivities to this shock type (sector → beta) */
  sectorSensitivities: Record<string, number>;
  /** Company-specific override (symbol → beta), takes precedence over sector */
  companyOverrides?: Record<string, number>;
}

export interface ShockImpact {
  target: string;
  sensitivity: number;
  impactPct: number;
  direction: "positive" | "negative" | "neutral";
  channel: string;
}

export interface MacroShockResult {
  shockType: ShockType;
  shockMagnitude: number;
  impacts: ShockImpact[];
  aggregateImpactPct: number;
  mostAffectedSector: string | null;
  leastAffectedSector: string | null;
}

/**
 * Default sector sensitivities for common macro shocks.
 * These are directional estimates based on standard economic relationships.
 * Production use should calibrate from historical data.
 */
export const DEFAULT_SECTOR_SENSITIVITIES: Record<ShockType, Record<string, number>> = {
  rates: {
    Technology: -1.5, "Real Estate": -2.0, Utilities: -1.2, Financials: 0.8,
    "Consumer Discretionary": -0.8, "Consumer Staples": -0.3, Healthcare: -0.4,
    Industrials: -0.6, Materials: -0.5, Energy: -0.3, Telecom: -0.7,
  },
  inflation: {
    Technology: -0.5, "Real Estate": 0.3, Utilities: -0.8, Financials: 0.2,
    "Consumer Discretionary": -1.2, "Consumer Staples": -0.3, Healthcare: -0.2,
    Industrials: 0.1, Materials: 0.6, Energy: 0.8, Telecom: -0.4,
  },
  fx: {
    Technology: -0.4, "Real Estate": -0.1, Utilities: -0.1, Financials: -0.2,
    "Consumer Discretionary": -0.6, "Consumer Staples": -0.3, Healthcare: -0.3,
    Industrials: -0.5, Materials: -0.7, Energy: -0.3, Telecom: -0.2,
  },
  commodity: {
    Technology: -0.2, "Real Estate": -0.1, Utilities: -0.8, Financials: 0.0,
    "Consumer Discretionary": -0.5, "Consumer Staples": -0.4, Healthcare: -0.1,
    Industrials: -0.6, Materials: 1.2, Energy: 1.5, Telecom: -0.1,
  },
  gdp: {
    Technology: 1.2, "Real Estate": 0.8, Utilities: 0.3, Financials: 1.0,
    "Consumer Discretionary": 1.5, "Consumer Staples": 0.4, Healthcare: 0.3,
    Industrials: 1.3, Materials: 1.1, Energy: 0.7, Telecom: 0.5,
  },
  unemployment: {
    Technology: -0.8, "Real Estate": -0.6, Utilities: -0.2, Financials: -0.7,
    "Consumer Discretionary": -1.5, "Consumer Staples": -0.3, Healthcare: -0.1,
    Industrials: -1.0, Materials: -0.8, Energy: -0.5, Telecom: -0.4,
  },
  credit_spread: {
    Technology: -0.6, "Real Estate": -1.5, Utilities: -0.8, Financials: -1.2,
    "Consumer Discretionary": -0.7, "Consumer Staples": -0.3, Healthcare: -0.4,
    Industrials: -0.8, Materials: -0.6, Energy: -0.9, Telecom: -0.5,
  },
  equity_market: {
    Technology: 1.3, "Real Estate": 0.8, Utilities: 0.5, Financials: 1.1,
    "Consumer Discretionary": 1.2, "Consumer Staples": 0.6, Healthcare: 0.7,
    Industrials: 1.0, Materials: 0.9, Energy: 0.8, Telecom: 0.7,
  },
};

const SHOCK_CHANNELS: Record<ShockType, string> = {
  rates: "Discount rate and debt cost",
  inflation: "Input cost and pricing power",
  fx: "Revenue translation and import costs",
  commodity: "Raw material and energy costs",
  gdp: "Demand and revenue growth",
  unemployment: "Consumer spending and labor costs",
  credit_spread: "Borrowing cost and credit availability",
  equity_market: "Wealth effect and risk appetite",
};

/**
 * Cross-domain macro shock: estimates the impact of a macro variable
 * change on sectors/companies. Impact = sensitivity × shock magnitude.
 */
export function computeMacroShock(inputs: MacroShockInputs): MacroShockResult {
  const { shockType, shockMagnitude, sectorSensitivities, companyOverrides } = inputs;
  const channel = SHOCK_CHANNELS[shockType];
  const impacts: ShockImpact[] = [];

  // Sector-level impacts
  for (const [sector, sensitivity] of Object.entries(sectorSensitivities)) {
    const impactPct = sensitivity * shockMagnitude * 100;
    impacts.push({
      target: sector,
      sensitivity,
      impactPct,
      direction: impactPct > 0.1 ? "positive" : impactPct < -0.1 ? "negative" : "neutral",
      channel,
    });
  }

  // Company overrides
  if (companyOverrides) {
    for (const [symbol, sensitivity] of Object.entries(companyOverrides)) {
      const impactPct = sensitivity * shockMagnitude * 100;
      impacts.push({
        target: symbol,
        sensitivity,
        impactPct,
        direction: impactPct > 0.1 ? "positive" : impactPct < -0.1 ? "negative" : "neutral",
        channel: `${channel} (company-specific)`,
      });
    }
  }

  const sectorImpacts = impacts.filter((i) => !companyOverrides || !(i.target in companyOverrides));
  const aggregateImpactPct = sectorImpacts.length > 0
    ? sectorImpacts.reduce((s, i) => s + i.impactPct, 0) / sectorImpacts.length
    : 0;

  const sortedBySeverity = [...sectorImpacts].sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct));

  return {
    shockType,
    shockMagnitude,
    impacts,
    aggregateImpactPct,
    mostAffectedSector: sortedBySeverity[0]?.target ?? null,
    leastAffectedSector: sortedBySeverity.at(-1)?.target ?? null,
  };
}

// ─── Country Comparison Engine ────────────────────────────────────────────

export interface CountryIndicator {
  country: string;
  countryCode: string;
  indicators: Record<string, number | null>;
}

export interface CountryComparisonResult {
  countries: CountryIndicator[];
  indicatorNames: string[];
  rankings: Record<string, Array<{ country: string; value: number | null; rank: number }>>;
  bestPerformer: Record<string, string | null>;
  worstPerformer: Record<string, string | null>;
}

/**
 * Country comparison: ranks countries by each indicator.
 * Higher is assumed better for GDP growth, lower for inflation/unemployment.
 * `higherIsBetter` controls ranking direction per indicator.
 */
export function compareCountries(
  countries: CountryIndicator[],
  higherIsBetter: Record<string, boolean> = {},
): CountryComparisonResult {
  const allIndicators = new Set<string>();
  for (const c of countries) {
    for (const key of Object.keys(c.indicators)) allIndicators.add(key);
  }
  const indicatorNames = Array.from(allIndicators).sort();

  const rankings: Record<string, Array<{ country: string; value: number | null; rank: number }>> = {};
  const bestPerformer: Record<string, string | null> = {};
  const worstPerformer: Record<string, string | null> = {};

  for (const indicator of indicatorNames) {
    const entries = countries.map((c) => ({
      country: c.country,
      value: c.indicators[indicator] ?? null,
    }));

    const withValues = entries.filter((e) => e.value != null);
    const ascending = higherIsBetter[indicator] !== false; // default: higher is better
    withValues.sort((a, b) => ascending ? (b.value! - a.value!) : (a.value! - b.value!));

    const ranked = entries.map((e) => {
      const idx = withValues.findIndex((w) => w.country === e.country);
      return { country: e.country, value: e.value, rank: idx >= 0 ? idx + 1 : entries.length };
    });

    rankings[indicator] = ranked;
    bestPerformer[indicator] = withValues[0]?.country ?? null;
    worstPerformer[indicator] = withValues.at(-1)?.country ?? null;
  }

  return { countries, indicatorNames, rankings, bestPerformer, worstPerformer };
}

// ─── Policy Scenario Engine ──────────────────────────────────────────────

export type PolicyType = "monetary" | "fiscal" | "trade" | "regulatory";

export interface PolicyScenarioInputs {
  policyType: PolicyType;
  name: string;
  description: string;
  /** Key policy variable changes */
  changes: Array<{
    variable: string;
    currentValue: number;
    scenarioValue: number;
    unit: string;
  }>;
  /** Estimated transmission channels and lag */
  transmissionLagQuarters: number;
  /** Macro variable impacts (variable → estimated change in decimal) */
  estimatedImpacts: Record<string, number>;
}

export interface PolicyScenarioResult {
  name: string;
  policyType: PolicyType;
  changes: Array<{
    variable: string;
    currentValue: number;
    scenarioValue: number;
    changeMagnitude: number;
    unit: string;
  }>;
  transmissionLagQuarters: number;
  macroImpacts: Array<{
    variable: string;
    estimatedChange: number;
    direction: "expansionary" | "contractionary" | "neutral";
  }>;
  netStance: "expansionary" | "contractionary" | "neutral";
  riskFactors: string[];
}

/**
 * Policy scenario analysis: evaluates the macro impact of a policy
 * change across transmission channels with estimated lags.
 */
export function analyzePolicy(inputs: PolicyScenarioInputs): PolicyScenarioResult {
  const changes = inputs.changes.map((c) => ({
    ...c,
    changeMagnitude: c.scenarioValue - c.currentValue,
  }));

  const macroImpacts = Object.entries(inputs.estimatedImpacts).map(([variable, change]) => ({
    variable,
    estimatedChange: change,
    direction: (change > 0.001 ? "expansionary" : change < -0.001 ? "contractionary" : "neutral") as "expansionary" | "contractionary" | "neutral",
  }));

  const expansionaryCount = macroImpacts.filter((i) => i.direction === "expansionary").length;
  const contractionaryCount = macroImpacts.filter((i) => i.direction === "contractionary").length;
  const netStance: "expansionary" | "contractionary" | "neutral" =
    expansionaryCount > contractionaryCount ? "expansionary"
    : contractionaryCount > expansionaryCount ? "contractionary"
    : "neutral";

  const riskFactors: string[] = [];
  if (inputs.transmissionLagQuarters > 4) riskFactors.push("Long transmission lag increases uncertainty");
  if (changes.some((c) => Math.abs(c.changeMagnitude) > Math.abs(c.currentValue) * 0.5)) {
    riskFactors.push("Large magnitude change — historical precedent may be limited");
  }
  if (macroImpacts.some((i) => i.direction === "expansionary") && macroImpacts.some((i) => i.direction === "contractionary")) {
    riskFactors.push("Mixed expansionary/contractionary effects — net outcome uncertain");
  }

  return {
    name: inputs.name,
    policyType: inputs.policyType,
    changes,
    transmissionLagQuarters: inputs.transmissionLagQuarters,
    macroImpacts,
    netStance,
    riskFactors,
  };
}
