/**
 * Industry Packs -- curated, industry-typical assumption overrides layered
 * on top of an existing template's own defaults, not a separate template.
 * A SaaS company's credit profile (asset-light, low leverage) and an
 * industrials LBO's entry structure (higher leverage, capital-intensive)
 * are different enough that one generic default set can't honestly serve
 * both -- but the underlying methodology (Credit Analysis, LBO Debt
 * Paydown) is identical, so this is an override layer, not new content.
 *
 * Only overrides where an industry's typical numbers meaningfully diverge
 * from the generic default are included -- a pack doesn't need to touch
 * every template, only the ones where "typical for this industry" is
 * actually a different number worth encoding.
 */

export interface IndustryPackOverride {
  templateId: string;
  inputs: Record<string, unknown>; // shallow-merged over that template's own DEFAULT_*_INPUTS
}

export interface IndustryPack {
  id: string;
  label: string;
  description: string;
  overrides: IndustryPackOverride[];
}

export const INDUSTRY_PACKS: IndustryPack[] = [
  {
    id: "saas",
    label: "SaaS / Software",
    description: "Asset-light, low-leverage, high-margin assumptions -- low churn, low debt, tight covenants relative to a generic default.",
    overrides: [
      {
        templateId: "saas-metrics",
        inputs: { grossMarginPct: 82, monthlyChurnPct: 1.5, cacPerCustomer: 2000 },
      },
      {
        templateId: "credit-analysis",
        inputs: { totalDebt: 200, interestExpense: 12, ebitda: 100, ebit: 85, maxLeverageCovenant: 3, minCoverageCovenant: 6 },
      },
    ],
  },
  {
    id: "retail",
    label: "Retail / Consumer",
    description: "Lower, revenue-driven multiples typical of retail M&A and sum-of-the-parts work -- thinner margins than tech, valued more off revenue scale than software-style EBITDA premiums.",
    overrides: [
      {
        templateId: "sotp",
        inputs: {
          segments: [
            { name: "Core Retail", ebitda: 150, multiple: 7 },
            { name: "E-Commerce", ebitda: 60, multiple: 8 },
            { name: "Wholesale", ebitda: 25, multiple: 6 },
            { name: "Corporate / Other", ebitda: -15, multiple: 5 },
          ],
        },
      },
      {
        // Names left blank, not "Target A"/"Acquirer A" -- same reasoning as
        // transactionComps.ts's own default: a named fictional deal paired
        // with specific dollar figures reads as real data pulled from
        // somewhere. The multiples here stay real retail-typical figures
        // (lower, revenue-driven vs. tech's EBITDA premium) so the pack
        // still overrides toward something retail-specific on creation;
        // the analyst fills in the real deal names.
        templateId: "transaction-comps",
        inputs: {
          deals: [
            { target: "", acquirer: "", dealEv: 480, targetRevenue: 400, targetEbitda: 60 },
            { target: "", acquirer: "", dealEv: 360, targetRevenue: 300, targetEbitda: 40 },
            { target: "", acquirer: "", dealEv: 750, targetRevenue: 500, targetEbitda: 85 },
            { target: "", acquirer: "", dealEv: 300, targetRevenue: 250, targetEbitda: 32 },
            { target: "", acquirer: "", dealEv: 630, targetRevenue: 450, targetEbitda: 72 },
          ],
        },
      },
    ],
  },
  {
    id: "industrials",
    label: "Industrials / Manufacturing",
    description: "Higher entry leverage and capital intensity typical of an industrials LBO, with covenant headroom sized for asset-heavy, collateral-backed lending.",
    overrides: [
      {
        templateId: "lbo-debt-paydown",
        inputs: { entryDebtMultiple: 5.5, ebitGrowthPct: 4, capexPctOfEbit: 18, daPctOfEbit: 20 },
      },
      {
        templateId: "credit-analysis",
        inputs: { maxLeverageCovenant: 5.5, minCoverageCovenant: 2.5 },
      },
    ],
  },
];

export function getIndustryPack(id: string): IndustryPack | undefined {
  return INDUSTRY_PACKS.find((p) => p.id === id);
}

export function getPackOverride(pack: IndustryPack | undefined, templateId: string): Record<string, unknown> | undefined {
  return pack?.overrides.find((o) => o.templateId === templateId)?.inputs;
}
