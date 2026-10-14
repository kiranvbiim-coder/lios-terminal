export type VisualIntensity = "immersive" | "contextual" | "focus";
export type VisualSemanticContext =
  | "general"
  | "company"
  | "markets"
  | "valuation"
  | "portfolio"
  | "risk"
  | "quant"
  | "research"
  | "macro"
  | "personal-finance";

export const VISUAL_ENVIRONMENT_IDS = [
  "neutral",
  "global-intelligence",
  "company-intelligence",
  "markets",
  "valuation",
  "portfolio-risk",
  "quant-strategy",
  "research-knowledge",
  "personal-finance",
  "economic-intelligence",
] as const;

export type VisualEnvironmentId = typeof VISUAL_ENVIRONMENT_IDS[number];

export interface VisualEnvironmentDescriptor {
  id: VisualEnvironmentId;
  name: string;
  assetPath: string;
  lowResourceAssetPath: string;
  contexts: VisualSemanticContext[];
  accent: "amber" | "indigo" | "cyan" | "neutral";
  altDescription: string;
}

export const VISUAL_ENVIRONMENTS: VisualEnvironmentDescriptor[] = [
  {
    id: "neutral",
    name: "LiOS Intelligence",
    assetPath: "/visual-environments/neutral.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/neutral.svg",
    contexts: ["general"],
    accent: "amber",
    altDescription: "Dark LiOS architectural intelligence environment.",
  },
  {
    id: "global-intelligence",
    name: "Global Intelligence",
    assetPath: "/visual-environments/global-intelligence.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/global-intelligence.svg",
    contexts: ["general", "macro"],
    accent: "cyan",
    altDescription: "Dark global intelligence horizon with restrained network flows.",
  },
  {
    id: "company-intelligence",
    name: "Company Intelligence",
    assetPath: "/visual-environments/company-intelligence.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/company-intelligence.svg",
    contexts: ["company", "research"],
    accent: "amber",
    altDescription: "Structured dark corporate intelligence architecture.",
  },
  {
    id: "markets",
    name: "Markets",
    assetPath: "/visual-environments/markets.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/markets.svg",
    contexts: ["markets"],
    accent: "cyan",
    altDescription: "Dark flowing market terrain with restrained analytical rhythm.",
  },
  {
    id: "valuation",
    name: "Valuation & Modeling",
    assetPath: "/visual-environments/valuation.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/valuation.svg",
    contexts: ["valuation"],
    accent: "indigo",
    altDescription: "Dark layered valuation geometry and scenario pathways.",
  },
  {
    id: "portfolio-risk",
    name: "Portfolio & Risk",
    assetPath: "/visual-environments/portfolio-risk.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/portfolio-risk.svg",
    contexts: ["portfolio", "risk"],
    accent: "amber",
    altDescription: "Dark topographic portfolio and risk surface.",
  },
  {
    id: "quant-strategy",
    name: "Quant & Strategy",
    assetPath: "/visual-environments/quant-strategy.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/quant-strategy.svg",
    contexts: ["quant"],
    accent: "indigo",
    altDescription: "Dark computational signal topology for quantitative work.",
  },
  {
    id: "research-knowledge",
    name: "Research & Knowledge",
    assetPath: "/visual-environments/research-knowledge.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/research-knowledge.svg",
    contexts: ["research"],
    accent: "cyan",
    altDescription: "Dark evidence network and research knowledge environment.",
  },
  {
    id: "personal-finance",
    name: "Personal Finance & Wealth",
    assetPath: "/visual-environments/personal-finance.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/personal-finance.svg",
    contexts: ["personal-finance"],
    accent: "amber",
    altDescription: "Calm dark long-horizon wealth planning environment.",
  },
  {
    id: "economic-intelligence",
    name: "Economic Intelligence",
    assetPath: "/visual-environments/economic-intelligence.svg",
    lowResourceAssetPath: "/visual-environments/low-resource/economic-intelligence.svg",
    contexts: ["macro"],
    accent: "indigo",
    altDescription: "Dark macroeconomic contours across time and geography.",
  },
];

export interface VisualContextDetail {
  projectId: string | null;
  projectName?: string | null;
  intensity: VisualIntensity;
  semanticContext: VisualSemanticContext;
}

export interface PersistedVisualEnvironmentState {
  projectId: string | null;
  environmentId: VisualEnvironmentId;
  intensity: VisualIntensity;
  semanticContext: VisualSemanticContext;
}

export const VISUAL_CONTEXT_EVENT = "lios:visual-context";
export const VISUAL_ENVIRONMENT_CHANGED_EVENT = "lios:visual-environment-changed";
const PROJECT_PIN_STORAGE_KEY = "lios-visual-environment-project-pins-v1";
const RUNTIME_STORAGE_KEY = "lios-visual-environment-runtime-v1";

function isEnvironmentId(value: unknown): value is VisualEnvironmentId {
  return typeof value === "string" && (VISUAL_ENVIRONMENT_IDS as readonly string[]).includes(value);
}

function isIntensity(value: unknown): value is VisualIntensity {
  return value === "immersive" || value === "contextual" || value === "focus";
}

function isSemanticContext(value: unknown): value is VisualSemanticContext {
  return [
    "general", "company", "markets", "valuation", "portfolio", "risk",
    "quant", "research", "macro", "personal-finance",
  ].includes(String(value));
}

function readPins(): Record<string, VisualEnvironmentId> {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_PIN_STORAGE_KEY) || "{}") as Record<string, unknown>;
    return Object.fromEntries(Object.entries(parsed).filter(([, value]) => isEnvironmentId(value))) as Record<string, VisualEnvironmentId>;
  } catch {
    return {};
  }
}

export function getProjectVisualEnvironmentPin(projectId: string | number | null | undefined): VisualEnvironmentId | null {
  if (projectId === null || projectId === undefined) return null;
  return readPins()[String(projectId)] ?? null;
}

export function setProjectVisualEnvironmentPin(
  projectId: string | number,
  environmentId: VisualEnvironmentId | null,
): void {
  if (typeof window === "undefined") return;
  const pins = readPins();
  const key = String(projectId);
  if (environmentId) {
    pins[key] = environmentId;
  } else {
    delete pins[key];
    try {
      const runtime = JSON.parse(localStorage.getItem(RUNTIME_STORAGE_KEY) || "null") as PersistedVisualEnvironmentState | null;
      if (runtime?.projectId === key) localStorage.removeItem(RUNTIME_STORAGE_KEY);
    } catch {
      localStorage.removeItem(RUNTIME_STORAGE_KEY);
    }
  }
  localStorage.setItem(PROJECT_PIN_STORAGE_KEY, JSON.stringify(pins));
  window.dispatchEvent(new CustomEvent(VISUAL_ENVIRONMENT_CHANGED_EVENT, {
    detail: { projectId: key, environmentId },
  }));
}

export function inferVisualSemanticContext(view?: string | null): VisualSemanticContext {
  const normalized = (view || "").toLowerCase();
  if (["valuation", "peercomp", "financialstatements", "companyfundamentals", "integratedmodel", "spreadsheet"].includes(normalized)) return "valuation";
  if (["portfolio", "portfolioattribution", "riskreturn", "advancedrisk", "riskcalc", "portfoliostress", "correlation"].includes(normalized)) return normalized.includes("portfolio") ? "portfolio" : "risk";
  if (["quantworkbench", "backtesting", "montecarlo", "optimizer", "quantlab", "quantregistry", "regime", "assetpricing"].includes(normalized)) return "quant";
  if (["research", "filingintel", "news", "morningbrief", "consensus"].includes(normalized)) return "research";
  if (["economics", "macrodashboard", "econsignals", "econpolicyquant", "yieldcurve", "ecalendar", "globalindicators"].includes(normalized)) return "macro";
  if (["market", "quote", "chart", "heatmap", "scanner", "options", "optionsflow", "forex", "crossasset", "marketbreadth", "sectorrotation"].includes(normalized)) return "markets";
  if (["entity", "earnings", "dividends", "shortinterest", "insiders", "mnadesk"].includes(normalized)) return "company";
  if (["advisory", "clientdata"].includes(normalized)) return "personal-finance";
  return "general";
}

export function inferVisualSemanticContextFromText(
  text: string,
  fallback: VisualSemanticContext = "general",
): VisualSemanticContext {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return fallback;
  if (/\b(dcf|valuation|value|wacc|terminal value|comps?|multiples?|financial model|modeling)\b/.test(normalized)) return "valuation";
  if (/\b(portfolio|allocation|holdings?|rebalance|diversification|asset allocation)\b/.test(normalized)) return "portfolio";
  if (/\b(risk|var|value at risk|stress test|drawdown|downside|correlation)\b/.test(normalized)) return "risk";
  if (/\b(backtest|quant|strategy|signal|factor|alpha|monte carlo|optimization)\b/.test(normalized)) return "quant";
  if (/\b(inflation|gdp|rates?|yield curve|macro|economy|economic|central bank|fx)\b/.test(normalized)) return "macro";
  if (/\b(personal finance|wealth|retirement|budget|cash flow|net worth|debt|loan|financial goals?)\b/.test(normalized)) return "personal-finance";
  if (/\b(research|filing|transcript|earnings|thesis|company|fundamentals?|10-k|10-q|annual report)\b/.test(normalized)) return "research";
  if (/\b(markets?|price|chart|trading|volume|options?|sector|screen|screener|quote)\b/.test(normalized)) return "markets";
  return fallback;
}

export function defaultEnvironmentForContext(context: VisualSemanticContext): VisualEnvironmentId {
  switch (context) {
    case "company": return "company-intelligence";
    case "markets": return "markets";
    case "valuation": return "valuation";
    case "portfolio":
    case "risk": return "portfolio-risk";
    case "quant": return "quant-strategy";
    case "research": return "research-knowledge";
    case "macro": return "economic-intelligence";
    case "personal-finance": return "personal-finance";
    default: return "neutral";
  }
}

export function resolveVisualEnvironment(input: {
  projectId?: string | number | null;
  semanticContext: VisualSemanticContext;
  explicitEnvironmentId?: VisualEnvironmentId | null;
}): VisualEnvironmentId {
  if (input.explicitEnvironmentId) return input.explicitEnvironmentId;
  const projectId = input.projectId === null || input.projectId === undefined ? null : String(input.projectId);
  const pinned = getProjectVisualEnvironmentPin(projectId);
  if (pinned) return pinned;
  const previous = loadVisualEnvironmentRuntimeState();
  if (projectId && previous?.projectId === projectId) return previous.environmentId;
  return defaultEnvironmentForContext(input.semanticContext);
}

export function getVisualEnvironment(id: VisualEnvironmentId): VisualEnvironmentDescriptor {
  return VISUAL_ENVIRONMENTS.find((environment) => environment.id === id) ?? VISUAL_ENVIRONMENTS[0]!;
}

export function dispatchVisualContext(detail: VisualContextDetail): void {
  if (typeof window === "undefined") return;
  const normalized: VisualContextDetail = {
    projectId: detail.projectId ? String(detail.projectId) : null,
    projectName: detail.projectName ?? null,
    intensity: isIntensity(detail.intensity) ? detail.intensity : "contextual",
    semanticContext: isSemanticContext(detail.semanticContext) ? detail.semanticContext : "general",
  };
  const pinned = getProjectVisualEnvironmentPin(normalized.projectId);
  const previous = loadVisualEnvironmentRuntimeState();
  const allowInitialSemanticTransition = Boolean(
    normalized.projectId
      && previous?.projectId === normalized.projectId
      && previous.intensity === "immersive"
      && previous.semanticContext === "general"
      && normalized.semanticContext !== "general",
  );
  const environmentId = pinned
    ?? (normalized.projectId && previous?.projectId === normalized.projectId && !allowInitialSemanticTransition ? previous.environmentId : null)
    ?? defaultEnvironmentForContext(normalized.semanticContext);
  const runtime: PersistedVisualEnvironmentState = {
    projectId: normalized.projectId,
    environmentId,
    intensity: normalized.intensity,
    semanticContext: normalized.semanticContext,
  };
  localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(runtime));
  window.dispatchEvent(new CustomEvent(VISUAL_CONTEXT_EVENT, { detail: normalized }));
}

export function loadVisualEnvironmentRuntimeState(): PersistedVisualEnvironmentState | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(localStorage.getItem(RUNTIME_STORAGE_KEY) || "null") as Partial<PersistedVisualEnvironmentState> | null;
    if (!value || !isEnvironmentId(value.environmentId) || !isIntensity(value.intensity) || !isSemanticContext(value.semanticContext)) return null;
    return {
      projectId: typeof value.projectId === "string" ? value.projectId : null,
      environmentId: value.environmentId,
      intensity: value.intensity,
      semanticContext: value.semanticContext,
    };
  } catch {
    return null;
  }
}

export function captureVisualEnvironmentState(): PersistedVisualEnvironmentState | null {
  return loadVisualEnvironmentRuntimeState();
}

export function restoreVisualEnvironmentState(value: unknown): boolean {
  if (typeof window === "undefined" || !value || typeof value !== "object") return false;
  const candidate = value as Partial<PersistedVisualEnvironmentState>;
  if (!isEnvironmentId(candidate.environmentId) || !isIntensity(candidate.intensity) || !isSemanticContext(candidate.semanticContext)) return false;
  const restored: PersistedVisualEnvironmentState = {
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : null,
    environmentId: candidate.environmentId,
    intensity: candidate.intensity,
    semanticContext: candidate.semanticContext,
  };
  localStorage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(restored));
  window.dispatchEvent(new CustomEvent(VISUAL_ENVIRONMENT_CHANGED_EVENT, {
    detail: { projectId: restored.projectId, environmentId: restored.environmentId, restored: true },
  }));
  window.dispatchEvent(new CustomEvent(VISUAL_CONTEXT_EVENT, {
    detail: {
      projectId: restored.projectId,
      intensity: restored.intensity,
      semanticContext: restored.semanticContext,
    } satisfies VisualContextDetail,
  }));
  return true;
}
