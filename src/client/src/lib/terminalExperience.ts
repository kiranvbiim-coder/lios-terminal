import type { ViewMode } from "./terminalTypes";

export interface ExperienceAction {
  id: string;
  label: string;
  shortLabel: string;
  description: string;
  view: ViewMode;
}

const VIEW_LABELS: Partial<Record<ViewMode, string>> = {
  missioncontrol: "Mission Control",
  entity: "Overview",
  market: "Markets",
  quote: "Quote",
  chart: "Chart",
  news: "News",
  agent: "AI Agent",
  screener: "Screener",
  watchlist: "Watchlist",
  alerts: "Alerts",
  economics: "Economics",
  portfolio: "Portfolio",
  personalfinance: "Personal Finance",
  valuation: "DCF",
  peercomp: "Peer Comps",
  companyfundamentals: "Fundamentals",
  financialstatements: "Financials",
  filingintel: "Filings",
  advancedrisk: "Risk",
  riskcalc: "Risk Calc",
  portfoliostress: "Stress Test",
  portfolioattribution: "Attribution",
  integratedmodel: "3-Statement",
  assetpricing: "Factor Models",
  quantworkbench: "Quant Workbench",
  backtesting: "Backtest",
  montecarlo: "Monte Carlo",
  options: "Options",
  morningbrief: "Morning Brief",
  tradeideas: "Trade Ideas",
  research: "Research",
  consensus: "Consensus",
  decisionengine: "Decision",
  indicatorexplorer: "Indicators",
  macrodashboard: "Macro Dashboard",
  indicatorworkbench: "Stats Workbench",
  econsignals: "Economic Signals",
  econpolicyquant: "Policy Engine",
  supplychaindashboard: "Supply Chain",
  supplychainindicators: "Logistics Data",
  supplychainquant: "Supply Chain Engine",
  environmentdashboard: "Sustainability",
  environmentindicators: "Emissions Data",
  environmentquant: "Sustainability Engine",
  globalclimate: "Climate Monitor",
  carbonintensity: "Carbon Intensity",
  mediadashboard: "Media Dashboard",
  mediaindicators: "Media Tone",
  tourismdashboard: "Tourism Dashboard",
  tourismindicators: "Tourism Data",
  spreadsheet: "Spreadsheet",
  workspaces: "Workspaces",
  advisory: "Consulting",
  activity: "Activity",
  clientdata: "My Data",
  uide: "Data Engine",
};

export function getExperienceViewLabel(view: ViewMode): string {
  return VIEW_LABELS[view] ?? view
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const COMPANY_VIEWS = new Set<ViewMode>([
  "entity", "quote", "chart", "news", "companyfundamentals", "financialstatements", "filingintel",
  "valuation", "peercomp", "advancedrisk", "riskcalc", "dividends", "shortinterest", "earnings",
  "options", "optionsflow", "insiders", "consensus", "research", "decisionengine",
]);

const PORTFOLIO_VIEWS = new Set<ViewMode>([
  "portfolio", "portfolioattribution", "portfoliostress", "riskcalc", "correlation", "riskreturn",
  "optimizer", "macrostress", "regime",
]);

const MACRO_VIEWS = new Set<ViewMode>([
  "economics", "indicatorexplorer", "macrodashboard", "indicatorworkbench", "econsignals",
  "econpolicyquant", "globalindicators", "globaldevelopment", "ecalendar", "yieldcurve",
]);

const SUPPLY_CHAIN_VIEWS = new Set<ViewMode>([
  "supplychaindashboard", "supplychainindicators", "supplychainquant",
]);

const SUSTAINABILITY_VIEWS = new Set<ViewMode>([
  "environment", "environmentdashboard", "environmentindicators", "environmentquant", "globalclimate", "carbonintensity",
]);

const COMPANY_ACTIONS: readonly ExperienceAction[] = [
  { id: "financials", label: "Financial Statements", shortLabel: "FIN", description: "Inspect statements and operating history.", view: "financialstatements" },
  { id: "valuation", label: "DCF Valuation", shortLabel: "DCF", description: "Build intrinsic value from cash-flow assumptions.", view: "valuation" },
  { id: "peers", label: "Peer Comparables", shortLabel: "PEERS", description: "Benchmark valuation and operating metrics against peers.", view: "peercomp" },
  { id: "risk", label: "Advanced Risk", shortLabel: "RISK", description: "Stress-test the current security and assumptions.", view: "advancedrisk" },
];

const PORTFOLIO_ACTIONS: readonly ExperienceAction[] = [
  { id: "portfolio", label: "Portfolio", shortLabel: "PORT", description: "Return to the active portfolio view.", view: "portfolio" },
  { id: "stress", label: "Portfolio Stress", shortLabel: "STRESS", description: "Run portfolio stress scenarios.", view: "portfoliostress" },
  { id: "attribution", label: "Attribution", shortLabel: "ATTR", description: "Explain portfolio performance and contribution.", view: "portfolioattribution" },
  { id: "correlation", label: "Correlation", shortLabel: "CORR", description: "Inspect cross-asset diversification and concentration.", view: "correlation" },
];

const MACRO_ACTIONS: readonly ExperienceAction[] = [
  { id: "macro", label: "Macro Dashboard", shortLabel: "MACRO", description: "Open the macro dashboard.", view: "macrodashboard" },
  { id: "signals", label: "Economic Signals", shortLabel: "SIGNALS", description: "Inspect derived economic signals.", view: "econsignals" },
  { id: "policy", label: "Policy Engine", shortLabel: "POLICY", description: "Model policy and economic scenarios.", view: "econpolicyquant" },
  { id: "indicators", label: "Indicator Explorer", shortLabel: "DATA", description: "Explore underlying indicators and series.", view: "indicatorexplorer" },
];

const SUPPLY_CHAIN_ACTIONS: readonly ExperienceAction[] = [
  { id: "supply-dashboard", label: "Supply Chain Dashboard", shortLabel: "DASH", description: "Open the freight and logistics dashboard.", view: "supplychaindashboard" },
  { id: "supply-engine", label: "Supply Chain Engine", shortLabel: "MODEL", description: "Run quantitative supply-chain analysis.", view: "supplychainquant" },
  { id: "supply-data", label: "Logistics Data", shortLabel: "DATA", description: "Explore freight and logistics indicators.", view: "supplychainindicators" },
];

const SUSTAINABILITY_ACTIONS: readonly ExperienceAction[] = [
  { id: "sustainability-dashboard", label: "Sustainability Dashboard", shortLabel: "DASH", description: "Open the sustainability dashboard.", view: "environmentdashboard" },
  { id: "sustainability-engine", label: "Sustainability Engine", shortLabel: "MODEL", description: "Run sustainability and emissions analysis.", view: "environmentquant" },
  { id: "climate", label: "Climate Monitor", shortLabel: "CLIMATE", description: "Inspect climate and physical-risk data.", view: "globalclimate" },
  { id: "carbon", label: "Carbon Intensity", shortLabel: "CARBON", description: "Inspect carbon intensity and trend metrics.", view: "carbonintensity" },
];

export function getContextHeroActions(view: ViewMode): readonly ExperienceAction[] {
  if (COMPANY_VIEWS.has(view)) return COMPANY_ACTIONS;
  if (PORTFOLIO_VIEWS.has(view)) return PORTFOLIO_ACTIONS;
  if (MACRO_VIEWS.has(view)) return MACRO_ACTIONS;
  if (SUPPLY_CHAIN_VIEWS.has(view)) return SUPPLY_CHAIN_ACTIONS;
  if (SUSTAINABILITY_VIEWS.has(view)) return SUSTAINABILITY_ACTIONS;
  return [];
}

const NEXT_ACTIONS: Partial<Record<ViewMode, ExperienceAction>> = {
  entity: COMPANY_ACTIONS[0],
  quote: COMPANY_ACTIONS[0],
  chart: COMPANY_ACTIONS[0],
  companyfundamentals: COMPANY_ACTIONS[0],
  financialstatements: COMPANY_ACTIONS[1],
  filingintel: COMPANY_ACTIONS[1],
  valuation: COMPANY_ACTIONS[2],
  peercomp: COMPANY_ACTIONS[3],
  advancedrisk: { id: "research-next", label: "Review Evidence", shortLabel: "EVIDENCE", description: "Review news and evidence before deciding.", view: "news" },
  portfolio: PORTFOLIO_ACTIONS[1],
  portfoliostress: PORTFOLIO_ACTIONS[2],
  portfolioattribution: PORTFOLIO_ACTIONS[3],
  economics: MACRO_ACTIONS[0],
  indicatorexplorer: MACRO_ACTIONS[0],
  macrodashboard: MACRO_ACTIONS[1],
  econsignals: MACRO_ACTIONS[2],
  supplychainindicators: SUPPLY_CHAIN_ACTIONS[0],
  supplychaindashboard: SUPPLY_CHAIN_ACTIONS[1],
  environmentindicators: SUSTAINABILITY_ACTIONS[0],
  environmentdashboard: SUSTAINABILITY_ACTIONS[1],
  globalclimate: SUSTAINABILITY_ACTIONS[3],
};

export function getNextBestAction(view: ViewMode, isInternal: boolean): ExperienceAction | null {
  const action = NEXT_ACTIONS[view];
  if (action) return action;
  if (view === "news" || view === "filingintel") {
    return isInternal
      ? { id: "research-next", label: "Research Intelligence", shortLabel: "RESEARCH", description: "Synthesize evidence into a research view.", view: "research" }
      : { id: "monitor-next", label: "Monitor", shortLabel: "WATCH", description: "Track changes and alerts after analysis.", view: "alerts" };
  }
  if (view === "research" || view === "consensus") {
    return isInternal
      ? { id: "decision-next", label: "Decision Engine", shortLabel: "DECIDE", description: "Turn evidence into an auditable decision.", view: "decisionengine" }
      : null;
  }
  return null;
}
