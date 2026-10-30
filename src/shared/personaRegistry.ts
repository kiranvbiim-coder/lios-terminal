/**
 * Canonical professional persona metadata.
 *
 * Personas are an experience preference only. They do not grant access to a
 * view, engine, data contract, or security-sensitive operation; server-side
 * authorization remains authoritative and is evaluated from the user's
 * security role and tenant entitlements.
 */

export const SECURITY_ROLE_IDS = [
  "internal_admin",
  "internal_analyst",
  "internal_compliance",
  "client_admin",
  "client_user",
] as const;

export type SecurityRoleId = (typeof SECURITY_ROLE_IDS)[number];

export const PERSONA_IDS = [
  "general",
  "buy_side_pm",
  "equity_research",
  "portfolio_risk",
  "quant_analyst",
  "sell_side_research",
  "trader_execution",
  "macro_economics",
  "investment_banking",
  "corporate_strategy",
  "compliance_governance",
  "research_operations",
  "executive_decision_maker",
] as const;

export type PersonaId = (typeof PERSONA_IDS)[number];

export interface PersonaProfile {
  id: PersonaId;
  label: string;
  description: string;
  defaultDomain: string;
  preferredViews: readonly string[];
  capabilities: readonly string[];
  starterLabels: readonly string[];
  defaultAlertTypes: readonly string[];
  defaultDeliverableTypes: readonly string[];
  allowedSecurityRoles: readonly SecurityRoleId[];
}

const INTERNAL_AND_CLIENT_ROLES = SECURITY_ROLE_IDS;
const INTERNAL_RESEARCH_ROLES = ["internal_admin", "internal_analyst"] as const;
const INTERNAL_CONTROL_ROLES = ["internal_admin", "internal_compliance"] as const;
const LEADERSHIP_ROLES = ["internal_admin", "internal_analyst", "client_admin"] as const;

/** The one canonical source for professional persona IDs and metadata. */
export const PERSONA_REGISTRY: Record<PersonaId, PersonaProfile> = {
  general: {
    id: "general", label: "General Analyst",
    description: "A balanced starting point for market, company, and decision research.", defaultDomain: "finance",
    preferredViews: ["market", "quote", "chart", "news", "research", "workspaces"],
    capabilities: ["market_data", "price_history", "company", "research.investigation", "ai"],
    starterLabels: ["Market overview", "Company research", "Morning brief"], defaultAlertTypes: ["price", "earnings", "macro_release"], defaultDeliverableTypes: ["note", "brief", "report"], allowedSecurityRoles: INTERNAL_AND_CLIENT_ROLES,
  },
  buy_side_pm: {
    id: "buy_side_pm", label: "Buy-Side Portfolio Manager",
    description: "Portfolio construction and investment decision workflows for an active allocator.", defaultDomain: "finance",
    preferredViews: ["portfolio", "market", "quote", "screener", "peercomp", "valuation", "consensus", "riskcalc", "optimizer", "portfolioattribution"],
    capabilities: ["portfolio", "market_data", "price_history", "financial_statements", "estimates", "valuation.dcf", "valuation.comps", "portfolio.optimizer", "portfolio.risk", "portfolio.attribution"],
    starterLabels: ["Portfolio review", "Investment thesis", "Risk budget"], defaultAlertTypes: ["price", "drawdown", "consensus_revision", "risk_limit"], defaultDeliverableTypes: ["trade_idea", "brief", "report"], allowedSecurityRoles: ["internal_admin", "internal_analyst", "client_admin", "client_user"],
  },
  equity_research: {
    id: "equity_research", label: "Equity Research Analyst",
    description: "Evidence-led company analysis, estimates, filings, and valuation work.", defaultDomain: "finance",
    preferredViews: ["research", "filingintel", "financialstatements", "quote", "chart", "peercomp", "consensus", "valuation", "earnings", "screener"],
    capabilities: ["company", "filings", "financial_statements", "market_data", "price_history", "estimates", "research.investigation", "valuation.dcf", "valuation.comps", "market.peer_comparison"],
    starterLabels: ["Company deep dive", "Earnings review", "Variant view"], defaultAlertTypes: ["earnings", "consensus_revision", "filing", "price"], defaultDeliverableTypes: ["note", "report", "brief"], allowedSecurityRoles: ["internal_admin", "internal_analyst", "client_admin", "client_user"],
  },
  portfolio_risk: {
    id: "portfolio_risk", label: "Portfolio Risk Manager",
    description: "Exposure, concentration, stress, and benchmark-relative risk monitoring.", defaultDomain: "finance",
    preferredViews: ["portfolio", "riskcalc", "portfoliostress", "correlation", "advancedrisk", "risknetwork", "portfolioattribution", "macrostress"],
    capabilities: ["portfolio", "price_history", "market_data", "macro", "portfolio.risk", "portfolio.concentration", "portfolio.attribution", "portfolio.factor_exposure", "macro.shock_analysis"],
    starterLabels: ["Risk dashboard", "Stress test", "Concentration review"], defaultAlertTypes: ["drawdown", "volatility", "risk_limit", "macro_release"], defaultDeliverableTypes: ["brief", "report", "note"], allowedSecurityRoles: ["internal_admin", "internal_analyst", "client_admin", "client_user"],
  },
  quant_analyst: {
    id: "quant_analyst", label: "Quantitative Analyst",
    description: "Reproducible modeling, factor analysis, experiments, and systematic research.", defaultDomain: "finance",
    preferredViews: ["quantlab", "quantworkbench", "quantregistry", "assetpricing", "advancedrisk", "correlation", "backtesting", "marketdatafabric", "economicdatafabric"],
    capabilities: ["market_data", "price_history", "portfolio", "macro", "assumptions", "portfolio.factor_exposure", "portfolio.risk", "valuation.sensitivity", "ai"],
    starterLabels: ["Factor model", "Research experiment", "Model readiness"], defaultAlertTypes: ["model_drift", "data_quality", "volatility"], defaultDeliverableTypes: ["note", "report", "brief"], allowedSecurityRoles: INTERNAL_RESEARCH_ROLES,
  },
  sell_side_research: {
    id: "sell_side_research", label: "Sell-Side Research Analyst",
    description: "Fast, source-grounded coverage and client-ready research production.", defaultDomain: "finance",
    preferredViews: ["research", "consensus", "quote", "chart", "screener", "peercomp", "financialstatements", "filingintel", "valuation", "morningbrief"],
    capabilities: ["company", "market_data", "price_history", "financial_statements", "estimates", "filings", "research.investigation", "valuation.comps", "ai"],
    starterLabels: ["Coverage update", "Estimate revision", "Client note"], defaultAlertTypes: ["earnings", "consensus_revision", "filing", "price"], defaultDeliverableTypes: ["note", "brief", "report"], allowedSecurityRoles: INTERNAL_RESEARCH_ROLES,
  },
  trader_execution: {
    id: "trader_execution", label: "Trader / Execution",
    description: "Market context, liquidity, derivatives, and disciplined execution preparation.", defaultDomain: "finance",
    preferredViews: ["market", "quote", "chart", "options", "optionsflow", "flow", "crossasset", "yieldcurve", "tradeideas", "riskcalc", "alerts"],
    capabilities: ["market_data", "price_history", "derivatives", "fixed_income", "portfolio", "macro", "market.quote_monitor", "derivatives.options_greeks", "fixed_income.yield_curve"],
    starterLabels: ["Market pulse", "Execution checklist", "Options monitor"], defaultAlertTypes: ["price", "volatility", "liquidity", "execution_risk"], defaultDeliverableTypes: ["trade_idea", "brief", "note"], allowedSecurityRoles: ["internal_admin", "internal_analyst", "client_admin", "client_user"],
  },
  macro_economics: {
    id: "macro_economics", label: "Macro Economist",
    description: "Economic indicators, policy scenarios, rates, and cross-asset context.", defaultDomain: "economics_policy",
    preferredViews: ["economics", "macrodashboard", "indicatorexplorer", "indicatorworkbench", "econsignals", "yieldcurve", "macrostress", "globalindicators", "globaldevelopment", "crossasset"],
    capabilities: ["macro", "fixed_income", "market_data", "price_history", "portfolio", "macro.dashboard", "macro.policy_scenario", "macro.shock_analysis", "fixed_income.yield_curve"],
    starterLabels: ["Policy watch", "Rates dashboard", "Macro scenario"], defaultAlertTypes: ["macro_release", "policy_decision", "yield_curve_move"], defaultDeliverableTypes: ["brief", "report", "note"], allowedSecurityRoles: INTERNAL_AND_CLIENT_ROLES,
  },
  investment_banking: {
    id: "investment_banking", label: "Investment Banker",
    description: "Transaction analysis, valuation, diligence, and decision materials.", defaultDomain: "finance",
    preferredViews: ["valuation", "mnadesk", "peercomp", "financialstatements", "research", "filingintel", "spreadsheet", "workspaces", "advisory"],
    capabilities: ["company", "financial_statements", "market_data", "estimates", "filings", "transactions", "assumptions", "valuation.dcf", "valuation.lbo", "valuation.comps"],
    starterLabels: ["Transaction comps", "Diligence brief", "Deal model"], defaultAlertTypes: ["filing", "valuation_change", "deal_deadline"], defaultDeliverableTypes: ["report", "brief", "note"], allowedSecurityRoles: ["internal_admin", "internal_analyst", "client_admin", "client_user"],
  },
  corporate_strategy: {
    id: "corporate_strategy", label: "Corporate Strategist",
    description: "Structured market, competitor, operating, and strategic decision support.", defaultDomain: "finance",
    preferredViews: ["research", "market", "screener", "peercomp", "mnadesk", "fpa", "workspaces", "advisory", "decisionengine"],
    capabilities: ["company", "market_data", "financial_statements", "operations", "transactions", "macro", "research.investigation", "operations.driver_tree", "ai"],
    starterLabels: ["Market entry", "Competitive landscape", "Strategic options"], defaultAlertTypes: ["market_shift", "competitor_event", "operational_disruption"], defaultDeliverableTypes: ["brief", "report", "note"], allowedSecurityRoles: INTERNAL_AND_CLIENT_ROLES,
  },
  compliance_governance: {
    id: "compliance_governance", label: "Compliance & Governance",
    description: "Controls, evidence, policy review, and accountable decision governance.", defaultDomain: "finance",
    preferredViews: ["research", "filingintel", "decisionengine", "qualitygate", "publishdesk", "adminconsole", "workspaces"],
    capabilities: ["company", "filings", "research.investigation", "ai"],
    starterLabels: ["Evidence review", "Control check", "Approval queue"], defaultAlertTypes: ["filing", "compliance_deadline", "approval_required", "data_quality"], defaultDeliverableTypes: ["note", "report", "brief"], allowedSecurityRoles: INTERNAL_CONTROL_ROLES,
  },
  research_operations: {
    id: "research_operations", label: "Research Operations",
    description: "Repeatable research workflows, source quality, data readiness, and delivery operations.", defaultDomain: "finance",
    preferredViews: ["research", "uide", "coveragemap", "enginereadiness", "connectors", "conflictdetector", "workspaces", "spreadsheet", "publishdesk"],
    capabilities: ["company", "market_data", "financial_statements", "filings", "research.investigation", "ai"],
    starterLabels: ["Source coverage", "Data readiness", "Research queue"], defaultAlertTypes: ["data_quality", "connector_health", "delivery_deadline"], defaultDeliverableTypes: ["note", "brief", "report"], allowedSecurityRoles: ["internal_admin", "internal_analyst", "internal_compliance"],
  },
  executive_decision_maker: {
    id: "executive_decision_maker", label: "Executive Decision Maker",
    description: "Concise, evidence-backed views for prioritization, risk, and action.", defaultDomain: "finance",
    preferredViews: ["morningbrief", "market", "portfolio", "macrodashboard", "riskcalc", "decisionmemory", "decisionengine", "advisory", "workspaces"],
    capabilities: ["market_data", "portfolio", "macro", "company", "research.investigation", "portfolio.risk", "macro.shock_analysis", "ai"],
    starterLabels: ["Decision brief", "Key risks", "Action tracker"], defaultAlertTypes: ["material_change", "risk_limit", "approval_required", "decision_deadline"], defaultDeliverableTypes: ["brief", "report", "note"], allowedSecurityRoles: LEADERSHIP_ROLES,
  },
};

export const CANONICAL_PERSONA_REGISTRY = PERSONA_REGISTRY;
export const PERSONAS = PERSONA_REGISTRY;

export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PERSONA_REGISTRY, value);
}

export function getPersonaProfile(id: string): PersonaProfile | undefined {
  return isPersonaId(id) ? PERSONA_REGISTRY[id] : undefined;
}
