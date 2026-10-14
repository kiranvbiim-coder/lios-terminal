import {
  FINANCIAL_METRICS,
  getFinancialMetricDefinition,
  type FinancialMetricDefinition,
  type FinancialMetricObservation,
  type FinancialMetricStatus,
  type FinancialMetricTraceInput,
  type FinancialMetricUnit,
} from "./financialMetricRegistry";
import { evaluateFinanceFormula } from "./financeFormula";

/** A provider payload is retained verbatim in `raw`, but only these fields can become canonical. */
export interface MetricObservationInput extends Partial<Omit<FinancialMetricObservation, "metricId" | "value" | "status">> {
  metricId?: string;
  /** Provider field names are accepted as aliases, never as new metric definitions. */
  field?: string;
  providerField?: string;
  metric?: string;
  name?: string;
  value?: unknown;
  status?: FinancialMetricStatus;
  unit?: FinancialMetricUnit | string;
  provider?: string;
  sourceReference?: string;
  sourceRef?: string;
  reference?: string;
  kind?: MetricObservationKind;
  valueKind?: MetricObservationKind;
  observationKind?: MetricObservationKind;
  raw?: Record<string, unknown>;
  [key: string]: unknown;
}

export type MetricObservationKind = "direct/provider" | "derived" | "model-derived";

export interface MetricCandidate extends FinancialMetricObservation {
  metricId: string;
  value: number;
  unit: FinancialMetricUnit;
  provider?: string;
  sourceReference?: string;
  kind: MetricObservationKind;
  raw: Record<string, unknown>;
}

export interface RejectedMetricObservation {
  raw: Record<string, unknown>;
  reason: string;
  metricId?: string;
}

export interface MetricConflict {
  metricId: string;
  candidates: readonly MetricCandidate[];
  reason: string;
}

export interface MetricIntelligenceTrace extends FinancialMetricTraceInput {
  unit: FinancialMetricUnit;
  provider?: string;
  sourceUrl?: string;
  sourceReference?: string;
  kind: MetricObservationKind;
  candidates: readonly MetricCandidate[];
  missingDependencies: readonly string[];
  comparabilityNotes: readonly string[];
}

export interface ResolvedMetricIntelligence {
  metricId: string;
  value: number | null;
  /** Existing registry status is preserved; `valueKind` distinguishes direct, derived and model-derived. */
  status: FinancialMetricStatus;
  valueKind: MetricObservationKind | "missing" | "conflict";
  unit: FinancialMetricUnit;
  period?: string;
  currency?: string;
  asOf?: string;
  publishedAt?: string;
  vintageAt?: string;
  source?: string;
  provider?: string;
  sourceUrl?: string;
  sourceReference?: string;
  confidence?: number;
  scenarioId?: string;
  definition: FinancialMetricDefinition;
  definitions: readonly FinancialMetricDefinition[];
  dependencies: readonly string[];
  formula?: string;
  trace: readonly MetricIntelligenceTrace[];
  candidates: readonly MetricCandidate[];
  /** Alias useful to panels that want to make retention explicit. */
  candidateObservations: readonly MetricCandidate[];
  conflicts: readonly MetricConflict[];
  missingDependencies: readonly string[];
  optionalMissingDependencies: readonly string[];
  comparabilityNotes: readonly string[];
  /** Every source payload, including unknown fields and rejected observations. */
  rawObservations: readonly Record<string, unknown>[];
  rejectedObservations: readonly RejectedMetricObservation[];
}

export type MetricIntelligenceResult = ResolvedMetricIntelligence;
export type ProviderMetricObservation = MetricObservationInput;

export interface MetricIntelligenceOptions {
  period?: string;
  currency?: string;
  scenarioId?: string;
}

const FINITE = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const STATUS_VALUES = new Set<FinancialMetricStatus>([
  "live", "filed", "estimate", "derived", "manual", "imported", "missing", "stale", "conflict", "not-applicable",
]);

const STATUS_PRIORITY: Record<FinancialMetricStatus, number> = {
  manual: 100, imported: 90, filed: 80, live: 75, estimate: 70, derived: 50, conflict: 40, stale: 20, missing: 0, "not-applicable": -1,
};

const UNIT_ALIASES: Record<string, FinancialMetricUnit> = {
  currency: "currency", money: "currency", usd: "currency", dollars: "currency", "$": "currency",
  price: "price", "share price": "price", "usd/share": "price", "$/share": "price", "dollar/share": "price",
  "currency-per-share": "currency-per-share", "currency per share": "currency-per-share", "usd per share": "currency-per-share", "$/sh": "currency-per-share",
  percent: "percent", percentage: "percent", "%": "percent", pct: "percent",
  ratio: "ratio", multiple: "multiple", "x": "multiple", days: "days", day: "days",
  turnover: "turnover", count: "count", shares: "count", bps: "bps", "basis points": "bps",
  yield: "yield", volatility: "volatility", text: "text",
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUnit(value: unknown, expected: FinancialMetricUnit): FinancialMetricUnit | null {
  if (value === undefined || value === null || value === "") return expected;
  if (typeof value !== "string") return null;
  const normalized = UNIT_ALIASES[normalizeKey(value)] ?? UNIT_ALIASES[normalizeKey(value).replace(/[_-]+/g, " ")];
  return normalized ?? null;
}

function asRaw(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value };
  return { ...(value as Record<string, unknown>) };
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanCurrency(value: unknown): string | undefined {
  const currency = cleanOptionalString(value);
  return currency?.toUpperCase();
}

function sourceTimestamp(values: readonly (string | undefined)[]): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1);
}

function canonicalKind(input: MetricObservationInput, status: FinancialMetricStatus): MetricObservationKind {
  const value = input.kind ?? input.valueKind ?? input.observationKind;
  if (value === "derived" || value === "model-derived" || value === "direct/provider") return value;
  if (status === "derived") return "derived";
  return "direct/provider";
}

interface NormalizedStore {
  byMetric: Map<string, MetricCandidate[]>;
  rawObservations: Record<string, unknown>[];
  rejectedObservations: RejectedMetricObservation[];
}

function normalizeObservations(observations: readonly MetricObservationInput[]): NormalizedStore {
  const byMetric = new Map<string, MetricCandidate[]>();
  const rawObservations: Record<string, unknown>[] = [];
  const rejectedObservations: RejectedMetricObservation[] = [];

  for (const input of observations) {
    const raw = asRaw(input);
    rawObservations.push(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      rejectedObservations.push({ raw, reason: "Observation must be an object" });
      continue;
    }

    const requestedId = [input.metricId, input.field, input.providerField, input.metric, input.name]
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    const definition = requestedId ? getFinancialMetricDefinition(requestedId) : null;
    if (!definition) {
      rejectedObservations.push({ raw, reason: requestedId ? `Unknown metric alias: ${requestedId}` : "Missing metric ID or provider field" });
      continue;
    }
    if (!FINITE(input.value)) {
      rejectedObservations.push({ raw, metricId: definition.id, reason: "Observation value must be a finite number (null, NaN and Infinity are rejected)" });
      continue;
    }
    const unit = normalizeUnit(input.unit, definition.unit);
    if (!unit) {
      rejectedObservations.push({ raw, metricId: definition.id, reason: `Unknown unit: ${String(input.unit)}` });
      continue;
    }
    if (unit !== definition.unit) {
      rejectedObservations.push({ raw, metricId: definition.id, reason: `Unit ${unit} is incompatible with ${definition.id} (${definition.unit})` });
      continue;
    }
    const status = input.status ?? "imported";
    if (!STATUS_VALUES.has(status)) {
      rejectedObservations.push({ raw, metricId: definition.id, reason: `Unknown status: ${String(status)}` });
      continue;
    }
    if (input.confidence !== undefined && (!FINITE(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
      rejectedObservations.push({ raw, metricId: definition.id, reason: "Confidence must be a finite number between 0 and 1" });
      continue;
    }

    const sourceReference = cleanOptionalString(input.sourceReference ?? input.sourceRef ?? input.reference);
    const source = cleanOptionalString(input.source) ?? cleanOptionalString(input.provider);
    const candidate: MetricCandidate = {
      metricId: definition.id,
      value: input.value,
      status,
      unit,
      period: cleanOptionalString(input.period),
      asOf: cleanOptionalString(input.asOf),
      publishedAt: cleanOptionalString(input.publishedAt),
      vintageAt: cleanOptionalString(input.vintageAt),
      source,
      sourceUrl: cleanOptionalString(input.sourceUrl),
      sourceReference,
      currency: cleanCurrency(input.currency),
      note: cleanOptionalString(input.note),
      confidence: input.confidence,
      scenarioId: cleanOptionalString(input.scenarioId),
      manualOverride: input.manualOverride === true,
      provider: cleanOptionalString(input.provider),
      kind: canonicalKind(input, status),
      raw,
    };
    const values = byMetric.get(definition.id) ?? [];
    values.push(candidate);
    byMetric.set(definition.id, values);
  }
  return { byMetric, rawObservations, rejectedObservations };
}

function selectedCandidates(
  definition: FinancialMetricDefinition,
  candidates: readonly MetricCandidate[],
  options: MetricIntelligenceOptions,
): { candidates: MetricCandidate[]; notes: string[]; rejected: RejectedMetricObservation[] } {
  const notes: string[] = [];
  const rejected: RejectedMetricObservation[] = [];
  const filtered = candidates.filter(candidate => {
    if (options.period !== undefined && candidate.period !== options.period) return false;
    if (options.currency !== undefined && candidate.currency !== options.currency) return false;
    if (options.scenarioId !== undefined && candidate.scenarioId !== options.scenarioId && candidate.scenarioId !== undefined) return false;
    return true;
  });
  if (options.period === undefined && new Set(filtered.map(candidate => candidate.period ?? "<missing-period>")).size > 1) {
    notes.push("Multiple reporting periods are present; an explicit period is required for comparability");
  }
  if (options.currency === undefined && new Set(filtered.map(candidate => candidate.currency ?? "<missing-currency>")).size > 1) {
    notes.push("Multiple currencies or missing currency metadata are present; an explicit currency is required for comparability");
  }
  if (filtered.some(candidate => candidate.kind === "model-derived")) notes.push("At least one candidate is model-derived rather than provider-direct");
  return { candidates: filtered, notes, rejected };
}

function conflictFor(definition: FinancialMetricDefinition, candidates: readonly MetricCandidate[], notes: readonly string[]): MetricConflict | null {
  if (candidates.some(candidate => candidate.status === "conflict")) {
    return {
      metricId: definition.id,
      candidates,
      reason: "At least one provider marked the candidate set as conflicting",
    };
  }
  if (candidates.length < 2) return null;
  const periods = new Set(candidates.map(candidate => candidate.period ?? "<missing-period>"));
  const currencies = new Set(candidates.map(candidate => candidate.currency ?? "<missing-currency>"));
  const values = new Set(candidates.map(candidate => candidate.value));
  if (periods.size > 1 || currencies.size > 1 || values.size > 1 || notes.some(note => note.includes("explicit period") || note.includes("explicit currency"))) {
    return {
      metricId: definition.id,
      candidates,
      reason: values.size > 1 ? "Providers disagree on the metric value" : "Candidates are not comparable without an explicit period and currency",
    };
  }
  return null;
}

function chooseCandidate(candidates: readonly MetricCandidate[]): MetricCandidate | null {
  if (!candidates.length) return null;
  return [...candidates].sort((a, b) =>
    Number(Boolean(b.manualOverride)) - Number(Boolean(a.manualOverride))
    || (b.confidence ?? -1) - (a.confidence ?? -1)
    || STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status]
    || (a.provider ?? a.source ?? "").localeCompare(b.provider ?? b.source ?? ""),
  )[0] ?? null;
}

function traceFrom(result: ResolvedMetricIntelligence, path: string): MetricIntelligenceTrace {
  return {
    metricId: result.metricId,
    value: result.value,
    status: result.status,
    source: result.source,
    period: result.period,
    asOf: result.asOf,
    currency: result.currency,
    unit: result.unit,
    provider: result.provider,
    sourceUrl: result.sourceUrl,
    sourceReference: result.sourceReference,
    kind: result.valueKind === "missing" || result.valueKind === "conflict" ? "direct/provider" : result.valueKind,
    candidates: result.candidates,
    missingDependencies: result.missingDependencies,
    comparabilityNotes: [`Dependency path: ${path}`, ...result.comparabilityNotes],
  };
}

function compatibleDependencies(results: readonly ResolvedMetricIntelligence[]): string[] {
  const notes: string[] = [];
  const comparable = results.filter(result => FINITE(result.value));
  const periods = new Set(comparable.map(result => result.period ?? "<missing-period>"));
  const currencies = new Set(comparable.map(result => result.currency ?? "<missing-currency>"));
  if (periods.size > 1) notes.push("Dependencies have incompatible reporting periods");
  if (currencies.size > 1) notes.push("Dependencies have incompatible currencies or incomplete currency metadata");
  if (results.some(result => result.status === "conflict")) notes.push("A dependency has conflicting provider candidates");
  return notes;
}

function resolveInternal(
  definition: FinancialMetricDefinition,
  store: NormalizedStore,
  options: MetricIntelligenceOptions,
  visited: Set<string>,
): ResolvedMetricIntelligence {
  const candidatesResult = selectedCandidates(definition, store.byMetric.get(definition.id) ?? [], options);
  const candidates = candidatesResult.candidates;
  const allCandidates = store.byMetric.get(definition.id) ?? [];
  const directConflict = conflictFor(definition, candidates, candidatesResult.notes);
  const common = {
    metricId: definition.id,
    unit: definition.unit,
    definition,
    definitions: [definition] as readonly FinancialMetricDefinition[],
    dependencies: [...(definition.dependencies ?? []), ...(definition.optionalDependencies ?? [])],
    formula: definition.formula,
    candidates: allCandidates,
    candidateObservations: allCandidates,
    conflicts: directConflict ? [directConflict] : [],
    rawObservations: store.rawObservations,
    rejectedObservations: store.rejectedObservations,
  };

  if (directConflict) {
    return { ...common, value: null, status: "conflict", valueKind: "conflict", missingDependencies: [], optionalMissingDependencies: [], trace: [], comparabilityNotes: [...candidatesResult.notes, directConflict.reason] };
  }
  const direct = chooseCandidate(candidates);
  if (direct) {
    return {
      ...common,
      ...direct,
      valueKind: direct.kind,
      definitions: [definition],
      dependencies: common.dependencies,
      conflicts: [],
      trace: [],
      missingDependencies: [],
      optionalMissingDependencies: [],
      comparabilityNotes: candidatesResult.notes,
    };
  }
  if (!definition.calculate && !definition.formula) {
    return { ...common, value: null, status: "missing", valueKind: "missing", period: options.period, scenarioId: options.scenarioId, missingDependencies: [definition.id], optionalMissingDependencies: [], trace: [], comparabilityNotes: candidatesResult.notes };
  }
  if (visited.has(definition.id)) {
    return { ...common, value: null, status: "conflict", valueKind: "conflict", period: options.period, scenarioId: options.scenarioId, missingDependencies: [definition.id], optionalMissingDependencies: [], trace: [], comparabilityNotes: ["Circular metric dependency"] };
  }

  const nextVisited = new Set(visited).add(definition.id);
  const required = [...(definition.dependencies ?? [])];
  const optional = [...(definition.optionalDependencies ?? [])];
  const dependencyResults: ResolvedMetricIntelligence[] = [];
  const missingDependencies: string[] = [];
  const optionalMissingDependencies: string[] = [];
  const trace: MetricIntelligenceTrace[] = [];
  const definitions: FinancialMetricDefinition[] = [definition];

  for (const dependency of required) {
    const dependencyDefinition = getFinancialMetricDefinition(dependency);
    if (!dependencyDefinition) {
      missingDependencies.push(dependency);
      continue;
    }
    const result = resolveInternal(dependencyDefinition, store, options, nextVisited);
    dependencyResults.push(result);
    definitions.push(result.definition, ...result.definitions.filter(item => item.id !== result.definition.id));
    trace.push(traceFrom(result, `${definition.id} → ${dependency}`), ...result.trace);
    if (!FINITE(result.value) || result.status === "conflict") missingDependencies.push(dependency);
  }
  for (const dependency of optional) {
    const dependencyDefinition = getFinancialMetricDefinition(dependency);
    if (!dependencyDefinition) {
      optionalMissingDependencies.push(dependency);
      continue;
    }
    const result = resolveInternal(dependencyDefinition, store, options, nextVisited);
    dependencyResults.push(result);
    definitions.push(result.definition, ...result.definitions.filter(item => item.id !== result.definition.id));
    trace.push(traceFrom(result, `${definition.id} → ${dependency}`), ...result.trace);
    if (!FINITE(result.value) || result.status === "conflict") optionalMissingDependencies.push(dependency);
  }

  const availableRequired = required.length - missingDependencies.length;
  const minimum = definition.minimumDependencyCount ?? required.length;
  const notes = [...candidatesResult.notes, ...compatibleDependencies(dependencyResults)];
  const allMissingDependencies = [...missingDependencies, ...optionalMissingDependencies];
  if (availableRequired < minimum || optionalMissingDependencies.length > 0) {
    if (optionalMissingDependencies.length > 0) {
      notes.push(`Dependencies unavailable: ${optionalMissingDependencies.join(", ")}; derived value withheld rather than zero-filled`);
    }
    return {
      ...common,
      value: null,
      status: "missing",
      valueKind: "missing",
      period: options.period,
      scenarioId: options.scenarioId,
      definitions: [...new Map(definitions.map(item => [item.id, item])).values()],
      trace,
      missingDependencies: allMissingDependencies,
      optionalMissingDependencies,
      comparabilityNotes: notes,
    };
  }
  if (notes.some(note => note.includes("incompatible") || note.includes("conflicting provider"))) {
    return {
      ...common,
      value: null,
      status: "missing",
      valueKind: "missing",
      period: options.period,
      scenarioId: options.scenarioId,
      definitions: [...new Map(definitions.map(item => [item.id, item])).values()],
      trace,
      missingDependencies: allMissingDependencies,
      optionalMissingDependencies,
      comparabilityNotes: notes,
    };
  }

  const values: Record<string, number | null> = {};
  for (const result of dependencyResults) values[result.metricId] = FINITE(result.value) ? result.value : null;
  let value: number | null = null;
  try {
    value = definition.calculate
      ? definition.calculate(values)
      : definition.formula
        ? evaluateFinanceFormula(definition.formula, values).value
        : null;
  } catch {
    value = null;
    notes.push("Metric formula rejected the supplied dependency values");
  }
  if (!FINITE(value)) {
    return {
      ...common,
      value: null,
      status: "missing",
      valueKind: "missing",
      period: options.period,
      scenarioId: options.scenarioId,
      definitions: [...new Map(definitions.map(item => [item.id, item])).values()],
      trace,
      missingDependencies: allMissingDependencies.length ? allMissingDependencies : required,
      optionalMissingDependencies,
      comparabilityNotes: notes,
    };
  }
  const tracePeriods = dependencyResults.map(item => item.period).filter((item): item is string => Boolean(item));
  const traceCurrencies = dependencyResults.map(item => item.currency).filter((item): item is string => Boolean(item));
  return {
    ...common,
    value,
    status: "derived",
    valueKind: "derived",
    period: options.period ?? (tracePeriods.length ? tracePeriods[0] : undefined),
    scenarioId: options.scenarioId,
    currency: options.currency ?? (traceCurrencies.length ? traceCurrencies[0] : undefined),
    asOf: sourceTimestamp(dependencyResults.map(item => item.asOf)),
    publishedAt: sourceTimestamp(dependencyResults.map(item => item.publishedAt)),
    vintageAt: sourceTimestamp(dependencyResults.map(item => item.vintageAt)),
    source: "LiOS governed metric intelligence resolver",
    definitions: [...new Map(definitions.map(item => [item.id, item])).values()],
    trace,
    missingDependencies: [],
    optionalMissingDependencies,
    comparabilityNotes: notes,
  };
}

/** Resolve one registry metric while retaining every source candidate and all provenance. */
export function resolveMetricIntelligence(
  idOrAlias: string,
  observations: readonly MetricObservationInput[],
  options: MetricIntelligenceOptions = {},
): ResolvedMetricIntelligence | null {
  const definition = getFinancialMetricDefinition(idOrAlias);
  if (!definition) return null;
  const normalizedOptions: MetricIntelligenceOptions = {
    ...options,
    period: options.period?.trim() || undefined,
    currency: cleanCurrency(options.currency),
    scenarioId: options.scenarioId?.trim() || undefined,
  };
  return resolveInternal(definition, normalizeObservations(observations), normalizedOptions, new Set());
}

/** Convenience alias for callers that name the operation after the output. */
export const resolveFinancialMetricIntelligence = resolveMetricIntelligence;

/** Return all registry definitions that can be addressed by the supplied aliases. */
export function metricIntelligenceDefinitions(idsOrAliases: readonly string[]): FinancialMetricDefinition[] {
  return idsOrAliases.map(getFinancialMetricDefinition).filter((definition): definition is FinancialMetricDefinition => Boolean(definition));
}

export const FINANCIAL_METRIC_INTELLIGENCE_DEFINITIONS = FINANCIAL_METRICS;
