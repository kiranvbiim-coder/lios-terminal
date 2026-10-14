export interface SecuritySearchResult {
  symbol: string;
  name: string;
  exchange?: string;
  assetClass?: string;
  region?: string;
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
  return results
    .map((result, index) => ({ result, index, score: securitySearchScore(result, query) }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, limit)
    .map(({ result }) => result);
}
