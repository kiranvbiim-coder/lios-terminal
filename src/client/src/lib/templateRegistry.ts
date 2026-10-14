/**
 * Template registry -- the architecture piece behind the gap-analysis
 * document's biggest numeric gap (~50 named methodologies requested, one
 * template existed). Before this, adding a template meant a bespoke button
 * + bespoke handler in SpreadsheetStudioPanel.tsx every time
 * (handleThreeStatementTemplate). Now a new template is one entry appended
 * to TEMPLATE_REGISTRY -- the panel renders whatever's in the array and
 * calls a single generic handler, so growing the template library is
 * additive, not a repeated one-off wiring exercise.
 *
 * Templates have genuinely different input shapes (Three-Statement needs a
 * symbol + fetched historical financials; LBO Debt Paydown is a pure,
 * assumption-driven scenario with no live-data dependency at all) -- every
 * template's `build` function takes the SAME TemplateBuildContext shape and
 * simply ignores whatever fields it doesn't need, so the registry stays
 * uniform without forcing every template into the same data-fetching
 * pattern.
 */
import { buildThreeStatementModel, type HistoricalStatements } from "./modelTemplates";
import { buildLboDebtPaydownModel, DEFAULT_LBO_INPUTS } from "./templates/lboDebtPaydown";
import { buildApvModel, DEFAULT_APV_INPUTS } from "./templates/apv";
import { buildSotpModel, DEFAULT_SOTP_INPUTS } from "./templates/sotp";
import { buildNavModel, DEFAULT_NAV_INPUTS } from "./templates/nav";
import { buildEpvModel, DEFAULT_EPV_INPUTS } from "./templates/epv";
import { buildTransactionCompsModel, DEFAULT_TRANSACTION_COMPS_INPUTS } from "./templates/transactionComps";
import { buildCreditAnalysisModel, DEFAULT_CREDIT_ANALYSIS_INPUTS } from "./templates/creditAnalysis";
import { buildSaasMetricsModel, DEFAULT_SAAS_METRICS_INPUTS } from "./templates/saasMetrics";
import { buildProjectFinanceModel, DEFAULT_PROJECT_FINANCE_INPUTS } from "./templates/projectFinance";

export interface TemplateBuildContext {
  symbol?: string;
  hist?: HistoricalStatements;
  // Industry Packs -- shallow-merged over the template's own DEFAULT_*_INPUTS
  // (see industryPacks.ts). Loosely typed because packs are configuration
  // data describing a subset of an arbitrary template's own input shape,
  // not a single fixed interface every template shares.
  inputOverrides?: Record<string, unknown>;
}

export interface TemplateDefinition {
  id: string;
  label: string;
  category: string;
  description: string;
  // Template Versioning -- bumped whenever this template's build() output
  // changes in a way worth flagging to models already built from an older
  // version (a formula fix, a restructured layout); every template starts
  // at 1. A model created from a template stamps the version it was built
  // from (see modelStore.ts's FinancialModel.templateVersion), so the UI
  // can show "built from vN, current is vM" without guessing.
  version: number;
  requiresSymbol: boolean;       // the panel must fetch live financials for the active symbol before calling build()
  requiresIterativeCalc?: boolean; // the panel should auto-enable iterative calculation when this template is applied
  build: (ctx: TemplateBuildContext) => Record<string, string>;
  defaultModelName: (ctx: TemplateBuildContext) => string;
}

export const TEMPLATE_REGISTRY: TemplateDefinition[] = [
  {
    id: "three-statement",
    version: 1,
    label: "Three-Statement Model",
    category: "Financial Modelling",
    description: "Income statement, balance sheet, and cash flow statement seeded from live financials, with a driver-based projection.",
    requiresSymbol: true,
    build: (ctx) => {
      if (!ctx.symbol || !ctx.hist) throw new Error("Three-Statement Model requires an active symbol and its historical financials.");
      return buildThreeStatementModel(ctx.symbol, ctx.hist);
    },
    defaultModelName: (ctx) => `${ctx.symbol} Three-Statement Model`,
  },
  {
    id: "lbo-debt-paydown",
    version: 1,
    label: "LBO Debt Paydown Model",
    category: "Investment Banking",
    description: "A leveraged buyout debt schedule with real circular interest (the average-balance convention) -- shows deleveraging over the hold period from assumption-driven entry metrics, not live financials.",
    requiresSymbol: false,
    requiresIterativeCalc: true,
    build: (ctx) => buildLboDebtPaydownModel({ ...DEFAULT_LBO_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "LBO Debt Paydown Model",
  },
  {
    id: "apv",
    version: 1,
    label: "Adjusted Present Value (APV)",
    category: "Valuation",
    description: "Splits enterprise value into unlevered business value (discounted at the unlevered cost of equity) plus the separately-discounted interest tax shield -- the right tool when leverage changes materially over the projection, where a single blended WACC breaks down.",
    requiresSymbol: false,
    build: (ctx) => buildApvModel({ ...DEFAULT_APV_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "APV Model",
  },
  {
    id: "sotp",
    version: 1,
    label: "Sum-of-the-Parts (SOTP)",
    category: "Valuation",
    description: "Values a multi-segment business as the total of each segment valued independently at its own peer-group multiple, instead of one blended multiple applied to consolidated EBITDA.",
    requiresSymbol: false,
    build: (ctx) => buildSotpModel({ ...DEFAULT_SOTP_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "SOTP Valuation",
  },
  {
    id: "nav",
    version: 1,
    label: "Net Asset Value (NAV)",
    category: "Valuation",
    description: "Values a holding company, REIT, or fund as the fair value of its assets minus liabilities, with a premium/discount-to-NAV read against the current market price -- the standard screen for holdco and closed-end-fund value opportunities.",
    requiresSymbol: false,
    build: (ctx) => buildNavModel({ ...DEFAULT_NAV_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "NAV Model",
  },
  {
    id: "epv",
    version: 1,
    label: "Earnings Power Value (EPV)",
    category: "Valuation",
    description: "Bruce Greenwald's conservative, zero-growth capitalization of normalized earnings, compared against an independent reproduction-cost estimate of the asset base -- EPV above reproduction cost is evidence of a real competitive moat.",
    requiresSymbol: false,
    build: (ctx) => buildEpvModel({ ...DEFAULT_EPV_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "EPV Model",
  },
  {
    id: "transaction-comps",
    version: 1,
    label: "Precedent Transactions (Transaction Comps)",
    category: "Investment Banking",
    description: "Values a target off multiples actually paid in comparable M&A deals (which embed a control premium), with mean/median/min/max summary stats and an implied valuation range applied to the target's own revenue and EBITDA.",
    requiresSymbol: false,
    build: (ctx) => buildTransactionCompsModel({ ...DEFAULT_TRANSACTION_COMPS_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "Transaction Comps",
  },
  {
    id: "credit-analysis",
    version: 1,
    label: "Credit Analysis",
    category: "Credit",
    description: "Leverage and coverage ratios, covenant headroom, and an illustrative credit profile band -- the lender's-side question of debt-servicing capacity, not the equity holder's question of what the business is worth.",
    requiresSymbol: false,
    build: (ctx) => buildCreditAnalysisModel({ ...DEFAULT_CREDIT_ANALYSIS_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "Credit Analysis",
  },
  {
    id: "saas-metrics",
    version: 1,
    label: "Startup / SaaS Metrics",
    category: "Startup",
    description: "A month-by-month MRR roll-forward (new, expansion, churn) plus the unit-economics block -- LTV/CAC, runway, Rule of 40 -- that a generic three-statement model has no rows for.",
    requiresSymbol: false,
    build: (ctx) => buildSaasMetricsModel({ ...DEFAULT_SAAS_METRICS_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "SaaS Metrics Model",
  },
  {
    id: "project-finance",
    version: 1,
    label: "Project Finance",
    category: "Project Finance",
    description: "A Sources & Uses table sizing debt off construction cost (with capitalized interest during construction) plus a year-by-year DSCR covenant test -- the standard infrastructure/energy-project financing structure, distinct from a corporate capital structure.",
    requiresSymbol: false,
    build: (ctx) => buildProjectFinanceModel({ ...DEFAULT_PROJECT_FINANCE_INPUTS, ...ctx.inputOverrides }),
    defaultModelName: () => "Project Finance Model",
  },
];

export function getTemplate(id: string): TemplateDefinition | undefined {
  return TEMPLATE_REGISTRY.find((t) => t.id === id);
}
