import type { ViewMode } from "./terminalTypes";
import { getExperienceViewLabel } from "./terminalExperience";

export type ToolRelationship = "next" | "related" | "feeds" | "evidence" | "deliver" | "monitor";

export interface ToolGraphEdge {
  from: ViewMode;
  to: ViewMode;
  relationship: ToolRelationship;
  reason: string;
  internalOnly?: boolean;
  clientOnly?: boolean;
}

export interface ToolGraphAction {
  view: ViewMode;
  label: string;
  relationship: ToolRelationship;
  reason: string;
}

export interface AnalysisJourney {
  id: string;
  label: string;
  stages: readonly { label: string; views: readonly ViewMode[] }[];
}

const EDGES: readonly ToolGraphEdge[] = [
  // Equity research / company intelligence
  { from: "entity", to: "companyfundamentals", relationship: "next", reason: "Understand the operating and financial profile." },
  { from: "entity", to: "financialstatements", relationship: "related", reason: "Inspect historical statements before modeling." },
  { from: "companyfundamentals", to: "financialstatements", relationship: "next", reason: "Move from summary metrics into the underlying statements." },
  { from: "financialstatements", to: "integratedmodel", relationship: "feeds", reason: "Build an integrated forecast from the historical statements.", internalOnly: true },
  { from: "financialstatements", to: "valuation", relationship: "next", reason: "Translate operating assumptions into intrinsic value." },
  { from: "integratedmodel", to: "valuation", relationship: "feeds", reason: "Use forecast outputs as DCF drivers.", internalOnly: true },
  { from: "valuation", to: "peercomp", relationship: "next", reason: "Benchmark intrinsic value against market comparables." },
  { from: "valuation", to: "advancedrisk", relationship: "related", reason: "Stress the valuation assumptions and downside profile." },
  { from: "valuation", to: "research", relationship: "evidence", reason: "Attach evidence and thesis context to the valuation.", internalOnly: true },
  { from: "peercomp", to: "advancedrisk", relationship: "next", reason: "Challenge relative value with risk and concentration diagnostics." },
  { from: "advancedrisk", to: "news", relationship: "evidence", reason: "Review current events that may change the risk case." },
  { from: "news", to: "filingintel", relationship: "evidence", reason: "Check primary-source filings for confirmation or contradiction." },
  { from: "filingintel", to: "research", relationship: "next", reason: "Synthesize filings and market evidence into research.", internalOnly: true },
  { from: "research", to: "consensus", relationship: "related", reason: "Compare the internal view with market expectations.", internalOnly: true },
  { from: "consensus", to: "decisionengine", relationship: "next", reason: "Convert evidence and variant perception into an auditable decision.", internalOnly: true },
  { from: "decisionengine", to: "decisionmemory", relationship: "monitor", reason: "Track assumptions, triggers, and forecast-vs-reality over time.", clientOnly: true },
  { from: "decisionengine", to: "alerts", relationship: "monitor", reason: "Monitor thesis-breaking conditions and market changes." },

  // Portfolio workflow
  { from: "portfolio", to: "portfolioattribution", relationship: "next", reason: "Explain what drove portfolio performance." },
  { from: "portfolio", to: "correlation", relationship: "related", reason: "Inspect concentration and diversification structure." },
  { from: "portfolio", to: "optimizer", relationship: "related", reason: "Explore alternative allocations and constraints." },
  { from: "portfolioattribution", to: "portfoliostress", relationship: "next", reason: "Stress the exposures that drove results." },
  { from: "correlation", to: "portfoliostress", relationship: "feeds", reason: "Use dependence structure to frame stress scenarios." },
  { from: "portfoliostress", to: "riskreturn", relationship: "next", reason: "Compare risk-adjusted outcomes across holdings or strategies." },
  { from: "riskreturn", to: "alerts", relationship: "monitor", reason: "Set monitoring around risk thresholds and changing exposures." },

  // Macro / public policy workflow
  { from: "economics", to: "macrodashboard", relationship: "next", reason: "Move from overview to a structured macro dashboard." },
  { from: "macrodashboard", to: "indicatorexplorer", relationship: "related", reason: "Drill into the underlying economic series." },
  { from: "indicatorexplorer", to: "indicatorworkbench", relationship: "next", reason: "Run transformations, regression, and statistical diagnostics." },
  { from: "indicatorworkbench", to: "econsignals", relationship: "next", reason: "Convert indicator behavior into interpretable economic signals." },
  { from: "econsignals", to: "econpolicyquant", relationship: "next", reason: "Model policy scenarios from the observed signals." },
  { from: "econpolicyquant", to: "research", relationship: "deliver", reason: "Turn scenario outputs into evidence-backed policy research.", internalOnly: true },

  // Supply chain workflow
  { from: "supplychainindicators", to: "supplychaindashboard", relationship: "next", reason: "Move from raw freight data to operational context." },
  { from: "supplychaindashboard", to: "supplychainquant", relationship: "next", reason: "Model network, capacity, cost, or routing scenarios." },
  { from: "supplychainquant", to: "spreadsheet", relationship: "deliver", reason: "Send scenario outputs into a reusable model or client deliverable." },

  // Sustainability workflow
  { from: "environmentindicators", to: "environmentdashboard", relationship: "next", reason: "Contextualize emissions and energy indicators." },
  { from: "environmentdashboard", to: "environmentquant", relationship: "next", reason: "Run sustainability and emissions scenarios." },
  { from: "globalclimate", to: "environmentquant", relationship: "feeds", reason: "Feed physical-risk and climate observations into scenario analysis." },
  { from: "environmentquant", to: "carbonintensity", relationship: "related", reason: "Benchmark emissions intensity and transition trajectory." },

  // Discover -> analyze bridges
  { from: "screener", to: "peercomp", relationship: "feeds", reason: "Use screened names as a comparable universe." },
  { from: "screener", to: "entity", relationship: "next", reason: "Open a selected company in a full analytical workspace." },
  { from: "scanner", to: "chart", relationship: "next", reason: "Inspect detected patterns in full chart context." },
  { from: "market", to: "screener", relationship: "related", reason: "Turn a market observation into a filtered opportunity set." },
  { from: "market", to: "sectorrotation", relationship: "related", reason: "Understand leadership and regime rotation beneath the market." },

  // Cross-domain / delivery
  { from: "crossdomainfusion", to: "decisionmemory", relationship: "deliver", reason: "Persist cross-domain conclusions and their assumptions.", clientOnly: true },
  { from: "datastats", to: "spreadsheet", relationship: "deliver", reason: "Send statistical outputs to a reusable analytical sheet." },
  { from: "quantworkbench", to: "backtesting", relationship: "next", reason: "Test a validated quantitative signal through time." },
  { from: "backtesting", to: "quantlab", relationship: "related", reason: "Scale experiments and compare durable runs.", internalOnly: true },
  { from: "spreadsheet", to: "workspaces", relationship: "deliver", reason: "Package model outputs into a saved engagement workspace." },

  // Discover / evidence-gathering companions
  { from: "agent", to: "entity", relationship: "next", reason: "Jump from a conversational answer into a full analytical workspace." },
  { from: "watchlist", to: "alerts", relationship: "next", reason: "Turn a tracked security into a monitored condition." },
  { from: "sentiment", to: "news", relationship: "evidence", reason: "Check what's actually driving an extreme sentiment reading." },
  { from: "morningbrief", to: "market", relationship: "next", reason: "Move from the pre-market synthesis into the full market read." },
  { from: "insiders", to: "entity", relationship: "evidence", reason: "View insider activity in the context of the full company workspace." },
  { from: "cotpositioning", to: "forex", relationship: "related", reason: "Cross-reference futures positioning against currency market context." },
  { from: "optionsflow", to: "options", relationship: "next", reason: "Inspect the specific contract behind an unusual flow print." },
  { from: "shortinterest", to: "entity", relationship: "evidence", reason: "View short-interest context alongside the rest of the company workspace." },
  { from: "tradeideas", to: "entity", relationship: "next", reason: "Take a shortlisted idea into a full analytical workspace." },

  // Model-tier tools feeding valuation and risk
  { from: "montecarlo", to: "valuation", relationship: "related", reason: "Compare simulated price paths against the intrinsic-value estimate." },
  { from: "options", to: "montecarlo", relationship: "related", reason: "Cross-check option-implied probabilities against simulated price paths." },
  { from: "fixedincome", to: "yieldcurve", relationship: "related", reason: "Frame a single bond's price risk against the full curve." },
  { from: "assetpricing", to: "riskreturn", relationship: "next", reason: "Compare factor-adjusted performance on a risk-adjusted basis." },
  { from: "shillercape", to: "valuation", relationship: "related", reason: "Compare a cycle-adjusted valuation read against the DCF estimate." },

  // Quant Lab cluster -- the dense models are designed to be read together
  { from: "ising", to: "hawkes", relationship: "related", reason: "Compare herding dynamics against event-clustering intensity." },
  { from: "hawkes", to: "ising", relationship: "related", reason: "Compare event-clustering intensity against herding dynamics." },
  { from: "quantum", to: "chart", relationship: "related", reason: "See the modeled support/resistance probability against live price action." },
  { from: "fractal", to: "advancedrisk", relationship: "feeds", reason: "Feed persistence and tail-risk estimates into a fuller risk read." },
  { from: "entropy", to: "correlation", relationship: "related", reason: "Compare directional predictive relationships against simple correlation." },
  { from: "risknetwork", to: "correlation", relationship: "related", reason: "Compare spillover propagation against the underlying correlation structure." },
  { from: "flow", to: "ising", relationship: "related", reason: "Drill from the synthesis into the individual coordination signal." },

  // Portfolio and macro extensions
  { from: "riskcalc", to: "portfoliostress", relationship: "next", reason: "Move from a single position calculation to full-book stress impact." },
  { from: "ecalendar", to: "econpolicyquant", relationship: "next", reason: "Model the scenario behind an upcoming policy decision." },

  // Named platform differentiators
  { from: "coveragemap", to: "conflictdetector", relationship: "related", reason: "Check whether available sources actually agree before trusting coverage." },
  { from: "conflictdetector", to: "valuation", relationship: "evidence", reason: "Resolve a data disagreement before it enters a valuation.", internalOnly: true },
  { from: "brain", to: "research", relationship: "deliver", reason: "Turn a multi-step investigation into a structured research note.", internalOnly: true },
  { from: "clientdata", to: "portfolio", relationship: "feeds", reason: "Use your own uploaded data as portfolio input.", clientOnly: true },

  // Platform readiness chain (internal only): connector health -> engine
  // readiness -> data-fabric coverage -> model validation -> delivery gate.
  { from: "connectors", to: "enginereadiness", relationship: "next", reason: "Move from connector health to the engines that depend on it.", internalOnly: true },
  { from: "enginereadiness", to: "quantregistry", relationship: "next", reason: "Cross-reference engine readiness against each model's validation status.", internalOnly: true },
  { from: "quantregistry", to: "qualitygate", relationship: "deliver", reason: "Validated models feed into the deliverable approval pipeline.", internalOnly: true },
  { from: "marketdatafabric", to: "connectors", relationship: "related", reason: "Trace a point-in-time price snapshot back to its source connector.", internalOnly: true },
  { from: "economicdatafabric", to: "econpolicyquant", relationship: "feeds", reason: "Feed point-in-time economic snapshots into policy scenario modeling.", internalOnly: true },
  { from: "universefabric", to: "screener", relationship: "feeds", reason: "Use point-in-time universe membership as a bias-free screening base.", internalOnly: true },
  { from: "crossassetfabric", to: "crossasset", relationship: "related", reason: "Compare point-in-time alternative-data snapshots against the live cross-asset view.", internalOnly: true },
];

export const ANALYSIS_JOURNEYS: readonly AnalysisJourney[] = [
  {
    id: "equity-research",
    label: "Equity Research",
    stages: [
      { label: "Discover", views: ["market", "screener", "scanner", "watchlist", "sentiment", "morningbrief", "agent"] },
      { label: "Understand", views: ["entity", "companyfundamentals", "financialstatements", "insiders", "cotpositioning"] },
      { label: "Model", views: ["integratedmodel", "valuation", "peercomp", "montecarlo", "options", "fixedincome", "assetpricing", "shillercape"] },
      { label: "Challenge", views: ["advancedrisk", "news", "filingintel", "consensus", "optionsflow", "shortinterest", "coveragemap", "conflictdetector", "tradeideas"] },
      { label: "Decide", views: ["research", "decisionengine", "brain"] },
      { label: "Monitor", views: ["alerts", "decisionmemory"] },
    ],
  },
  {
    id: "portfolio",
    label: "Portfolio Intelligence",
    stages: [
      { label: "Observe", views: ["portfolio", "clientdata"] },
      { label: "Explain", views: ["portfolioattribution", "correlation"] },
      { label: "Stress", views: ["portfoliostress", "macrostress", "riskcalc"] },
      { label: "Optimize", views: ["optimizer", "riskreturn"] },
      { label: "Monitor", views: ["alerts"] },
    ],
  },
  {
    id: "macro-policy",
    label: "Macro & Policy",
    stages: [
      { label: "Explore", views: ["economics", "macrodashboard", "indicatorexplorer", "ecalendar"] },
      { label: "Diagnose", views: ["indicatorworkbench", "econsignals"] },
      { label: "Model", views: ["econpolicyquant", "macrostress"] },
      { label: "Deliver", views: ["research", "workspaces"] },
    ],
  },
  {
    id: "supply-chain",
    label: "Supply Chain",
    stages: [
      { label: "Observe", views: ["supplychainindicators", "supplychaindashboard"] },
      { label: "Model", views: ["supplychainquant"] },
      { label: "Deliver", views: ["spreadsheet", "workspaces"] },
    ],
  },
  {
    id: "sustainability",
    label: "Sustainability",
    stages: [
      { label: "Observe", views: ["environmentindicators", "environmentdashboard", "globalclimate"] },
      { label: "Model", views: ["environmentquant"] },
      { label: "Benchmark", views: ["carbonintensity"] },
      { label: "Deliver", views: ["workspaces"] },
    ],
  },
  {
    id: "quant-lab",
    label: "Quant Lab",
    stages: [
      { label: "Explore", views: ["ising", "hawkes", "quantum"] },
      { label: "Diagnose", views: ["fractal", "entropy", "risknetwork"] },
      { label: "Synthesize", views: ["flow"] },
    ],
  },
  {
    id: "platform-readiness",
    label: "Platform Readiness",
    stages: [
      { label: "Verify", views: ["connectors", "enginereadiness"] },
      { label: "Validate", views: ["marketdatafabric", "economicdatafabric", "universefabric", "crossassetfabric", "quantregistry"] },
      { label: "Approve", views: ["qualitygate"] },
    ],
  },
];

function visible(edge: ToolGraphEdge, isInternal: boolean): boolean {
  if (edge.internalOnly && !isInternal) return false;
  if (edge.clientOnly && isInternal) return false;
  return true;
}

export function getRelatedToolActions(view: ViewMode, isInternal: boolean): ToolGraphAction[] {
  const seen = new Set<ViewMode>();
  return EDGES
    .filter((edge) => edge.from === view && visible(edge, isInternal))
    .filter((edge) => {
      if (seen.has(edge.to)) return false;
      seen.add(edge.to);
      return true;
    })
    .map((edge) => ({
      view: edge.to,
      label: getExperienceViewLabel(edge.to),
      relationship: edge.relationship,
      reason: edge.reason,
    }));
}

export function getIncomingToolActions(view: ViewMode, isInternal: boolean): ToolGraphAction[] {
  return EDGES
    .filter((edge) => edge.to === view && visible(edge, isInternal))
    .slice(0, 8)
    .map((edge) => ({
      view: edge.from,
      label: getExperienceViewLabel(edge.from),
      relationship: edge.relationship,
      reason: edge.reason,
    }));
}

export function getJourneyForView(view: ViewMode): { journey: AnalysisJourney; stageIndex: number } | null {
  for (const journey of ANALYSIS_JOURNEYS) {
    const stageIndex = journey.stages.findIndex((stage) => stage.views.includes(view));
    if (stageIndex >= 0) return { journey, stageIndex };
  }
  return null;
}
