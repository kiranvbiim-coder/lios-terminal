import type { ViewMode } from "./terminalTypes";

export interface CrossDomainBridge {
  id: string;
  label: string;
  from: readonly ViewMode[];
  to: ViewMode;
  domain: string;
  reason: string;
  symbolAware: boolean;
}

const BRIDGES: readonly CrossDomainBridge[] = [
  { id: "company-macro", label: "Macro sensitivity", from: ["entity", "financialstatements", "valuation", "peercomp"], to: "macrodashboard", domain: "Economics & Policy", reason: "Check rates, inflation, growth and regime variables that may change the company case.", symbolAware: false },
  { id: "company-fx", label: "FX exposure", from: ["entity", "financialstatements", "valuation"], to: "forex", domain: "Macro & FX", reason: "Inspect currency conditions that can alter translated revenue, costs or valuation.", symbolAware: false },
  { id: "company-climate", label: "Climate exposure", from: ["entity", "advancedrisk", "valuation"], to: "globalclimate", domain: "Climate", reason: "Inspect physical and transition context when climate factors can affect cash flows or risk.", symbolAware: false },
  { id: "company-supply", label: "Supply-chain exposure", from: ["entity", "financialstatements", "advancedrisk"], to: "supplychaindashboard", domain: "Supply Chain", reason: "Check freight, capacity and logistics context around operational risk.", symbolAware: false },
  { id: "portfolio-macro", label: "Portfolio macro regime", from: ["portfolio", "portfoliostress", "portfolioattribution"], to: "regime", domain: "Macro", reason: "Connect portfolio exposures to the prevailing market regime.", symbolAware: false },
  { id: "macro-market", label: "Cross-asset transmission", from: ["macrodashboard", "econpolicyquant", "econsignals"], to: "crossasset", domain: "Markets", reason: "Trace macro and policy changes into equities, rates, FX and commodities.", symbolAware: false },
  { id: "tourism-macro", label: "Tourism macro context", from: ["tourismdashboard", "tourismindicators"], to: "macrodashboard", domain: "Economics", reason: "Connect tourism demand to growth, inflation, FX and labor conditions.", symbolAware: false },
  { id: "supply-climate", label: "Climate logistics risk", from: ["supplychaindashboard", "supplychainquant"], to: "environmentdashboard", domain: "Sustainability", reason: "Connect network and logistics assumptions to environmental constraints and transition risk.", symbolAware: false },
  { id: "media-company", label: "Narrative vs fundamentals", from: ["mediadashboard", "mediaindicators", "sentiment"], to: "companyfundamentals", domain: "Finance", reason: "Challenge narrative signals against reported company fundamentals.", symbolAware: true },
];

export function getCrossDomainBridges(view: ViewMode): CrossDomainBridge[] {
  return BRIDGES.filter((bridge) => bridge.from.includes(view));
}
