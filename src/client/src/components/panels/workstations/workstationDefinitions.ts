export type WorkstationStage = "CONNECT" | "ANALYZE" | "MODEL" | "DECIDE" | "DELIVER" | "TRUST";

export interface WorkstationSectionDefinition {
  id: string;
  label: string;
  code: string;
  description: string;
  stage: WorkstationStage;
}

export interface WorkstationDefinition {
  id: string;
  title: string;
  subtitle: string;
  sections: readonly WorkstationSectionDefinition[];
}

export const WORKSTATION_DEFINITIONS = {
  valuation: {
    id: "valuation",
    title: "VALUATION WORKSTATION",
    subtitle: "Financials → assumptions → intrinsic value → relative value → advanced models → methodology",
    sections: [
      { id: "overview", label: "OVERVIEW", code: "MAP", description: "See data readiness, workflow order, and what is authoritative versus assumed.", stage: "ANALYZE" },
      { id: "financials", label: "FINANCIALS", code: "FIN", description: "Inspect the normalized income statement, balance sheet, and cash-flow history feeding valuation.", stage: "ANALYZE" },
      { id: "fundamentals", label: "FUNDAMENTALS", code: "FUND", description: "Review operating, capital structure, quality, and market fundamentals before modeling.", stage: "ANALYZE" },
      { id: "dcf", label: "PRIMARY DCF", code: "DCF", description: "Run the institutional DCF with editable assumptions, scenario analysis, diagnostics, and sensitivity.", stage: "MODEL" },
      { id: "comps", label: "COMPS", code: "COMP", description: "Benchmark valuation and operating metrics against a selected peer set.", stage: "DECIDE" },
      { id: "advanced", label: "ADVANCED MODELS", code: "ADV", description: "Open the source-gated advanced valuation engine: DDM, residual income, EVA, reverse DCF, LBO/carry, quality/credit models, and model agreement.", stage: "MODEL" },
      { id: "methodology", label: "METHODS & TRUST", code: "METH", description: "Inspect source readiness, fallback policy, model hierarchy, and calculation conventions.", stage: "TRUST" },
    ],
  },
  portfolio: {
    id: "portfolio",
    title: "PORTFOLIO & RISK WORKSTATION",
    subtitle: "Holdings → construction → attribution → risk → stress → network → methodology",
    sections: [
      { id: "overview", label: "OVERVIEW", code: "MAP", description: "Understand the full portfolio workflow and which engine owns each decision layer.", stage: "ANALYZE" },
      { id: "holdings", label: "HOLDINGS", code: "HOLD", description: "Inspect positions, P&L, benchmark context, and quality/valuation exposure.", stage: "ANALYZE" },
      { id: "optimizer", label: "OPTIMIZE", code: "OPT", description: "Construct allocations with efficient-frontier, Black-Litterman, HRP, risk-budget, shrinkage, and mandate tools.", stage: "MODEL" },
      { id: "attribution", label: "ATTRIBUTION", code: "ATTR", description: "Decompose performance and style exposure instead of reading total return in isolation.", stage: "ANALYZE" },
      { id: "risk", label: "RISK", code: "RISK", description: "Measure VaR, Expected Shortfall, tail behavior, liquidity risk, and portfolio credit loss.", stage: "DECIDE" },
      { id: "stress", label: "STRESS", code: "STRS", description: "Run historical-style and analyst-defined stress assumptions, reverse stress, and correlation breakdowns.", stage: "DECIDE" },
      { id: "network", label: "RISK NETWORK", code: "NET", description: "Inspect interconnected exposures and concentration paths that are invisible in single-asset risk metrics.", stage: "DECIDE" },
      { id: "methodology", label: "METHODS & TRUST", code: "METH", description: "Inspect covariance, VaR/ES, attribution, optimization, stress, and currency-handling conventions.", stage: "TRUST" },
    ],
  },
  fixedIncome: {
    id: "fixed-income",
    title: "FIXED INCOME & CREDIT WORKSTATION",
    subtitle: "Live curves → bond risk → credit → rates derivatives → methodology",
    sections: [
      { id: "overview", label: "OVERVIEW", code: "MAP", description: "Separate observed curve data from scenario assumptions and choose the right rates/credit engine.", stage: "ANALYZE" },
      { id: "curves", label: "LIVE CURVES", code: "CRV", description: "Inspect observed yield-curve structure and curve diagnostics before pricing or shocking instruments.", stage: "ANALYZE" },
      { id: "bonds", label: "BONDS / CREDIT / RATES", code: "FI", description: "Price bonds, measure duration/convexity, analyze spreads/OAS/credit, and run rates-derivative models.", stage: "MODEL" },
      { id: "methodology", label: "FORMULAS & TRUST", code: "METH", description: "See bond, duration, convexity, CDS, and scenario conventions plus explicit source/assumption boundaries.", stage: "TRUST" },
    ],
  },
  quant: {
    id: "quant",
    title: "QUANT RESEARCH WORKSTATION",
    subtitle: "Factor structure → dependence → forecasting → econometrics → derivatives → ML",
    sections: [
      { id: "overview", label: "MODEL MAP", code: "MAP", description: "See the quantitative model families by research question instead of hunting through one long tab bar.", stage: "ANALYZE" },
      { id: "lab", label: "QUANT LAB", code: "LAB", description: "Run the existing deterministic/statistical model suite on observed or explicitly supplied datasets.", stage: "MODEL" },
      { id: "methodology", label: "METHODS & LIMITS", code: "METH", description: "Review what each model can infer, required inputs, and where statistical evidence is not causation or certainty.", stage: "TRUST" },
    ],
  },
  economics: {
    id: "economics",
    title: "ECONOMICS & POLICY WORKSTATION",
    subtitle: "Macro conditions → signals → policy models → indicator lab → source-backed calendar",
    sections: [
      { id: "overview", label: "OVERVIEW", code: "MAP", description: "Move from macro conditions to an explicit policy/company implication workflow.", stage: "ANALYZE" },
      { id: "macro", label: "MACRO", code: "MACR", description: "Review growth, inflation, labor, rates, and core economic conditions.", stage: "ANALYZE" },
      { id: "signals", label: "SIGNALS", code: "SIG", description: "Translate relationships across economic series into interpretable macro signals.", stage: "ANALYZE" },
      { id: "policy", label: "POLICY QUANT", code: "POL", description: "Run Taylor Rule, Phillips Curve, input-output, distributional, tax, carbon, and transmission models.", stage: "MODEL" },
      { id: "indicators", label: "INDICATOR LAB", code: "LAB", description: "Transform, normalize, regress, and compare economic time series before using them in a decision.", stage: "MODEL" },
      { id: "calendar", label: "CALENDAR", code: "CAL", description: "Inspect only source-backed economic events; hard-coded central-bank probability presets are no longer rendered.", stage: "ANALYZE" },
    ],
  },
  research: {
    id: "research",
    title: "RESEARCH INTELLIGENCE WORKSTATION",
    subtitle: "Investigation → evidence → filings → consensus → financial context → methodology",
    sections: [
      { id: "investigation", label: "INVESTIGATION", code: "CASE", description: "Build a persistent thesis with source-scored evidence, relationships, timelines, changes, and briefs.", stage: "ANALYZE" },
      { id: "perspectives", label: "PERSPECTIVES", code: "VIEW", description: "Explore the two sides of explicit evidence relationships, trace recorded sources, and see where investigation links are missing.", stage: "ANALYZE" },
      { id: "filings", label: "FILINGS", code: "FILE", description: "Inspect company filing evidence and move between relevant security contexts.", stage: "ANALYZE" },
      { id: "consensus", label: "CONSENSUS", code: "CONS", description: "Compare internal conclusions with external expectations and variant perception.", stage: "DECIDE" },
      { id: "financials", label: "FINANCIALS", code: "FIN", description: "Ground the thesis in normalized statements rather than narrative evidence alone.", stage: "ANALYZE" },
      { id: "fundamentals", label: "FUNDAMENTALS", code: "FUND", description: "Connect the evidence case to current operating and market fundamentals.", stage: "ANALYZE" },
      { id: "methodology", label: "EVIDENCE METHOD", code: "METH", description: "See evidence classes, quality scoring, relationship semantics, and change-tracking rules.", stage: "TRUST" },
    ],
  },
} as const satisfies Record<string, WorkstationDefinition>;

export type WorkstationKey = keyof typeof WORKSTATION_DEFINITIONS;

export function validateWorkstationDefinition(definition: WorkstationDefinition): string[] {
  const issues: string[] = [];
  if (!definition.id.trim()) issues.push("missing workstation id");
  if (!definition.title.trim()) issues.push("missing workstation title");
  if (definition.sections.length < 2) issues.push("workstation must expose at least two sections");

  const ids = new Set<string>();
  const codes = new Set<string>();
  for (const section of definition.sections) {
    if (!section.id.trim()) issues.push("section missing id");
    if (!section.label.trim()) issues.push(`section ${section.id || "<unknown>"} missing label`);
    if (!section.description.trim()) issues.push(`section ${section.id || "<unknown>"} missing description`);
    if (ids.has(section.id)) issues.push(`duplicate section id: ${section.id}`);
    if (codes.has(section.code)) issues.push(`duplicate section code: ${section.code}`);
    ids.add(section.id);
    codes.add(section.code);
  }
  return issues;
}
