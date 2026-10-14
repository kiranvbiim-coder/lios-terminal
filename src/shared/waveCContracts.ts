/**
 * Wave C integration contracts (V4-09, V4-10, V4-11 and V4-23).
 *
 * These contracts intentionally sit above the existing Data Fabric and
 * market-master modules. They provide one stable vocabulary for the new
 * experience shell while preserving the canonical field/engine authorities
 * already used by the terminal and server.
 */
import { getCanonicalField, getUniversalFieldDictionary, type UniversalFieldDescriptor } from "./dataFieldDictionary";
import { FINANCIAL_METRICS, searchFinancialMetrics, type FinancialMetricDefinition, type FinancialMetricUnit } from "./financialMetricRegistry";

// ─── V4-09 Dynamic Analytics ──────────────────────────────────────────────

export type DynamicAnalyticsScope = "global" | "region" | "country" | "exchange";
export type DynamicFilterOperator = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "contains" | "in";

export interface DynamicAnalyticsField {
  id: string;
  label: string;
  kind: "canonical" | "metric" | "extended";
  family: string | null;
  type: string;
  unit: string | null;
  numeric: boolean;
  searchableText: string;
}

export interface AdaptiveCompanySection {
  id: string;
  label: string;
  fields: string[];
  state: "ready" | "partial";
}

export interface DynamicAnalyticsFilter {
  fieldId: string;
  operator: DynamicFilterOperator;
  value: string | number | boolean | string[];
}

export interface ScreenerScope {
  scope: DynamicAnalyticsScope;
  region?: string;
  countryCode?: string;
  exchangeMic?: string;
  primaryListingOnly: boolean;
}

export interface ComparisonPlan {
  metricIds: string[];
  normalizedMetricIds: string[];
  warnings: string[];
}

export function filterPrimaryListings<T extends { isPrimaryListing?: boolean }>(rows: readonly T[], primaryListingOnly: boolean): T[] {
  return primaryListingOnly ? rows.filter((row) => row.isPrimaryListing !== false) : [...rows];
}

const NUMERIC_TYPES = new Set(["number", "integer", "currency_amount", "percentage", "ratio"]);
const NUMERIC_UNITS = new Set<FinancialMetricUnit>([
  "currency", "price", "currency-per-share", "percent", "ratio", "multiple", "days", "turnover", "count", "bps", "yield", "volatility",
]);

function fieldFromCanonical(field: UniversalFieldDescriptor): DynamicAnalyticsField {
  return {
    id: field.id,
    label: field.name,
    kind: field.kind,
    family: field.kind === "canonical" ? field.contractFamily : null,
    type: field.type,
    unit: field.kind === "canonical" ? field.unit ?? null : null,
    numeric: NUMERIC_TYPES.has(field.type),
    searchableText: `${field.id} ${field.name} ${field.description}`.toLowerCase(),
  };
}

function fieldFromMetric(metric: FinancialMetricDefinition): DynamicAnalyticsField {
  return {
    id: `metric.${metric.id}`,
    label: metric.label,
    kind: "metric",
    family: metric.category,
    type: "number",
    unit: metric.unit,
    numeric: NUMERIC_UNITS.has(metric.unit),
    searchableText: `${metric.id} ${metric.label} ${metric.shortLabel ?? ""} ${(metric.aliases ?? []).join(" ")}`.toLowerCase(),
  };
}

export function buildDynamicAnalyticsCatalog(): DynamicAnalyticsField[] {
  const fields = getUniversalFieldDictionary().fields.map(fieldFromCanonical);
  const seen = new Set(fields.map((field) => field.id));
  for (const metric of FINANCIAL_METRICS) {
    const descriptor = fieldFromMetric(metric);
    if (!seen.has(descriptor.id)) fields.push(descriptor);
  }
  return fields;
}

export function searchDynamicAnalyticsCatalog(query: string, limit = 40): DynamicAnalyticsField[] {
  const normalized = query.trim().toLowerCase();
  const catalog = buildDynamicAnalyticsCatalog();
  if (!normalized) return catalog.slice(0, limit);
  return catalog
    .map((field) => ({ field, score: field.searchableText.startsWith(normalized) ? 0 : field.searchableText.includes(normalized) ? 1 : 2 }))
    .filter((item) => item.score < 2)
    .sort((a, b) => a.score - b.score || a.field.label.localeCompare(b.field.label))
    .slice(0, limit)
    .map((item) => item.field);
}

const COMPANY_SECTIONS: readonly { id: string; label: string; candidates: readonly string[] }[] = [
  { id: "identity", label: "Identity & listing", candidates: ["company.ticker", "company.name", "company.exchange", "company.country", "company.sector", "company.industry"] },
  { id: "market", label: "Market snapshot", candidates: ["market_data.price", "market_data.marketCap", "market_data.volume", "metric.beta", "metric.pe", "metric.forwardPE"] },
  { id: "quality", label: "Quality & returns", candidates: ["metric.roic", "metric.roe", "metric.roa", "metric.grossMargin", "metric.ebitdaMargin", "metric.fcfMargin"] },
  { id: "balance-sheet", label: "Balance sheet", candidates: ["financial_statements.cash", "financial_statements.totalAssets", "financial_statements.totalLiabilities", "metric.netDebt", "metric.currentRatio"] },
  { id: "capital-allocation", label: "Capital allocation", candidates: ["metric.dividendYield", "metric.buybackYield", "metric.shareholderYield", "financial_statements.capex"] },
];

export function buildAdaptiveCompanySections(availableFieldIds: readonly string[]): AdaptiveCompanySection[] {
  const available = new Set(availableFieldIds);
  return COMPANY_SECTIONS.map((section) => {
    const fields = section.candidates.filter((id) => available.has(id));
    const state: AdaptiveCompanySection["state"] = fields.length === section.candidates.length ? "ready" : "partial";
    return { id: section.id, label: section.label, fields, state };
  }).filter((section) => section.fields.length > 0);
}

export function validateDynamicFilter(filter: DynamicAnalyticsFilter): { ok: true; field: DynamicAnalyticsField } | { ok: false; error: string } {
  const field = buildDynamicAnalyticsCatalog().find((candidate) => candidate.id === filter.fieldId);
  if (!field) return { ok: false, error: `Unknown analytics field: ${filter.fieldId}` };
  const numericOperator = ["gt", "gte", "lt", "lte"].includes(filter.operator);
  if (numericOperator && !field.numeric) return { ok: false, error: `${filter.operator} requires a numeric field.` };
  if (filter.operator === "in" && !Array.isArray(filter.value)) return { ok: false, error: "The in operator requires an array value." };
  if (filter.operator !== "in" && Array.isArray(filter.value)) return { ok: false, error: `${filter.operator} does not accept an array value.` };
  return { ok: true, field };
}

export function buildComparisonPlan(metricIds: readonly string[]): ComparisonPlan {
  const warnings: string[] = [];
  const normalizedMetricIds: string[] = [];
  for (const id of metricIds) {
    const definition = id.startsWith("metric.") ? getFinancialMetricDefinition(id.slice(7)) : getFinancialMetricDefinition(id);
    if (!definition) { warnings.push(`Unknown metric omitted: ${id}`); continue; }
    if (!normalizedMetricIds.includes(definition.id)) normalizedMetricIds.push(definition.id);
  }
  if (normalizedMetricIds.length < 2) warnings.push("Select at least two known metrics for a comparison.");
  return { metricIds: [...metricIds], normalizedMetricIds, warnings };
}

function getFinancialMetricDefinition(id: string): FinancialMetricDefinition | null {
  return searchFinancialMetrics(id, 1).find((metric) => metric.id === id) ?? FINANCIAL_METRICS.find((metric) => metric.id === id) ?? null;
}

export function buildQuantSeries(fieldId: string): { fieldId: string; label: string; unit: string | null } | null {
  const field = buildDynamicAnalyticsCatalog().find((candidate) => candidate.id === fieldId);
  return field?.numeric ? { fieldId: field.id, label: field.label, unit: field.unit } : null;
}

export const CANONICAL_MIGRATION_ADAPTERS = [
  { domain: "portfolio", contractFamily: "portfolio", status: "adapter" as const, identityRequired: true },
  { domain: "valuation", contractFamily: "financial_statements", status: "adapter" as const, identityRequired: true },
  { domain: "fixed-income", contractFamily: "fixed_income", status: "adapter" as const, identityRequired: true },
  { domain: "derivatives", contractFamily: "derivatives", status: "adapter" as const, identityRequired: true },
  { domain: "macro", contractFamily: "macro", status: "adapter" as const, identityRequired: true },
] as const;

// ─── V4-10 Master AI ──────────────────────────────────────────────────────

export type MasterAiMode = "manual" | "ai_assist" | "ai_build" | "ai_scenario";
export type MasterAiState = "on" | "off";

export const MASTER_AI_MODES: readonly { id: MasterAiMode; label: string; description: string }[] = [
  { id: "manual", label: "Manual", description: "Run deterministic tools directly." },
  { id: "ai_assist", label: "AI Assist", description: "Suggest next steps while you remain in control." },
  { id: "ai_build", label: "AI Build", description: "Compose a multi-step plan and preview it before execution." },
  { id: "ai_scenario", label: "AI Scenario", description: "Generate explicit scenario branches with assumptions and evidence." },
];

export const DETERMINISTIC_ENGINE_REGISTRY = [
  { id: "valuation.dcf", label: "DCF / WACC", authority: "valuation-engine" },
  { id: "options.greeks", label: "Options Greeks", authority: "options-engine" },
  { id: "fixed-income.duration", label: "Duration / DV01", authority: "fixed-income-engine" },
  { id: "portfolio.optimization", label: "Portfolio Optimization", authority: "portfolio-engine" },
  { id: "portfolio.var", label: "VaR / CVaR", authority: "risk-engine" },
  { id: "statistics.regression", label: "Regression / Statistics", authority: "statistics-engine" },
  { id: "simulations.monte-carlo", label: "Monte Carlo", authority: "simulation-engine" },
] as const;

export interface MasterAiContext {
  activeSurface: string;
  activeView?: string;
  activeSymbol?: string;
  selectedFieldIds: string[];
  scope?: ScreenerScope;
  locale: string;
}

export interface MasterAiToolRequest {
  toolId: "data_fabric.query" | "instrument.resolve" | "deterministic.compute" | "context.explain";
  fieldIds?: string[];
  engineId?: string;
  prompt?: string;
}

export interface MasterAiSessionState {
  state: MasterAiState;
  mode: MasterAiMode;
  updatedAt?: string | null;
}

export function normalizeMasterAiSessionState(input?: Partial<MasterAiSessionState> | null): MasterAiSessionState {
  const state: MasterAiState = input?.state === "on" ? "on" : "off";
  const mode: MasterAiMode = MASTER_AI_MODES.some((item) => item.id === input?.mode) ? input!.mode! : "manual";
  return { state, mode, updatedAt: input?.updatedAt ?? null };
}

export function requiresMasterAiConfirmation(action: "send" | "share" | "delete" | "monitor" | "save" | "open" | "compute"): boolean {
  return ["send", "share", "delete", "monitor"].includes(action);
}

export function validateMasterAiToolRequest(request: MasterAiToolRequest): { ok: true } | { ok: false; error: string } {
  if (request.toolId === "data_fabric.query") {
    if (!request.fieldIds?.length) return { ok: false, error: "Data Fabric queries require at least one field." };
    const unknown = request.fieldIds.find((id) => !buildDynamicAnalyticsCatalog().some((field) => field.id === id));
    if (unknown) return { ok: false, error: `Unknown Data Fabric field: ${unknown}` };
  }
  if (request.toolId === "deterministic.compute") {
    if (!request.engineId) return { ok: false, error: "Deterministic computation requires an engineId." };
    if (!DETERMINISTIC_ENGINE_REGISTRY.some((engine) => engine.id === request.engineId)) return { ok: false, error: `Unknown deterministic engine: ${request.engineId}` };
  }
  return { ok: true };
}

export const MASTER_AI_LOCALES = ["en", "hi", "de", "fr", "ja", "es", "pt"] as const;

export interface MasterAiAttribution {
  provider: string;
  model: string;
  promptHash: string;
  evidenceIds: string[];
}

export interface MasterAiFallback {
  reason: "provider-unavailable" | "tool-invalid" | "context-missing";
  message: string;
  deterministicAlternative?: string;
}

export interface MasterAiPlanStep {
  id: string;
  tool: MasterAiToolRequest;
  dependsOn: string[];
}

export function validateMasterAiPlan(steps: readonly MasterAiPlanStep[]): { ok: true } | { ok: false; error: string } {
  const ids = new Set<string>();
  for (const step of steps) {
    if (!step.id.trim() || ids.has(step.id)) return { ok: false, error: "Master AI plan step IDs must be unique and non-empty." };
    ids.add(step.id);
    const validation = validateMasterAiToolRequest(step.tool);
    if (!validation.ok) return validation;
    if (step.dependsOn.some((dependency) => dependency === step.id || !ids.has(dependency))) return { ok: false, error: `Step ${step.id} has an unresolved dependency.` };
  }
  return { ok: true };
}

export function buildMasterAiFallback(reason: MasterAiFallback["reason"]): MasterAiFallback {
  if (reason === "provider-unavailable") return { reason, message: "AI provider unavailable; continue with deterministic tools.", deterministicAlternative: "manual" };
  if (reason === "tool-invalid") return { reason, message: "The requested tool or field was not recognized; no action was executed." };
  return { reason, message: "The active context is incomplete; select an object or field and try again." };
}

// ─── V4-11 New Experience Shell ──────────────────────────────────────────

export const EXPERIENCE_SHELL_SURFACES = [
  { id: "projects", label: "Projects", description: "Persistent conversations, resources, sessions and living analytical workspaces." },
  { id: "pulse", label: "Pulse", description: "What changed, what matters, and what needs attention." },
  { id: "explore", label: "Explore", description: "Discover instruments, markets, metrics, and relationships." },
  { id: "workbench", label: "Workbench", description: "Build multi-pane analysis with deterministic engines." },
  { id: "signals", label: "Signals", description: "Monitor alerts, scenarios, and decision triggers." },
  { id: "library", label: "Library", description: "Return to saved work, favorites, evidence, and outputs." },
] as const;

export type ExperienceShellSurface = typeof EXPERIENCE_SHELL_SURFACES[number]["id"];
export type ExperienceObjectAction = "open" | "inspect" | "ask" | "follow" | "monitor" | "save" | "share" | "add-to-workspace" | "export";
export const EXPERIENCE_OBJECT_ACTIONS: readonly ExperienceObjectAction[] = ["open", "inspect", "ask", "follow", "monitor", "save", "share", "add-to-workspace", "export"];

export function validateExperienceObjectAction(action: string): { ok: true; action: ExperienceObjectAction; requiresConfirmation: boolean } | { ok: false; error: string } {
  if (!EXPERIENCE_OBJECT_ACTIONS.includes(action as ExperienceObjectAction)) return { ok: false, error: `Unknown object action: ${action}` };
  const normalized = action as ExperienceObjectAction;
  const requiresConfirmation = normalized === "share" || normalized === "monitor";
  return { ok: true, action: normalized, requiresConfirmation };
}

export interface ExperienceShellPreferences {
  surface: ExperienceShellSurface;
  focusMode: boolean;
  progressiveDisclosure: boolean;
  reducedMotion: boolean;
  persona: "investor" | "researcher" | "operator" | "student";
}

export function normalizeExperienceShellPreferences(input?: Partial<ExperienceShellPreferences>): ExperienceShellPreferences {
  const surface = EXPERIENCE_SHELL_SURFACES.some((item) => item.id === input?.surface) ? input?.surface! : "projects";
  const persona = ["investor", "researcher", "operator", "student"].includes(input?.persona ?? "") ? input?.persona! : "investor";
  return { surface, focusMode: Boolean(input?.focusMode), progressiveDisclosure: input?.progressiveDisclosure !== false, reducedMotion: Boolean(input?.reducedMotion), persona };
}

export interface OrientationBenchmark {
  targetSeconds: 10 | 60;
  requiredActions: string[];
  completed: boolean;
  elapsedMs?: number;
}

export const ORIENTATION_BENCHMARKS: readonly OrientationBenchmark[] = [
  { targetSeconds: 10, requiredActions: ["identify active surface", "open search", "open active object"], completed: false },
  { targetSeconds: 60, requiredActions: ["find a metric", "open a comparison", "inspect evidence", "save a workspace"], completed: false },
];

// ─── V4-23 Market Packs ───────────────────────────────────────────────────

export interface MarketPack {
  id: string;
  label: string;
  region: string;
  countries: readonly string[];
  exchanges: readonly { mic: string; label: string; countryCode: string; timezone: string }[];
  currency: string;
  locale: string;
  aliases: readonly string[];
}

export const MARKET_PACKS: readonly MarketPack[] = [
  { id: "india", label: "India", region: "South Asia", countries: ["IN"], exchanges: [{ mic: "XNSE", label: "NSE India", countryCode: "IN", timezone: "Asia/Kolkata" }, { mic: "XBOM", label: "BSE India", countryCode: "IN", timezone: "Asia/Kolkata" }], currency: "INR", locale: "en-IN", aliases: ["bharat", "nse", "bse"] },
  { id: "united-states", label: "United States", region: "North America", countries: ["US"], exchanges: [{ mic: "XNAS", label: "Nasdaq", countryCode: "US", timezone: "America/New_York" }, { mic: "XNYS", label: "New York Stock Exchange", countryCode: "US", timezone: "America/New_York" }], currency: "USD", locale: "en-US", aliases: ["usa", "us", "america", "nyse", "nasdaq"] },
  { id: "uk-europe", label: "UK & Europe", region: "Europe", countries: ["GB", "DE", "FR", "NL", "CH"], exchanges: [{ mic: "XLON", label: "London Stock Exchange", countryCode: "GB", timezone: "Europe/London" }, { mic: "XETR", label: "Xetra", countryCode: "DE", timezone: "Europe/Berlin" }, { mic: "XPAR", label: "Euronext Paris", countryCode: "FR", timezone: "Europe/Paris" }], currency: "EUR", locale: "en-GB", aliases: ["europe", "european union", "uk", "london"] },
  { id: "apac", label: "APAC", region: "Asia Pacific", countries: ["JP", "HK", "SG", "KR"], exchanges: [{ mic: "XTKS", label: "Tokyo Stock Exchange", countryCode: "JP", timezone: "Asia/Tokyo" }, { mic: "XHKG", label: "Hong Kong Exchanges", countryCode: "HK", timezone: "Asia/Hong_Kong" }, { mic: "XSES", label: "Singapore Exchange", countryCode: "SG", timezone: "Asia/Singapore" }], currency: "JPY", locale: "en-SG", aliases: ["asia pacific", "asia", "japan", "hong kong"] },
  { id: "australia-canada", label: "Australia & Canada", region: "Pacific / North America", countries: ["AU", "CA"], exchanges: [{ mic: "XASX", label: "Australian Securities Exchange", countryCode: "AU", timezone: "Australia/Sydney" }, { mic: "XTSE", label: "Toronto Stock Exchange", countryCode: "CA", timezone: "America/Toronto" }], currency: "AUD", locale: "en-AU", aliases: ["australia", "canada", "asx", "tsx"] },
  { id: "middle-east", label: "Middle East", region: "Middle East", countries: ["AE", "SA", "IL", "QA"], exchanges: [{ mic: "XDFM", label: "Dubai Financial Market", countryCode: "AE", timezone: "Asia/Dubai" }, { mic: "XSAU", label: "Saudi Exchange", countryCode: "SA", timezone: "Asia/Riyadh" }, { mic: "XTAE", label: "Tel Aviv Stock Exchange", countryCode: "IL", timezone: "Asia/Jerusalem" }], currency: "AED", locale: "en-AE", aliases: ["mena", "gulf", "uae", "saudi", "dubai"] },
] as const;

export function findMarketPack(input: string): MarketPack | null {
  const needle = input.trim().toLowerCase();
  if (!needle) return null;
  return MARKET_PACKS.find((pack) => [pack.id, pack.label, ...pack.aliases].some((value) => value.toLowerCase() === needle)) ?? null;
}

export function formatMarketValue(value: number, packOrId: MarketPack | string, options?: Intl.NumberFormatOptions): string {
  const pack = typeof packOrId === "string" ? findMarketPack(packOrId) : packOrId;
  if (!pack) return new Intl.NumberFormat("en-US", options).format(value);
  return new Intl.NumberFormat(pack.locale, { maximumFractionDigits: 2, ...options, style: options?.style ?? "currency", currency: options?.currency ?? pack.currency }).format(value);
}

export function formatMarketDate(date: Date, packOrId: MarketPack | string): string {
  const pack = typeof packOrId === "string" ? findMarketPack(packOrId) : packOrId;
  return new Intl.DateTimeFormat(pack?.locale ?? "en-US", { dateStyle: "medium", timeZone: pack?.exchanges[0].timezone ?? "UTC" }).format(date);
}

export function getMarketClock(pack: MarketPack, at = new Date()): { timezone: string; localTime: string; status: "open" | "closed" } {
  const venue = pack.exchanges[0];
  const localTime = new Intl.DateTimeFormat(pack.locale, { timeZone: venue.timezone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: venue.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(at);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const minutes = hour * 60 + minute;
  const session: Record<string, [number, number]> = {
    india: [9 * 60 + 15, 15 * 60 + 30],
    "united-states": [9 * 60 + 30, 16 * 60],
    "uk-europe": [8 * 60, 16 * 60 + 30],
    apac: [9 * 60, 15 * 60],
    "australia-canada": [10 * 60, 16 * 60],
    "middle-east": [10 * 60, 14 * 60 + 30],
  };
  const [openMinute, closeMinute] = session[pack.id] ?? [9 * 60 + 30, 16 * 60];
  const status = weekday && !["Sat", "Sun"].includes(weekday) && minutes >= openMinute && minutes < closeMinute ? "open" : "closed";
  return { timezone: venue.timezone, localTime, status };
}

export const WAVE_C_CONTRACT_VERSION = "1.0.0" as const;
