import test from "node:test";
import assert from "node:assert/strict";
import {
  computeMacroShock,
  compareCountries,
  analyzePolicy,
  DEFAULT_SECTOR_SENSITIVITIES,
  type CountryIndicator,
} from "./macroEngines";

// ─── Cross-Domain Macro Shock ─────────────────────────────────────────────

test("macro shock: rate hike hurts rate-sensitive sectors, benefits financials", () => {
  const result = computeMacroShock({
    shockType: "rates",
    shockMagnitude: 0.01, // 100bps hike
    sectorSensitivities: DEFAULT_SECTOR_SENSITIVITIES.rates,
  });
  assert.equal(result.shockType, "rates");
  assert.ok(result.impacts.length >= 10);

  const techImpact = result.impacts.find((i) => i.target === "Technology");
  assert.ok(techImpact && techImpact.impactPct < 0, "Tech should be hurt by rate hike");

  const finImpact = result.impacts.find((i) => i.target === "Financials");
  assert.ok(finImpact && finImpact.impactPct > 0, "Financials should benefit from rate hike");

  const reImpact = result.impacts.find((i) => i.target === "Real Estate");
  assert.ok(reImpact && reImpact.direction === "negative", "Real Estate should be negatively impacted");
});

test("macro shock: company override takes precedence", () => {
  const result = computeMacroShock({
    shockType: "commodity",
    shockMagnitude: 0.10, // 10% commodity price increase
    sectorSensitivities: { Energy: 1.5, Technology: -0.2 },
    companyOverrides: { "XOM": 2.0 }, // XOM more sensitive than sector
  });
  const xomImpact = result.impacts.find((i) => i.target === "XOM");
  assert.ok(xomImpact);
  assert.ok(Math.abs(xomImpact.impactPct - 20) < 0.1); // 2.0 × 0.10 × 100 = 20%
});

test("macro shock: zero magnitude produces near-zero impacts", () => {
  const result = computeMacroShock({
    shockType: "gdp",
    shockMagnitude: 0,
    sectorSensitivities: DEFAULT_SECTOR_SENSITIVITIES.gdp,
  });
  for (const impact of result.impacts) {
    assert.ok(Math.abs(impact.impactPct) < 0.01);
    assert.equal(impact.direction, "neutral");
  }
});

test("macro shock: identifies most and least affected sectors", () => {
  const result = computeMacroShock({
    shockType: "rates",
    shockMagnitude: 0.02,
    sectorSensitivities: DEFAULT_SECTOR_SENSITIVITIES.rates,
  });
  assert.ok(result.mostAffectedSector != null);
  assert.ok(result.leastAffectedSector != null);
  assert.notEqual(result.mostAffectedSector, result.leastAffectedSector);
});

// ─── Country Comparison ───────────────────────────────────────────────────

test("country comparison: ranks countries by indicators", () => {
  const countries: CountryIndicator[] = [
    { country: "United States", countryCode: "US", indicators: { gdpGrowth: 2.5, inflation: 3.2, unemployment: 3.8 } },
    { country: "India", countryCode: "IN", indicators: { gdpGrowth: 6.8, inflation: 5.1, unemployment: 7.2 } },
    { country: "Germany", countryCode: "DE", indicators: { gdpGrowth: 0.3, inflation: 2.1, unemployment: 5.5 } },
  ];
  const result = compareCountries(countries, { gdpGrowth: true, inflation: false, unemployment: false });

  assert.equal(result.indicatorNames.length, 3);
  assert.equal(result.countries.length, 3);

  // GDP growth: India best (6.8), Germany worst (0.3)
  assert.equal(result.bestPerformer.gdpGrowth, "India");
  assert.equal(result.worstPerformer.gdpGrowth, "Germany");

  // Inflation: Germany best (2.1, lowest), India worst (5.1, highest)
  assert.equal(result.bestPerformer.inflation, "Germany");
  assert.equal(result.worstPerformer.inflation, "India");

  // Rankings have correct structure
  const gdpRanks = result.rankings.gdpGrowth;
  assert.equal(gdpRanks.length, 3);
  const indiaRank = gdpRanks.find((r) => r.country === "India");
  assert.equal(indiaRank?.rank, 1);
});

test("country comparison: handles null indicators", () => {
  const countries: CountryIndicator[] = [
    { country: "US", countryCode: "US", indicators: { gdp: 25.5 } },
    { country: "IN", countryCode: "IN", indicators: { gdp: 3.7, population: 1400 } },
  ];
  const result = compareCountries(countries);
  assert.ok(result.indicatorNames.includes("gdp"));
  assert.ok(result.indicatorNames.includes("population"));
  // US has no population → ranked last
  const popRanks = result.rankings.population;
  const usRank = popRanks.find((r) => r.country === "US");
  assert.equal(usRank?.value, null);
});

test("country comparison: empty input", () => {
  const result = compareCountries([]);
  assert.equal(result.countries.length, 0);
  assert.equal(result.indicatorNames.length, 0);
});

// ─── Policy Scenario ──────────────────────────────────────────────────────

test("policy scenario: rate hike is contractionary", () => {
  const result = analyzePolicy({
    policyType: "monetary",
    name: "Fed 50bps Rate Hike",
    description: "Federal Reserve raises rates by 50 basis points",
    changes: [
      { variable: "fed_funds_rate", currentValue: 0.05, scenarioValue: 0.055, unit: "%" },
    ],
    transmissionLagQuarters: 4,
    estimatedImpacts: {
      gdp_growth: -0.003,
      inflation: -0.005,
      unemployment: 0.002,
      housing_starts: -0.01,
    },
  });

  assert.equal(result.policyType, "monetary");
  assert.equal(result.netStance, "contractionary");
  assert.equal(result.macroImpacts.length, 4);
  assert.ok(result.changes[0].changeMagnitude > 0);
});

test("policy scenario: fiscal stimulus is expansionary", () => {
  const result = analyzePolicy({
    policyType: "fiscal",
    name: "Infrastructure Spending Bill",
    description: "$200B infrastructure package",
    changes: [
      { variable: "government_spending", currentValue: 4800, scenarioValue: 5000, unit: "$B" },
    ],
    transmissionLagQuarters: 6,
    estimatedImpacts: {
      gdp_growth: 0.008,
      employment: 0.005,
      inflation: 0.003,
    },
  });

  assert.equal(result.netStance, "expansionary");
  assert.ok(result.riskFactors.some((r) => r.includes("Long transmission lag")));
});

test("policy scenario: mixed effects produce risk warning", () => {
  const result = analyzePolicy({
    policyType: "trade",
    name: "Tariff Increase",
    description: "25% tariff on imported goods",
    changes: [
      { variable: "tariff_rate", currentValue: 0.05, scenarioValue: 0.25, unit: "%" },
    ],
    transmissionLagQuarters: 2,
    estimatedImpacts: {
      domestic_production: 0.01,
      consumer_prices: -0.02,
      trade_volume: -0.05,
    },
  });

  assert.ok(result.riskFactors.some((r) => r.includes("Mixed")));
  assert.ok(result.riskFactors.some((r) => r.includes("Large magnitude")));
});

test("policy scenario: neutral stance when effects balance", () => {
  const result = analyzePolicy({
    policyType: "regulatory",
    name: "Neutral Policy",
    description: "Balanced regulation change",
    changes: [{ variable: "regulation_index", currentValue: 50, scenarioValue: 52, unit: "index" }],
    transmissionLagQuarters: 3,
    estimatedImpacts: { growth: 0.001, costs: -0.001 },
  });
  assert.equal(result.netStance, "neutral");
});
