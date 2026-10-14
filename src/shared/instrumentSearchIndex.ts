/**
 * LiOS V4 local instrument search index (LV4-04-11).
 *
 * Federation strategy step 1 (master plan section 10, "Federation
 * strategy"): a local, fast, in-process index over the common global
 * instrument universe -- the persisted canonical Global Instrument Master
 * rows (globalInstrumentMasterStore.ts) plus the bundled ~67k-ticker legacy
 * compatibility catalog (server/legacyTickerCatalog.ts) -- so free-text
 * ticker/company search does not require a network round trip for assets
 * LiOS already knows about locally.
 *
 * Step 2 ("provider-extended universe search") is an explicit extension
 * point here (`InstrumentSearchFederatedFallback`), invoked only when the
 * local index has zero groups, mirroring resolveInstrument()'s local-first
 * discipline in globalInstrumentMaster.ts. No live federated provider is
 * wired in this phase -- that requires a specific provider-adapter
 * decision, and remains tracked as follow-up LV4-04-11 work rather than a
 * fabricated fallback.
 *
 * Grouping (master plan section 10, "Primary-listing logic"): results are
 * grouped by durable entity where one already exists, with the
 * primary/highest-ranked listing surfacing as the group head and every
 * other matching listing attached beneath it as `relatedListings` -- so a
 * caller never sees raw provider-duplicate rows presented as separate
 * top-level results. Legacy rows that have not yet been linked to a
 * canonical entity (entityId === null) group by a stable synthetic key
 * derived from their own name+symbol instead, since inventing a shared
 * entity for unlinked compatibility rows would misrepresent identity that
 * does not exist yet.
 */
import type { InstrumentLifecycleStatus, InstrumentMasterCandidate } from "./globalInstrumentMaster";

const HISTORICAL_STATUSES = new Set<InstrumentLifecycleStatus>([
  "delisted",
  "expired",
  "merged",
  "acquired",
  "renamed",
]);

function isHistorical(candidate: InstrumentMasterCandidate): boolean {
  return HISTORICAL_STATUSES.has(candidate.lifecycleStatus) || Boolean(candidate.validTo);
}

// LV4-04-13: date-only comparisons, matching lifecycleFromListing's own
// validTo-inclusive-through-end-of-day convention
// (globalInstrumentMasterStore.ts). Mirrors globalInstrumentMaster.ts's own
// isValidAsOf -- duplicated per this file's own header note (search-box
// scoring is a distinct, simpler contract from structured resolution), not
// re-exported from there to avoid coupling this pure/sync module to that
// one's broader surface.
function parseDateOnlyTime(value: string, timeOfDay: string): number | null {
  const time = new Date(`${value}T${timeOfDay}`).getTime();
  return Number.isNaN(time) ? null : time;
}

// A candidate with neither validFrom nor validTo set (e.g. the bundled
// ~67k-row legacy ticker catalog, which never carries temporal metadata at
// all -- see legacyTickerCatalog.ts) has zero information to verify a
// point-in-time claim against, so it fails closed too, matching
// globalInstrumentMaster.ts's own isValidAsOf. Otherwise a legacy row with
// no validity data would falsely match any asOfDate whatsoever, defeating
// the feature's entire backtest purpose.
function isValidAsOf(candidate: InstrumentMasterCandidate, asOfDate: string): boolean {
  const asOf = parseDateOnlyTime(asOfDate, "12:00:00.000Z");
  if (asOf === null) return false;
  if (!candidate.validFrom && !candidate.validTo) return false;

  if (candidate.validFrom) {
    const from = parseDateOnlyTime(candidate.validFrom, "00:00:00.000Z");
    if (from === null || asOf < from) return false;
  }
  if (candidate.validTo) {
    const to = parseDateOnlyTime(candidate.validTo, "23:59:59.999Z");
    if (to === null || asOf > to) return false;
  }
  return true;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function tokenize(value: string | null | undefined): string[] {
  return normalizeText(value).split(" ").filter(Boolean);
}

/** Coarse bucket key length. A real index over the ~67k+ legacy universe
 * plus persisted identity rows needs sub-linear average-case lookup; three
 * characters keeps buckets small without the complexity of a full trie. */
const PREFIX_LENGTH = 3;

function prefixKeys(value: string): string[] {
  const normalized = normalizeText(value);
  if (!normalized) return [];
  const keys = new Set<string>();
  for (let length = 1; length <= Math.min(PREFIX_LENGTH, normalized.length); length++) {
    keys.add(normalized.slice(0, length));
  }
  return [...keys];
}

export interface InstrumentSearchIndex {
  readonly candidates: readonly InstrumentMasterCandidate[];
  readonly symbolBuckets: ReadonlyMap<string, readonly number[]>;
  readonly nameBuckets: ReadonlyMap<string, readonly number[]>;
}

function addToBucket(bucket: Map<string, number[]>, key: string, index: number): void {
  const existing = bucket.get(key);
  if (existing) existing.push(index);
  else bucket.set(key, [index]);
}

/**
 * Builds the in-process prefix index once for a given candidate set. Pure
 * and synchronous by design -- callers (instrumentSearchIndexStore.ts)
 * decide when/how often to rebuild against fresh data; this function never
 * touches a database or the filesystem itself.
 */
export function buildInstrumentSearchIndex(
  candidates: readonly InstrumentMasterCandidate[],
): InstrumentSearchIndex {
  const symbolBuckets = new Map<string, number[]>();
  const nameBuckets = new Map<string, number[]>();

  candidates.forEach((candidate, index) => {
    // An entity without a listing has no symbol to index; it stays findable by name and identifier.
    if (candidate.symbol) for (const key of prefixKeys(candidate.symbol)) addToBucket(symbolBuckets, key, index);
    for (const token of tokenize(candidate.name)) {
      for (const key of prefixKeys(token)) addToBucket(nameBuckets, key, index);
    }

    for (const alias of candidate.aliases ?? []) {
      if (alias.kind === "ticker") {
        for (const key of prefixKeys(alias.value)) addToBucket(symbolBuckets, key, index);
      } else {
        for (const token of tokenize(alias.value)) {
          for (const key of prefixKeys(token)) addToBucket(nameBuckets, key, index);
        }
      }
    }
  });

  return { candidates, symbolBuckets, nameBuckets };
}

export interface InstrumentSearchOptions {
  limit?: number;
  includeHistorical?: boolean;
  // LV4-04-13: supersedes includeHistorical when set -- see
  // globalInstrumentMaster.ts's InstrumentResolutionQuery.asOfDate for the
  // full rationale. ISO date (YYYY-MM-DD).
  asOfDate?: string;
}

export interface InstrumentSearchGroup {
  /** entityId when linked to canonical identity; otherwise a stable
   * synthetic key so repeated unlinked legacy rows for the same
   * name+symbol still collapse without inventing an entity. */
  groupKey: string;
  primary: InstrumentMasterCandidate;
  relatedListings: InstrumentMasterCandidate[];
  score: number;
}

export interface InstrumentSearchResult {
  query: string;
  groups: InstrumentSearchGroup[];
  source: "local" | "provider_fallback" | "none";
}

export interface InstrumentSearchFederatedFallback {
  search(queryText: string, options: InstrumentSearchOptions): Promise<InstrumentMasterCandidate[]>;
}

function groupKeyFor(candidate: InstrumentMasterCandidate): string {
  if (candidate.entityId) return candidate.entityId;
  return `legacy:${normalizeText(candidate.name)}:${normalizeText(candidate.symbol)}`;
}

/**
 * Scores a candidate against free-text query input. Deliberately simpler
 * than globalInstrumentMaster.ts's scoreCandidate(), which ranks a
 * structured resolution query (exact ticker/MIC/identifier fields) rather
 * than a single search box string; the two are not interchangeable because
 * a search box input has no field boundaries to match against.
 */
function scoreSearchCandidate(candidate: InstrumentMasterCandidate, queryText: string, asOfDate?: string): number {
  const query = normalizeText(queryText);
  if (!query) return 0;

  const symbol = normalizeText(candidate.symbol);
  const nameTokens = tokenize(candidate.name);
  const aliasSymbols = (candidate.aliases ?? [])
    .filter((alias) => alias.kind === "ticker")
    .map((alias) => normalizeText(alias.value));
  const aliasNameTokens = (candidate.aliases ?? [])
    .filter((alias) => alias.kind === "name")
    .flatMap((alias) => tokenize(alias.value));

  let score = 0;
  let matched = false;

  if (symbol === query) {
    score += 900;
    matched = true;
  } else if (symbol.startsWith(query) || aliasSymbols.some((value) => value === query || value.startsWith(query))) {
    score += 500;
    matched = true;
  }

  if (nameTokens.some((token) => token === query) || aliasNameTokens.some((token) => token === query)) {
    score += 400;
    matched = true;
  } else if (
    nameTokens.some((token) => token.startsWith(query)) ||
    aliasNameTokens.some((token) => token.startsWith(query))
  ) {
    score += 200;
    matched = true;
  } else if (normalizeText(candidate.name).startsWith(query)) {
    score += 150;
    matched = true;
  }

  if (!matched) return 0;

  // LV4-04-13: see globalInstrumentMaster.ts's scoreCandidate() for the
  // full rationale -- lifecycleStatus is "now"-relative and must not
  // penalize a candidate that already passed the isValidAsOf gate for the
  // requested date in searchInstrumentIndexLocal.
  if (asOfDate) {
    score += 100;
  } else if (candidate.lifecycleStatus === "active" || candidate.lifecycleStatus === "relisted") {
    score += 100;
  } else if (candidate.lifecycleStatus === "suspended") {
    score += 25;
  } else {
    score -= 120;
  }

  if (candidate.isPrimaryListing) score += 60;

  // Legacy compatibility rows rank below linked canonical identity for the
  // same query text, consistent with globalInstrumentMaster.ts's own
  // scoreCandidate() bias -- unlinked rows are still findable, never
  // preferred over identity LiOS already knows precisely.
  if (candidate.canonical) score += 40;
  else score -= 100;

  return score;
}

function collectCandidateIndices(index: InstrumentSearchIndex, queryText: string): number[] {
  const query = normalizeText(queryText);
  if (!query) return [];
  const key = query.slice(0, PREFIX_LENGTH);
  const indices = new Set<number>();
  for (const idx of index.symbolBuckets.get(key) ?? []) indices.add(idx);
  for (const idx of index.nameBuckets.get(key) ?? []) indices.add(idx);
  return [...indices];
}

function sortGroupMembers(
  members: readonly { candidate: InstrumentMasterCandidate; score: number }[],
): { candidate: InstrumentMasterCandidate; score: number }[] {
  return [...members].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.candidate.isPrimaryListing !== b.candidate.isPrimaryListing) {
      return a.candidate.isPrimaryListing ? -1 : 1;
    }
    return normalizeText(a.candidate.symbol).localeCompare(normalizeText(b.candidate.symbol));
  });
}

/**
 * Local-only search against an already-built index. Synchronous and pure
 * so it is fully unit-testable without a database or fixture provider.
 */
export function searchInstrumentIndexLocal(
  index: InstrumentSearchIndex,
  queryText: string,
  options: InstrumentSearchOptions = {},
): InstrumentSearchGroup[] {
  const includeHistorical = options.includeHistorical === true;
  const limit = options.limit && options.limit > 0 ? options.limit : 20;
  const asOfDate = options.asOfDate;

  const scored = collectCandidateIndices(index, queryText)
    .map((idx) => index.candidates[idx])
    .filter((candidate) => (asOfDate ? isValidAsOf(candidate, asOfDate) : includeHistorical || !isHistorical(candidate)))
    .map((candidate) => ({ candidate, score: scoreSearchCandidate(candidate, queryText, asOfDate) }))
    .filter((entry) => entry.score > 0);

  const groups = new Map<string, { candidate: InstrumentMasterCandidate; score: number }[]>();
  for (const entry of scored) {
    const key = groupKeyFor(entry.candidate);
    const existing = groups.get(key);
    if (existing) existing.push(entry);
    else groups.set(key, [entry]);
  }

  const results: InstrumentSearchGroup[] = [];
  for (const [groupKey, members] of groups) {
    const sortedMembers = sortGroupMembers(members);
    const [primaryEntry, ...rest] = sortedMembers;
    results.push({
      groupKey,
      primary: primaryEntry.candidate,
      relatedListings: rest.map((entry) => entry.candidate),
      score: primaryEntry.score,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return normalizeText(a.primary.symbol).localeCompare(normalizeText(b.primary.symbol));
  });

  return results.slice(0, limit);
}

/**
 * Local-first search. A federated fallback is consulted only when the local
 * index has zero matching groups -- an existing local match, however small,
 * is never diluted or reordered by a provider result. Mirrors
 * globalInstrumentMaster.ts's resolveInstrument() fallback discipline.
 */
export async function searchInstruments(
  index: InstrumentSearchIndex,
  queryText: string,
  options: InstrumentSearchOptions = {},
  fallback?: InstrumentSearchFederatedFallback,
): Promise<InstrumentSearchResult> {
  const localGroups = searchInstrumentIndexLocal(index, queryText, options);
  if (localGroups.length > 0 || !fallback) {
    return { query: queryText, groups: localGroups, source: localGroups.length > 0 ? "local" : "none" };
  }

  const providerCandidates = await fallback.search(queryText, options);
  const providerIndex = buildInstrumentSearchIndex(providerCandidates);
  const providerGroups = searchInstrumentIndexLocal(providerIndex, queryText, options);
  return {
    query: queryText,
    groups: providerGroups,
    source: providerGroups.length > 0 ? "provider_fallback" : "none",
  };
}
