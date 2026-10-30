import type { DomainSlug } from "./domains";
import {
  TERMINAL_CAPABILITIES,
  isCapabilityVisible,
  type TerminalCapability,
} from "./terminalCatalog";
import type { ViewMode } from "./terminalTypes";

export type ProductNavSectionKey =
  | "home"
  | "finance"
  | "modeling"
  | "research"
  | "intelligence"
  | "outputs"
  | "advanced";

export type PrimaryNavKey =
  | "projects"
  | "pulse"
  | "explore"
  | "workbench"
  | "signals"
  | "library"
  | "data"
  | "settings";

export type ProductNavKey = PrimaryNavKey | ProductNavSectionKey;

// Compatibility registry for legacy/supporting experience surfaces. The authenticated
// product shell is owned by AuthenticatedNavigation (Projects → Chats → Artifacts);
// do not use this list to recreate a second primary sidebar.
export const PRODUCT_NAV_ORDER: readonly PrimaryNavKey[] = [
  "projects",
  "pulse",
  "explore",
  "workbench",
  "signals",
  "library",
  "data",
  "settings",
] as const;

export const PRIMARY_NAV_LABELS: Record<Exclude<PrimaryNavKey, "data" | "settings">, { label: string; description: string }> = {
  projects: { label: "Projects", description: "Persistent chats, sources, sessions and saved analytical work." },
  pulse: { label: "Pulse", description: "What changed, what matters, and what to do next." },
  explore: { label: "Explore", description: "Discover instruments, markets, metrics, and relationships." },
  workbench: { label: "Workbench", description: "Open deterministic analysis tools with progressive disclosure." },
  signals: { label: "Signals", description: "Monitor alerts, scenarios, and the Action Inbox." },
  library: { label: "Library", description: "Return to saved work, evidence, and outputs." },
};

export interface ProductNavigationContext {
  domain: DomainSlug;
  isInternal: boolean;
  isClientBuild: boolean;
  isTrial: boolean;
}

export interface ProductNavSection {
  key: ProductNavSectionKey;
  label: string;
  description: string;
  items: readonly TerminalCapability[];
  entryView: ViewMode | null;
}

const DOMAIN_CAPABILITY: Record<Exclude<DomainSlug, "shared">, TerminalCapability["domain"]> = {
  finance: "finance",
  economics_policy: "macro",
  supply_chain: "supply-chain",
  environment_sustainability: "sustainability",
  marketing_pr: "media",
  tourism_hospitality: "tourism",
};

const DOMAIN_LABEL: Record<DomainSlug, string> = {
  finance: "Finance",
  economics_policy: "Economics",
  supply_chain: "Supply Chain",
  environment_sustainability: "Sustainability",
  marketing_pr: "Media & PR",
  tourism_hospitality: "Tourism",
  shared: "Analysis",
};

const SHARED_VIEWS = new Set<ViewMode>([
  "missioncontrol",
  "uide",
  "workspaces",
  "spreadsheet",
  "developer",
  "adminconsole",
  "consultinginbox",
  "publishdesk",
  "qualitygate",
  "research",
  "consensus",
  "brain",
  "decisionengine",
  "coveragemap",
  "advisory",
  "activity",
  "crossdomainfusion",
  "decisionmemory",
  "clientdata",
  "connectors",
  "enginereadiness",
  "conflictdetector",
]);

const CLIENT_NOT_YET_PORTED = new Set<ViewMode>(["workspaces", "spreadsheet"]);
const TRIAL_CONSULTING_ONLY = new Set<ViewMode>([
  "advisory",
  "activity",
  "crossdomainfusion",
  "decisionmemory",
  "clientdata",
]);

const RESEARCH_VIEWS = new Set<ViewMode>([
  "news",
  "screener",
  "scanner",
  "earnings",
  "peercomp",
  "companyfundamentals",
  "financialstatements",
  "dividends",
  "shortinterest",
  "insiders",
  "optionsflow",
  "cotpositioning",
  "filingintel",
  "research",
  "consensus",
]);

const INTELLIGENCE_VIEWS = new Set<ViewMode>([
  "agent",
  "morningbrief",
  "tradeideas",
  "sentiment",
  "brain",
  "decisionengine",
  "decisionmemory",
  "crossdomainfusion",
]);

const OUTPUT_VIEWS = new Set<ViewMode>([
  "workspaces",
  "spreadsheet",
  "publishdesk",
  "advisory",
  "activity",
  "mnadesk",
  "fpa",
]);

const SECTION_PRIORITY: Partial<Record<ProductNavSectionKey, readonly ViewMode[]>> = {
  home: ["missioncontrol"],
  finance: ["entity", "personalfinance", "market", "companyfundamentals", "financialstatements", "portfolio", "economics"],
  modeling: ["valuation", "integratedmodel", "quantworkbench", "montecarlo", "optimizer", "advancedrisk"],
  research: ["companyfundamentals", "financialstatements", "peercomp", "news", "screener", "earnings", "research"],
  intelligence: ["agent", "morningbrief", "decisionengine", "brain", "sentiment"],
  outputs: ["workspaces", "spreadsheet", "mnadesk", "fpa", "advisory", "publishdesk"],
};

function capabilityMatchesDomain(capability: TerminalCapability, domain: DomainSlug): boolean {
  if (capability.view === "missioncontrol") return true;
  if (SHARED_VIEWS.has(capability.view)) return true;
  if (capability.domain === "platform" || capability.domain === "delivery") return true;
  if (domain === "shared") return true;
  return capability.domain === DOMAIN_CAPABILITY[domain];
}

function capabilityAllowed(capability: TerminalCapability, context: ProductNavigationContext): boolean {
  if (!isCapabilityVisible(capability, context.isInternal)) return false;
  if (context.isClientBuild && CLIENT_NOT_YET_PORTED.has(capability.view)) return false;
  if (context.isTrial && TRIAL_CONSULTING_ONLY.has(capability.view)) return false;
  return capabilityMatchesDomain(capability, context.domain);
}

export function sectionForCapability(capability: TerminalCapability): ProductNavSectionKey {
  if (capability.view === "missioncontrol") return "home";
  if (OUTPUT_VIEWS.has(capability.view) || capability.workspace === "outputs") return "outputs";
  if (INTELLIGENCE_VIEWS.has(capability.view)) return "intelligence";
  if (RESEARCH_VIEWS.has(capability.view)) return "research";
  if (capability.workspace === "modeling") return "modeling";
  if (capability.workspace === "finance") return "finance";
  return "advanced";
}

function sortSectionItems(key: ProductNavSectionKey, items: TerminalCapability[]): TerminalCapability[] {
  const priority = SECTION_PRIORITY[key] ?? [];
  const rank = new Map(priority.map((view, index) => [view, index]));
  return [...items].sort((left, right) => {
    const leftRank = rank.get(left.view);
    const rightRank = rank.get(right.view);
    if (leftRank !== undefined || rightRank !== undefined) {
      return (leftRank ?? Number.MAX_SAFE_INTEGER) - (rightRank ?? Number.MAX_SAFE_INTEGER);
    }
    if (left.hero !== right.hero) return left.hero ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

export function getProductNavigation(context: ProductNavigationContext): readonly ProductNavSection[] {
  const visible = TERMINAL_CAPABILITIES.filter((capability) => capabilityAllowed(capability, context));
  const grouped = new Map<ProductNavSectionKey, TerminalCapability[]>([
    ["home", []],
    ["finance", []],
    ["modeling", []],
    ["research", []],
    ["intelligence", []],
    ["outputs", []],
    ["advanced", []],
  ]);

  for (const capability of visible) {
    grouped.get(sectionForCapability(capability))?.push(capability);
  }

  const definition: Record<ProductNavSectionKey, { label: string; description: string }> = {
    home: { label: "Home", description: "Resume work and launch the next task." },
    finance: { label: DOMAIN_LABEL[context.domain], description: "Analyze markets, companies, portfolios, and domain evidence." },
    modeling: { label: "Modeling", description: "Forecast, value, optimize, and stress assumptions." },
    research: { label: "Research", description: "Investigate companies, filings, peers, and current evidence." },
    intelligence: { label: "Intelligence", description: "Use LIOS intelligence to interpret, challenge, and decide." },
    outputs: { label: "Outputs", description: "Package analysis into models, workspaces, and deliverables." },
    advanced: { label: "Advanced", description: "Open specialist, monitoring, quant, and platform tools." },
  };

  return (["home", "finance", "modeling", "research", "intelligence", "outputs", "advanced"] as const).map((key) => {
    const items = sortSectionItems(key, grouped.get(key) ?? []);
    return {
      key,
      ...definition[key],
      items,
      entryView: items[0]?.view ?? null,
    };
  });
}

export function getProductSectionForView(
  view: ViewMode,
  context: ProductNavigationContext,
): ProductNavSectionKey | null {
  const section = getProductNavigation(context).find((candidate) => candidate.items.some((item) => item.view === view));
  return section?.key ?? null;
}
