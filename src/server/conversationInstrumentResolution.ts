import {
  resolveInstrumentLocal,
  type InstrumentMasterCandidate,
  type InstrumentProviderFallback,
  type InstrumentResolutionQuery,
  type InstrumentResolutionResult,
} from "@shared/globalInstrumentMaster";
/**
 * Structured identity resolution has a different grouping contract from
 * free-text search. Here we temporarily collect same-name, same-symbol
 * provider observations so the conflict gate below can *inspect* all known
 * venues/currencies and combine only nonconflicting evidence. Free-text
 * search itself must keep provisional venues as separate suggestions.
 */
function observationKey(candidate: InstrumentMasterCandidate): string {
  return [candidate.name, candidate.symbol ?? ""]
    .map(value => value.trim().toUpperCase().replace(/\s+/g, " "))
    .join("\u0000");
}

/** Extend the existing master fallback, never a competing identity registry. */
export function createConversationInstrumentFallback(input: {
  loadCatalog: () => InstrumentMasterCandidate[];
  searchProvider: (queryText: string, signal: AbortSignal) => Promise<InstrumentMasterCandidate[]>;
  allowExternal: boolean;
  signal: AbortSignal;
}): InstrumentProviderFallback {
  return {
    async resolve(query) {
      input.signal.throwIfAborted();
      const catalog = input.loadCatalog();
      // Preserve compatibility matches and ambiguity without contacting a provider.
      if (resolveInstrumentLocal(query, catalog).status !== "not_found" || !input.allowExternal) return catalog;
      const queryText = query.ticker ?? query.name;
      if (!queryText?.trim()) return catalog;
      const candidates = await input.searchProvider(queryText, input.signal);
      input.signal.throwIfAborted();
      // Reuse only search's grouping identity, not its free-text relevance
      // filter: the structured master remains the sole matching authority.
      const groups = new Map<string, InstrumentMasterCandidate[]>();
      for (const candidate of candidates) {
        if (candidate.canonical !== false) continue;
        const key = observationKey(candidate);
        const members = groups.get(key);
        if (members) members.push(candidate);
        else groups.set(key, [candidate]);
      }
      return [...groups.values()].flatMap((members) => {
        const primary = members[0];
        const mics = new Set(members.map((candidate) => candidate.mic?.trim().toUpperCase()).filter(Boolean));
        const exchanges = new Set(members.map((candidate) => candidate.exchange?.trim().toUpperCase()).filter(Boolean));
        const countries = new Set(members.map((candidate) => candidate.countryCode?.trim().toUpperCase()).filter(Boolean));
        const currencies = new Set(members.map((candidate) => candidate.currency?.trim().toUpperCase()).filter(Boolean));
        if (mics.size > 1 || exchanges.size > 1 || countries.size > 1 || currencies.size > 1) return members;
        if (members.some((candidate) => candidate.lifecycleStatus !== primary.lifecycleStatus
          || (candidate.validFrom ?? null) !== (primary.validFrom ?? null)
          || (candidate.validTo ?? null) !== (primary.validTo ?? null))) return members;
        const identifiers = members.flatMap((candidate) => candidate.identifiers);
        const seen = new Set<string>();
        return [{
          ...primary,
          mic: mics.values().next().value ?? null,
          exchange: exchanges.values().next().value ?? null,
          countryCode: countries.values().next().value ?? null,
          currency: currencies.values().next().value ?? null,
          identifiers: identifiers.filter((identifier) => {
            const key = JSON.stringify(identifier);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          }),
        }];
      });
    },
  };
}

/**
 * Conversation entity extraction can only guess whether a bare word is a ticker or a company
 * name ("chart of apple" -> APPLE vs "chart aapl"). Resolve as a ticker first; if that finds
 * nothing, retry the same text as a company name. Ambiguity is never resolved by guessing.
 */
export async function resolveConversationInstrument(
  input: { symbol?: string; name?: string },
  resolve: (query: InstrumentResolutionQuery) => Promise<InstrumentResolutionResult>,
): Promise<InstrumentResolutionResult> {
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  const name = (input.name ?? "").trim();
  if (!symbol && !name) throw new Error("Instrument resolution requires a symbol or company/security name.");
  if (!symbol) return resolve({ name });

  const byTicker = await resolve({ ticker: symbol });
  if (byTicker.match || byTicker.status === "ambiguous") return byTicker;
  return resolve({ name: name || symbol });
}
