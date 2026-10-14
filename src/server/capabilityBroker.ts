/**
 * Universal capability broker -- a generic engine for resolving a data
 * capability (financial_statements, quote, macro_series, ...) against
 * MULTIPLE providers concurrently and surfacing where they disagree,
 * instead of the "try providers in priority order, return the first
 * non-empty answer, discard the rest" pattern every existing fetch path
 * in this codebase uses today (financialDataProviders.ts,
 * marketData.ts/keyedQuoteAdapters.ts, marketDatasetStore.ts).
 *
 * That winner-take-all pattern is deliberately left alone for the hot,
 * high-frequency paths it already serves well (quotes, ticker tapes) --
 * calling every registered provider on every request would be a real
 * quota/latency regression there for no benefit most of the time. This
 * broker is for the opposite case: a user or engine that specifically
 * wants to know "do my sources actually agree", where the cost of asking
 * several real providers is worth it because disagreement itself is the
 * answer (see financialStatementsBroker.ts for the first real
 * instantiation, against financial_statements).
 *
 * This module is intentionally capability-agnostic and has no import of
 * any specific vendor -- callers bind concrete providers via
 * CapabilityProvider<T>.
 */

export interface CapabilityProvider<T> {
  id: string;
  label: string;
  fetch(): Promise<T | null>;
}

export interface CapabilityObservation<T> {
  providerId: string;
  providerLabel: string;
  value: T;
}

export interface CapabilityConflict {
  /** Which sub-record within T this conflict belongs to (e.g. a financial-statement join key like "income:2024:FY"); "" when T itself is the unit of comparison. */
  key: string;
  field: string;
  values: Array<{ providerId: string; value: unknown }>;
  /** Whether this disagreement is large enough to matter, per the diff function's own domain-specific threshold (e.g. >=1% for a financial figure). Undefined when the diff function doesn't compute materiality -- callers should then treat every conflict as worth surfacing. */
  material?: boolean;
}

export interface CapabilityResolution<T> {
  capability: string;
  entity: string;
  authoritative: CapabilityObservation<T> | null;
  /** Every provider that returned real, non-empty data -- not just the winner. */
  observations: CapabilityObservation<T>[];
  attemptedProviders: string[];
  failures: Array<{ providerId: string; message: string }>;
  conflicts: CapabilityConflict[];
  /** Plain-language explanation of why `authoritative` was selected over the other observations, e.g. "Ranked highest in this capability's provider priority order among sources that returned data." Null when nothing answered. */
  authoritativeReason: string | null;
  resolvedAt: string;
}

/** Runs `fn` over `items` with at most `limit` in flight at once. Same shape as the equivalent private helper in marketData.ts, kept local here rather than importing that unrelated (and much larger) module for one generic utility. */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface ResolveCapabilityInput<T> {
  capability: string;
  entity: string;
  /** Providers in priority order -- also used as the tie-break when `rank` doesn't otherwise distinguish them. */
  providers: CapabilityProvider<T>[];
  concurrency?: number;
  /** True when a fetched value should be treated as "no data", not a real observation (e.g. an empty array). */
  isEmpty: (value: T) => boolean;
  /** Picks the authoritative observation from every provider that answered. Defaults to "earliest in provider priority order". */
  rank?: (observations: CapabilityObservation<T>[]) => CapabilityObservation<T> | null;
  /** Computes conflicts across every pair of observations. Optional -- a capability with nothing meaningful to field-diff (e.g. a single scalar quote) can omit this and rely on `observations` alone to show disagreement. */
  diff?: (observations: CapabilityObservation<T>[]) => CapabilityConflict[];
}

export async function resolveCapabilityConcurrently<T>(input: ResolveCapabilityInput<T>): Promise<CapabilityResolution<T>> {
  const attemptedProviders: string[] = [];
  const failures: Array<{ providerId: string; message: string }> = [];
  const concurrency = Math.max(1, input.concurrency ?? 3);

  const results = await mapWithConcurrency(input.providers, concurrency, async (provider) => {
    attemptedProviders.push(provider.id);
    try {
      const value = await provider.fetch();
      if (value === null || input.isEmpty(value)) return null;
      const observation: CapabilityObservation<T> = { providerId: provider.id, providerLabel: provider.label, value };
      return observation;
    } catch (error) {
      failures.push({ providerId: provider.id, message: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });

  const observations = results.filter((r): r is CapabilityObservation<T> => r !== null);
  const rank = input.rank ?? ((obs: CapabilityObservation<T>[]) => {
    for (const provider of input.providers) {
      const match = obs.find((o) => o.providerId === provider.id);
      if (match) return match;
    }
    return obs[0] ?? null;
  });
  const authoritative = rank(observations);
  const authoritativeReason = authoritative
    ? (input.rank
      ? "Selected by this capability's custom ranking rule."
      : `Ranked highest in ${input.capability}'s provider priority order among the ${observations.length} source${observations.length === 1 ? "" : "s"} that returned data.`)
    : null;
  const conflicts = observations.length > 1 && input.diff ? input.diff(observations) : [];

  return {
    capability: input.capability,
    entity: input.entity,
    authoritative,
    observations,
    attemptedProviders,
    failures,
    conflicts,
    authoritativeReason,
    resolvedAt: new Date().toISOString(),
  };
}
