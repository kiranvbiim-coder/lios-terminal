import type { ViewMode } from "./terminalTypes";

export type WorkspaceAudience = "internal" | "client" | "trial";

export type WorkspaceKey =
  | "home"
  | "data"
  | "finance"
  | "modeling"
  | "research"
  | "intelligence"
  | "outputs"
  | "advanced"
  | "settings";

export interface WorkspaceDefinition {
  key: WorkspaceKey;
  label: string;
  shortLabel: string;
  description: string;
  entryView: ViewMode;
  views: readonly ViewMode[];
}

const WORKSPACE_VIEWS: Record<WorkspaceKey, readonly ViewMode[]> = {
  home: ["missioncontrol"],
  data: [
    "coveragemap", "clientdata", "datastats", "marketdatafabric", "economicdatafabric",
    "universefabric", "crossassetfabric", "enginereadiness", "connectors",
  ],
  finance: [
    "market", "quote", "chart", "peercomp", "companyfundamentals", "financialstatements",
    "dividends", "economics", "forex", "crossasset", "cryptochain", "yieldcurve", "portfolio", "personalfinance",
    "macrodashboard", "heatmap", "marketbreadth", "sectorrotation", "shortinterest", "regime",
  ],
  modeling: [
    "valuation", "montecarlo", "options", "fixedincome", "optimizer", "correlation", "risknetwork",
    "fractal", "ising", "quantum", "hawkes", "entropy", "flow", "assetpricing", "quantworkbench",
    "riskreturn", "shillercape", "indicatorworkbench", "econsignals", "econpolicyquant",
    "environmentquant", "supplychainquant", "riskcalc", "portfoliostress", "portfolioattribution",
    "quantlab", "quantregistry", "integratedmodel", "backtesting",
  ],
  research: [
    "screener", "scanner", "news", "earnings", "watchlist", "ecalendar", "globalindicators",
    "indicatorexplorer", "globaldevelopment", "insiders", "optionsflow", "cotpositioning",
    "sentiment", "research", "consensus", "agent", "tradeideas", "morningbrief", "filingintel",
  ],
  intelligence: [
    "entity", "brain", "decisionengine", "qualitygate", "alerts", "activity", "macrostress",
    "decisionmemory", "crossdomainfusion", "supplychaindashboard",
    "supplychainindicators", "environmentdashboard", "environmentindicators", "globalclimate",
    "carbonintensity", "mediadashboard", "mediaindicators", "tourismdashboard", "tourismindicators",
    "conflictdetector",
  ],
  outputs: [
    "workspaces", "spreadsheet", "mnadesk", "integration", "fpa", "publishdesk", "advisory",
    "consultinginbox",
  ],
  advanced: [
    "advancedrisk", "uide", "developer", "adminconsole",
  ],
  settings: ["environment"],
};

export const PRIMARY_WORKSPACES: readonly WorkspaceDefinition[] = [
  { key: "home", label: "Home", shortLabel: "HOME", description: "Resume role-aware work and saved contexts.", entryView: "missioncontrol", views: WORKSPACE_VIEWS.home },
  { key: "data", label: "Data", shortLabel: "DATA", description: "Connect, govern, and inspect source data.", entryView: "coveragemap", views: WORKSPACE_VIEWS.data },
  { key: "finance", label: "Finance", shortLabel: "FIN", description: "Understand markets and financial entities.", entryView: "market", views: WORKSPACE_VIEWS.finance },
  { key: "modeling", label: "Modeling", shortLabel: "MODEL", description: "Calculate, value, compare, and stress-test.", entryView: "valuation", views: WORKSPACE_VIEWS.modeling },
  { key: "research", label: "Research", shortLabel: "FIND", description: "Investigate companies, markets, and evidence.", entryView: "news", views: WORKSPACE_VIEWS.research },
  { key: "intelligence", label: "Intelligence", shortLabel: "INTEL", description: "Synthesize signals into auditable decisions.", entryView: "entity", views: WORKSPACE_VIEWS.intelligence },
  { key: "outputs", label: "Outputs", shortLabel: "SEND", description: "Turn analysis into decision-ready work.", entryView: "mnadesk", views: WORKSPACE_VIEWS.outputs },
  { key: "advanced", label: "Advanced", shortLabel: "ADV", description: "Open specialist and internal operating tools.", entryView: "advancedrisk", views: WORKSPACE_VIEWS.advanced },
  { key: "settings", label: "Settings", shortLabel: "SET", description: "Manage preferences, providers, and environment.", entryView: "environment", views: WORKSPACE_VIEWS.settings },
];

const REGISTERED_VIEWS = new Set<ViewMode>(
  [...PRIMARY_WORKSPACES.flatMap((workspace) => workspace.views), "artifact"],
);

export function isRegisteredView(value: string): value is ViewMode {
  return REGISTERED_VIEWS.has(value as ViewMode);
}

const CLIENT_ONLY_VIEWS = new Set<ViewMode>([
  "advisory", "activity", "crossdomainfusion", "decisionmemory", "clientdata",
]);

const INTERNAL_ONLY_VIEWS = new Set<ViewMode>([
  "developer", "adminconsole", "consultinginbox", "publishdesk", "uide", "qualitygate",
  "research", "consensus", "brain", "decisionengine", "quantregistry", "quantlab",
  "integratedmodel", "marketdatafabric", "economicdatafabric", "universefabric",
  "crossassetfabric", "conflictdetector",
]);

const NOT_YET_PORTED_VIEWS = new Set<ViewMode>(["workspaces", "spreadsheet"]);


const TRIAL_UNAVAILABLE_VIEWS = new Set<ViewMode>([
  "advisory", "activity", "crossdomainfusion", "decisionmemory", "clientdata",
]);

const LEGACY_WORKSPACE_KEYS: Readonly<Record<string, WorkspaceKey>> = {
  discover: "research",
  analyze: "intelligence",
  model: "modeling",
  decide: "intelligence",
  deliver: "outputs",
  monitor: "intelligence",
  platform: "advanced",
};

export function isViewVisibleToAudience(
  view: ViewMode,
  audience: WorkspaceAudience,
): boolean {
  if (audience === "internal") return !CLIENT_ONLY_VIEWS.has(view);
  if (INTERNAL_ONLY_VIEWS.has(view) || NOT_YET_PORTED_VIEWS.has(view)) return false;
  if (audience === "client") return true;
  return !CLIENT_ONLY_VIEWS.has(view) && !TRIAL_UNAVAILABLE_VIEWS.has(view);
}

export function getVisibleViewsForWorkspace(
  workspaceKey: WorkspaceKey,
  audience: WorkspaceAudience,
): readonly ViewMode[] {
  return WORKSPACE_VIEWS[workspaceKey].filter((view) => isViewVisibleToAudience(view, audience));
}

export function getWorkspaceForView(view: ViewMode): WorkspaceKey {
  if (view === "artifact") return "outputs"; // Context-only: registered for exact Chat handoff, never a blank launch.
  return PRIMARY_WORKSPACES.find((workspace) => workspace.views.includes(view))?.key ?? "research";
}

export function getWorkspaceDefinition(key: WorkspaceKey): WorkspaceDefinition {
  return PRIMARY_WORKSPACES.find((workspace) => workspace.key === key) ?? PRIMARY_WORKSPACES[0];
}

export function isViewInWorkspace(view: ViewMode, key: WorkspaceKey): boolean {
  return getWorkspaceForView(view) === key;
}

export function getVisibleWorkspaces(
  audience: WorkspaceAudience | boolean,
): readonly WorkspaceDefinition[] {
  const resolvedAudience = typeof audience === "boolean"
    ? audience ? "internal" : "client"
    : audience;
  return PRIMARY_WORKSPACES.flatMap((workspace) => {
    const views = getVisibleViewsForWorkspace(workspace.key, resolvedAudience);
    if (views.length === 0) return [];
    const entryView = views.includes(workspace.entryView) ? workspace.entryView : views[0];
    return [{ ...workspace, entryView, views }];
  });
}

export function resolveWorkspaceKey(value: string): WorkspaceKey | null {
  const key = value.toLowerCase();
  return PRIMARY_WORKSPACES.some((workspace) => workspace.key === key)
    ? key as WorkspaceKey
    : LEGACY_WORKSPACE_KEYS[key] ?? null;
}
