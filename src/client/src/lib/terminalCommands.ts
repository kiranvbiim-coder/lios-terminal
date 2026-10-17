import type { ViewMode } from "./terminalTypes";
import type { WorkSearchResult } from "@shared/workSearch";

export type CanonicalNavigationTarget = "conversation" | "projects" | "chats" | "library" | "automations" | "plugins" | "connections" | "doctor" | "search";

// These are destinations in the existing shell, not analytical functions or tools.
export const CANONICAL_NAVIGATION = [
  { target: "conversation", label: "Conversation", aliases: ["conversation", "back to conversation"], description: "Return to the selected conversation without sending a message." },
  { target: "projects", label: "Projects", aliases: ["projects", "project"], description: "Browse your accessible Projects; no Project is created." },
  { target: "chats", label: "Chats & history", aliases: ["chats", "chat", "history", "chat history"], description: "Browse your saved conversations." },
  { target: "search", label: "Search saved work", aliases: ["search", "saved work", "search saved work", "files"], description: "Search your permitted Projects, Chats, exact Artifacts and Project files using existing work search." },
  { target: "library", label: "Library · saved Artifacts", aliases: ["library", "artifacts", "saved artifacts", "saved reports"], description: "Open the selected Project's saved Artifacts and files; choose a Project if none is selected." },
  { target: "automations", label: "Project Automations", aliases: ["automations", "automation", "workflows"], description: "Open the selected Project's Automations. Opening does not run a workflow." },
  { target: "plugins", label: "Governed extensions", aliases: ["plugins", "extensions"], description: "Inspect supported extension configuration; no marketplace availability is implied." },
  { target: "connections", label: "Connections & AI", aliases: ["connections", "connection", "connectors", "ai", "connections & ai", "connections and ai", "ai settings"], description: "Open existing Connection Center; configuration and repair remain subject to your account access." },
  { target: "doctor", label: "Doctor · runtime inspection", aliases: ["doctor", "lios doctor", "runtime doctor"], description: "Open Connection Center for runtime inspection. Does not send a diagnosis message or run a repair." },
] as const satisfies readonly { target: CanonicalNavigationTarget; label: string; aliases: readonly string[]; description: string }[];

export function parseCanonicalNavigation(input: string): CanonicalNavigationTarget | null {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, " ").replace(/^(?:open|go to|show)\s+/, "");
  return CANONICAL_NAVIGATION.find((entry) => (entry.aliases as readonly string[]).includes(normalized))?.target ?? null;
}

export function searchCanonicalNavigation(input: string) {
  const normalized = input.trim().toLowerCase();
  const exact = parseCanonicalNavigation(input);
  return CANONICAL_NAVIGATION.filter((entry) => !normalized || entry.target === exact || [entry.label, ...entry.aliases].some((term) => term.toLowerCase().includes(normalized)));
}

export interface ParsedTerminalCommand {
  raw: string;
  symbol?: string;
  view: ViewMode;
  navigation?: CanonicalNavigationTarget;
}

export function dispatchCanonicalNavigation(
  target: CanonicalNavigationTarget,
  actions: { openConnections: () => void; openProjectSection: (section: Exclude<CanonicalNavigationTarget, "connections" | "doctor">) => void },
): void {
  if (target === "connections" || target === "doctor") actions.openConnections();
  else actions.openProjectSection(target);
}

export function resolveWorkSearchLibraryTarget(result: WorkSearchResult): { projectId: number; artifactId: string | null; resourceId: string | null } | null {
  if (!result.projectId) return null;
  if (result.kind === "artifact" && result.artifactId) return { projectId: result.projectId, artifactId: result.artifactId, resourceId: null };
  if (result.kind === "file" && result.resourceId) return { projectId: result.projectId, artifactId: null, resourceId: result.resourceId };
  return null;
}

const VIEW_ALIASES: Record<string, ViewMode> = {
  HOME: "missioncontrol",
  MISSION: "missioncontrol",
  COMMAND: "missioncontrol",
  ENTITY: "entity",
  COMPANY: "entity",
  MRKT: "market",
  MARKET: "market",
  DES: "quote",
  QUOTE: "quote",
  GP: "chart",
  CHRT: "chart",
  CHART: "chart",
  NEWS: "news",
  N: "news",
  AI: "agent",
  AGENT: "agent",
  EQS: "screener",
  SCRN: "screener",
  SCREENER: "screener",
  WATCH: "watchlist",
  WLT: "watchlist",
  WATCHLIST: "watchlist",
  ALRT: "alerts",
  MON: "alerts",
  ALERTS: "alerts",
  ECON: "economics",
  ECST: "economics",
  ECONOMICS: "economics",
  PORT: "portfolio",
  PRTU: "portfolio",
  PORTFOLIO: "portfolio",
  MCST: "montecarlo",
  MC: "montecarlo",
  GBM: "montecarlo",
  MONTECARLO: "montecarlo",
  CORR: "correlation",
  CORRELATION: "correlation",
  OPCV: "options",
  OPT: "options",
  OPTIONS: "options",
  BSM: "options",
  ISNG: "ising",
  ISING: "ising",
  OPTZ: "optimizer",
  PORTOPT: "optimizer",
  OPTIMIZER: "optimizer",
  VALU: "valuation",
  VAL: "valuation",
  VALUATION: "valuation",
  DCF: "valuation",
  LBO: "valuation",
  YILD: "fixedincome",
  FI: "fixedincome",
  BOND: "fixedincome",
  CDS: "fixedincome",
  FIXEDINCOME: "fixedincome",
  FRAC: "fractal",
  FRACTAL: "fractal",
  CHAOS: "fractal",
  GARCH: "fractal",
  NET: "risknetwork",
  NETWORK: "risknetwork",
  SPILL: "risknetwork",
  ORDERBOOK: "risknetwork",
  RISKNET: "risknetwork",
  FILG: "filingintel",
  SEC: "filingintel",
  INTEL: "filingintel",
  FILINGINTEL: "filingintel",
  RSRCH: "research",
  RESEARCH: "research",
  INVESTIGATE: "research",
  CONS: "consensus",
  CONSENSUS: "consensus",
  ESTIMATES: "consensus",
  VARIANT: "consensus",
  BRAIN: "brain",
  ONECLICK: "brain",
  ORCHESTRATE: "brain",
  TASKGRAPH: "brain",
  DECIDE: "decisionengine",
  DECISIONENGINE: "decisionengine",
  RECEIPT: "decisionengine",
  KILLTHESIS: "decisionengine",
  REVERSEDCF: "decisionengine",
  QREG: "quantregistry",
  QUANTREGISTRY: "quantregistry",
  MODELREGISTRY: "quantregistry",
  MODELCATALOG: "quantregistry",
  QLAB: "quantlab",
  QUANTLAB: "quantlab",
  EXPERIMENTS: "quantlab",
  QRUNS: "quantlab",
  READINESS: "enginereadiness",
  READY: "enginereadiness",
  ENGINES: "enginereadiness",
  ENGINESTATUS: "enginereadiness",
  CONNECTORS: "connectors",
  CONN: "connectors",
  PROVIDERS: "connectors",
  CONFLICTS: "conflictdetector",
  CONFLICT: "conflictdetector",
  DATACONFLICT: "conflictdetector",
  ENV: "environment",
  SETUP: "environment",
  ENVIRONMENT: "environment",
  DATASOURCES: "environment",
  "3STM": "integratedmodel",
  FINMODEL: "integratedmodel",
  THREESTATEMENT: "integratedmodel",
  INTEGRATEDMODEL: "integratedmodel",
  PITDATA: "marketdatafabric",
  MARKETDATA: "marketdatafabric",
  DATAFABRIC: "marketdatafabric",
  PITMACRO: "economicdatafabric",
  MACRODATA: "economicdatafabric",
  CURVEDATA: "economicdatafabric",
  UNIVERSE: "universefabric",
  PITUNIV: "universefabric",
  DATAENTITLEMENTS: "universefabric",
  COLUMNAR: "universefabric",
  PITXASSET: "crossassetfabric",
  ESTDATA: "crossassetfabric",
  OPTIONDATA: "crossassetfabric",
  COMMODITYDATA: "crossassetfabric",
  PORTFOLIODATA: "crossassetfabric",
  PRIVATESERIES: "crossassetfabric",
  QNTM: "quantum",
  TUNL: "quantum",
  QUANTUM: "quantum",
  HWKS: "hawkes",
  VPIN: "hawkes",
  HAWKES: "hawkes",
  INTR: "entropy",
  ENTR: "entropy",
  ENTROPY: "entropy",
  FLOW: "flow",
  FLOWMAPPED: "flow",
  DEV: "developer",
  DEVELOPER: "developer",
  ADMIN: "adminconsole",
  ADMINCONSOLE: "adminconsole",
  CONSULT: "consultinginbox",
  INBOX: "consultinginbox",
  CONSULTINGINBOX: "consultinginbox",
  PUB: "publishdesk",
  PUBLISHDESK: "publishdesk",
  UIDE: "uide",
  DATAENGINE: "uide",
  WORKSPACE: "workspaces",
  WORKSPACES: "workspaces",
  WSP: "workspaces",
  SPREADSHEET: "spreadsheet",
  XLS: "spreadsheet",
  COVR: "coveragemap",
  COV: "coveragemap",
  COVERAGE: "coveragemap",
  COVERAGEMAP: "coveragemap",
  // FX / Forex
  FX: "forex",
  FOREX: "forex",
  CURR: "forex",
  CURRENCIES: "forex",
  // Heat Map
  HEAT: "heatmap",
  HMAP: "heatmap",
  HEATMAP: "heatmap",
  // Earnings Calendar
  ERN: "earnings",
  EARN: "earnings",
  EARNINGS: "earnings",
  CAL: "earnings",
  // ── Tier-1 New Panels ──────────────────────────────────────────────
  YCRV: "yieldcurve",
  YIELDCURVE: "yieldcurve",
  YCURVE: "yieldcurve",
  CURVE: "yieldcurve",
  SPREAD: "yieldcurve",
  COMP: "peercomp",
  PEER: "peercomp",
  COMPARE: "peercomp",
  PEERCOMP: "peercomp",
  PEERS: "peercomp",
  FINANCIALS: "financialstatements",
  STATEMENTS: "financialstatements",
  ECAL: "ecalendar",
  ECALENDAR: "ecalendar",
  CALENDAR: "ecalendar",
  EVENTS: "ecalendar",
  XMAP: "crossasset",
  CROSS: "crossasset",
  CROSSASSET: "crossasset",
  XASSET: "crossasset",
  SCAN: "scanner",
  SCANNER: "scanner",
  PATTERNS: "scanner",
  BREAKOUT: "scanner",
  // ── Tier-2 New Panels ──────────────────────────────────────────────
  BRIEF: "morningbrief",
  MORNING: "morningbrief",
  MORNINGBRIEF: "morningbrief",
  SUMMARY: "morningbrief",
  ROT: "sectorrotation",
  ROTATION: "sectorrotation",
  SECTOR: "sectorrotation",
  SECTORS: "sectorrotation",
  SECTORROTATION: "sectorrotation",
  RISK: "riskcalc",
  RISKCALC: "riskcalc",
  KELLY: "riskcalc",
  SIZER: "riskcalc",
  POSITION: "riskcalc",
  PSTRS: "portfoliostress",
  PORTFOLIOSTRESS: "portfoliostress",
  PSTRESS: "portfoliostress",
  STRESSPORT: "portfoliostress",
  DIV: "dividends",
  DIVIDENDS: "dividends",
  DIVIDEND: "dividends",
  DIVYIELD: "dividends",
  SHRT: "shortinterest",
  SHORT: "shortinterest",
  SHORTINTEREST: "shortinterest",
  SQUEEZE: "shortinterest",
  REGIME: "regime",
  REGIMECLASSIFIER: "regime",
  MACROREGIME: "regime",
  // ── Tier-3 New Panels ──────────────────────────────────────────────
  CHAIN: "cryptochain",
  CRYPTO: "cryptochain",
  CRYPTOCHAIN: "cryptochain",
  ONCHAIN: "cryptochain",
  MVRV: "cryptochain",
  IDEA: "tradeideas",
  IDEAS: "tradeideas",
  TRADEIDEAS: "tradeideas",
  TRADEIDEA: "tradeideas",
  BKTS: "backtesting",
  BACKTEST: "backtesting",
  BACKTESTING: "backtesting",
  STRATEGY: "backtesting",
  // Sentiment & Stress (existing)
  SENT: "sentiment",
  SENTIMENT: "sentiment",
  FNG: "sentiment",
  STRS: "macrostress",
  STRESS: "macrostress",
  MACROSTRESS: "macrostress",
  // M&A and FP&A new panels
  MNA: "mnadesk",
  DEALS: "mnadesk",
  SYNERGY: "mnadesk",
  PPA: "mnadesk",
  MERGER: "mnadesk",
  INTEG: "integration",
  TRACK: "integration",
  PMI: "integration",
  FPA: "fpa",
  BUDGET: "fpa",
  FCST: "fpa",
  VAR: "fpa",
};


export function getCommandAliasView(token: string | undefined): ViewMode | null {
  if (!token) return null;
  return VIEW_ALIASES[token.toUpperCase()] ?? null;
}

export function parseTerminalCommand(input: string): ParsedTerminalCommand | null {
  const raw = input.trim().toUpperCase().replace(/\s+/g, " ");
  if (!raw) return null;
  const navigation = parseCanonicalNavigation(raw);
  if (navigation) return { raw, view: "missioncontrol", navigation };

  const tokens = raw.split(" ");
  const singleTokenView = getCommandAliasView(tokens[0]);
  if (tokens.length === 1 && singleTokenView) {
    return { raw, view: singleTokenView };
  }

  const [first, second] = tokens;
  const secondView = getCommandAliasView(second);
  if (secondView) {
    return { raw, symbol: first, view: secondView };
  }

  return { raw, symbol: first, view: "quote" };
}
