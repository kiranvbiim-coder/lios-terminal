export type ViewMode =
  | "missioncontrol"
  | "entity"
  | "market"
  | "quote"
  | "chart"
  | "news"
  | "agent"
  | "artifact"
  | "screener"
  | "watchlist"
  | "alerts"
  | "economics"
  | "econpolicyquant"
  | "supplychainquant"
  | "environmentquant"
  | "portfolio"
  | "personalfinance"
  | "montecarlo"
  | "correlation"
  | "options"
  | "forex"
  | "heatmap"
  | "earnings"
  | "ising"
  | "optimizer"
  | "valuation"
  | "fixedincome"
  | "fractal"
  | "risknetwork"
  | "filingintel"
  | "quantum"
  | "hawkes"
  | "entropy"
  | "flow"
  | "macrostress"
  | "sentiment"
  | "yieldcurve"
  | "peercomp"
  | "ecalendar"
  | "crossasset"
  | "scanner"
  | "morningbrief"
  | "sectorrotation"
  | "riskcalc"
  | "portfoliostress"
  | "dividends"
  | "shortinterest"
  | "regime"
  | "cryptochain"
  | "tradeideas"
  | "backtesting"
  | "mnadesk"
  | "integration"
  | "fpa"
  | "optionsflow"
  | "insiders"
  | "developer"
  | "adminconsole"
  | "consultinginbox"
  | "publishdesk"
  | "cotpositioning"
  | "globalindicators"
  | "companyfundamentals"
  | "financialstatements"
  | "globaldevelopment"
  | "globalclimate"
  | "datastats"
  | "assetpricing"
  | "advancedrisk"
  | "quantworkbench"
  | "quantregistry"
  | "quantlab"
  | "integratedmodel"
  | "marketdatafabric"
  | "economicdatafabric"
  | "universefabric"
  | "crossassetfabric"
  | "enginereadiness"
  | "connectors"
  | "conflictdetector"
  | "portfolioattribution"
  | "riskreturn"
  | "marketbreadth"
  | "indicatorexplorer"
  | "macrodashboard"
  | "indicatorworkbench"
  | "econsignals"
  | "supplychainindicators"
  | "supplychaindashboard"
  | "environmentindicators"
  | "environmentdashboard"
  | "carbonintensity"
  | "mediaindicators"
  | "mediadashboard"
  | "tourismindicators"
  | "tourismdashboard"
  | "uide"
  | "coveragemap"
  | "workspaces"
  | "spreadsheet"
  | "advisory"
  | "activity"
  | "shillercape"
  | "crossdomainfusion"
  | "decisionmemory"
  | "qualitygate"
  | "clientdata"
  | "research"
  | "consensus"
  | "brain"
  | "decisionengine"
  | "environment";

export type PaneId = "primary" | "secondary" | "tertiary" | "quaternary";

/** Navigation references only; P4 remains the Artifact/revision authority. */
export interface ArtifactWorkbenchContext {
  projectId: number;
  chatId: number;
  artifactId: string;
  version: number;
}

export interface PaneState {
  view: ViewMode;
  symbol: string;
  artifact?: ArtifactWorkbenchContext;
}

/**
 * Tertiary/quaternary are optional for backwards compatibility with workspace
 * state persisted before professional 3/4-pane layouts existed.
 */
export interface WorkspaceState {
  primary: PaneState;
  secondary: PaneState | null;
  tertiary?: PaneState | null;
  quaternary?: PaneState | null;
  focusedPane: PaneId;
}
