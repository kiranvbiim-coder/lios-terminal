export interface SecuritySearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  assetClass?: string;
  region?: string;
}

/** Search rows are discovery evidence, not verified financial data or entitlement. */
export function isSecuritySearchResult(value: unknown): value is SecuritySearchResult {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SecuritySearchResult>;
  return typeof row.symbol === "string"
    && /^[A-Z^][A-Z0-9.^=_-]{0,24}$/i.test(row.symbol.trim())
    && typeof row.name === "string" && row.name.trim().length > 0
    && (row.exchange === undefined || typeof row.exchange === "string")
    && (row.assetClass === undefined || typeof row.assetClass === "string")
    && (row.region === undefined || typeof row.region === "string");
}

/** Enter/GO can open only one exact symbol returned by the active completed
 * search, never raw text, a fuzzy guess or the previous query's result. */
export function resolveVerifiedSecuritySelection(
  input: string,
  results: readonly SecuritySearchResult[],
  completedQuery: string | null,
): SecuritySearchResult | null {
  const query = input.trim().toUpperCase();
  if (!query || !completedQuery || completedQuery.trim().toUpperCase() !== query) return null;
  const matching = results.filter((row) => isSecuritySearchResult(row) && row.symbol.trim().toUpperCase() === query);
  return matching.length === 1 ? matching[0] : null;
}

function securitySearchScore(result: SecuritySearchResult, rawQuery: string): number {
  const query = rawQuery.trim().toUpperCase();
  const symbol = result.symbol.toUpperCase();
  const name = result.name.toUpperCase();
  let score = 0;

  if (symbol === query) score += 1_000;
  else if (symbol.startsWith(query)) score += 700;
  else if (symbol.includes(query)) score += 400;

  if (name === query) score += 900;
  else if (name.startsWith(query)) score += 650;
  else if (name.split(/\s+/).some((word) => word.startsWith(query))) score += 350;
  else if (name.includes(query)) score += 200;

  // Asset class and exchange are tie-breakers for actual matches; they must
  // never turn unrelated backend rows into apparent security search results.
  if (score === 0) return 0;
  if (result.assetClass?.toLowerCase() === "equity") score += 75;
  if (result.assetClass?.toLowerCase() === "crypto" && symbol !== query) score -= 600;
  if (result.exchange && result.exchange.toUpperCase() !== "CRYPTO") score += 20;
  return score;
}

export function rankSecuritySearchResults(
  results: SecuritySearchResult[],
  query: string,
  limit = 12,
): SecuritySearchResult[] {
  if (!query.trim()) return [];
  return results
    .filter(isSecuritySearchResult)
    .map((result, index) => ({ result, index, score: securitySearchScore(result, query) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ result }) => result);
}
