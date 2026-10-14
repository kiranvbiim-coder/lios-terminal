import type { ViewMode } from "./terminalTypes";

export type EntityCapabilityStatus = "available" | "requires_data" | "unavailable";
export type EntityCapabilityGroup = "overview" | "markets" | "business" | "financials" | "valuation" | "risk" | "research" | "consensus" | "scenarios" | "decisions" | "monitor";

export interface EntityCapability {
  id: string;
  label: string;
  description: string;
  group: EntityCapabilityGroup;
  view: ViewMode;
  status?: EntityCapabilityStatus;
  actionLabel?: string;
}

export const ENTITY_GROUPS: Array<{ id: EntityCapabilityGroup; label: string; description: string }> = [
  { id: "overview", label: "OVERVIEW", description: "What matters now" },
  { id: "markets", label: "MARKETS", description: "Price, chart, liquidity and derivatives" },
  { id: "business", label: "BUSINESS", description: "Company, segments and peers" },
  { id: "financials", label: "FINANCIALS", description: "Statements and operating history" },
  { id: "valuation", label: "VALUATION", description: "Value the company and challenge expectations" },
  { id: "risk", label: "QUALITY & RISK", description: "Quality, credit and downside" },
  { id: "research", label: "RESEARCH", description: "Evidence, filings and narrative" },
  { id: "consensus", label: "CONSENSUS", description: "Expectations and revisions" },
  { id: "scenarios", label: "SCENARIOS", description: "Stress assumptions and outcomes" },
  { id: "decisions", label: "DECISIONS", description: "Challenge, approve and receipt" },
  { id: "monitor", label: "MONITOR", description: "Watch what changes" },
];

export const ENTITY_CAPABILITIES: EntityCapability[] = [
  { id: "overview", label: "Company Overview", description: "Business profile, current price, peers, key facts and next actions.", group: "overview", view: "entity" },
  { id: "chart", label: "Interactive Chart", description: "Price, volume, performance and technical context.", group: "markets", view: "chart" },
  { id: "options", label: "Options & Volatility", description: "Options chain, Greeks and volatility context.", group: "markets", view: "options", status: "requires_data" },
  { id: "company", label: "Company Fundamentals", description: "Company profile, sector and operating identity.", group: "business", view: "companyfundamentals" },
  { id: "peers", label: "Peer Comparison", description: "Compare valuation and operating metrics with relevant peers.", group: "business", view: "peercomp", status: "requires_data" },
  { id: "statements", label: "Financial Statements", description: "Income statement, balance sheet and cash flow history.", group: "financials", view: "financialstatements", status: "requires_data" },
  { id: "dcf", label: "DCF / FCF Worksheet", description: "Build a transparent ten-year intrinsic value model.", group: "valuation", view: "valuation", actionLabel: "RUN DCF" },
  { id: "reverse-dcf", label: "Reverse DCF", description: "Calculate the growth and margin expectations implied by price.", group: "valuation", view: "decisionengine", status: "requires_data", actionLabel: "REVERSE DCF" },
  { id: "ddm", label: "Dividend Discount", description: "Value dividend-paying companies using explicit growth assumptions.", group: "valuation", view: "valuation", status: "requires_data" },
  { id: "quality", label: "Earnings Quality", description: "Altman, Piotroski, Beneish, Ohlson and market-implied checks.", group: "risk", view: "valuation", status: "requires_data" },
  { id: "risk", label: "Risk & Stress", description: "Volatility, drawdown, macro sensitivity and stress scenarios.", group: "risk", view: "advancedrisk", status: "requires_data" },
  { id: "filings", label: "Filings & Evidence", description: "Official filings, source quality, citations and timeline.", group: "research", view: "filingintel", status: "requires_data" },
  { id: "news", label: "News & Narrative", description: "Recent news with source and freshness context.", group: "research", view: "news" },
  { id: "consensus", label: "Analyst Consensus", description: "Estimates, revisions, dispersion, guidance and surprise.", group: "consensus", view: "consensus", status: "requires_data" },
  { id: "scenarios", label: "Bull / Base / Bear", description: "Compare explicit assumptions and decision outcomes.", group: "scenarios", view: "decisionengine", status: "requires_data" },
  { id: "challenge", label: "Kill My Thesis", description: "Surface contradictions and conditions that would invalidate the thesis.", group: "decisions", view: "decisionengine", status: "requires_data" },
  { id: "investigate", label: "One-Click Investigation", description: "Assemble evidence, models and challenge into a governed investigation.", group: "decisions", view: "brain", status: "requires_data", actionLabel: "INVESTIGATE" },
  { id: "monitor", label: "Thesis Monitor", description: "Track price, macro and evidence triggers for this entity.", group: "monitor", view: "alerts", status: "requires_data", actionLabel: "MONITOR" },
];

export function capabilitiesForEntity(): EntityCapability[] {
  return ENTITY_CAPABILITIES.map((capability) => ({ ...capability, status: capability.status ?? "available" }));
}
