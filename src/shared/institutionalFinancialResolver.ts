import {
  resolveFinancialMetric,
  type FinancialMetricObservation,
  type ResolvedFinancialMetric,
} from "./financialMetricRegistry";

interface CanonicalFallback {
  canonicalId: string;
  derivedId: string;
  note: string;
}

const CANONICAL_FALLBACKS: readonly CanonicalFallback[] = [
  { canonicalId: "marketCap", derivedId: "marketCapDerived", note: "Derived from price and diluted shares because no direct market capitalization observation was available." },
  { canonicalId: "enterpriseValue", derivedId: "enterpriseValueDerived", note: "Derived from equity value plus debt/other claims less cash and non-operating financial assets." },
  { canonicalId: "fcf", derivedId: "fcfDerived", note: "Derived from cash from operations less absolute capital expenditure because no direct FCF observation was available." },
  { canonicalId: "workingCapital", derivedId: "workingCapitalDerived", note: "Derived from current assets less current liabilities." },
  { canonicalId: "investedCapital", derivedId: "investedCapitalDerived", note: "Derived from gross debt plus equity less cash and short-term investments." },
  { canonicalId: "capitalEmployed", derivedId: "capitalEmployedDerived", note: "Derived from total assets less current liabilities." },
];

function hasDirect(metricId: string, observations: readonly FinancialMetricObservation[], period?: string, scenarioId?: string): boolean {
  return observations.some(observation =>
    observation.metricId === metricId &&
    typeof observation.value === "number" && Number.isFinite(observation.value) &&
    (period ? observation.period === period : true) &&
    (scenarioId ? observation.scenarioId === scenarioId || !observation.scenarioId : true),
  );
}

/**
 * Enriches the canonical observation set with deterministic fallback values.
 * Direct/provider/manual observations always win; derived fallbacks exist only
 * when the canonical field itself is absent. This makes downstream metrics such
 * as EV/EBITDA work from components without requiring panels to know the bridge.
 */
export function enrichCanonicalFinancialObservations(
  observations: readonly FinancialMetricObservation[],
  options: { period?: string; scenarioId?: string } = {},
): FinancialMetricObservation[] {
  const enriched = observations.slice();
  // Multiple passes allow a fallback to depend on another fallback, e.g. EV -> gross debt.
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    for (const fallback of CANONICAL_FALLBACKS) {
      if (hasDirect(fallback.canonicalId, enriched, options.period, options.scenarioId)) continue;
      const derived = resolveFinancialMetric(fallback.derivedId, enriched, options);
      if (typeof derived?.value !== "number" || !Number.isFinite(derived.value)) continue;
      enriched.push({
        metricId: fallback.canonicalId,
        value: derived.value,
        status: "derived",
        period: options.period ?? derived.period,
        scenarioId: options.scenarioId ?? derived.scenarioId,
        asOf: derived.asOf,
        currency: derived.currency,
        source: "LiOS canonical fallback",
        note: fallback.note,
      });
      changed = true;
    }
    if (!changed) break;
  }
  return enriched;
}

export function resolveInstitutionalFinancialMetric(
  idOrAlias: string,
  observations: readonly FinancialMetricObservation[],
  options: { period?: string; scenarioId?: string } = {},
): ResolvedFinancialMetric | null {
  return resolveFinancialMetric(idOrAlias, enrichCanonicalFinancialObservations(observations, options), options);
}

export function canonicalFallbackIds(): readonly string[] {
  return CANONICAL_FALLBACKS.map(item => item.canonicalId);
}
