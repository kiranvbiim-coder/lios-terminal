import { inferCurrencyFromSymbol } from "./finance";

export type PortfolioValuationReason = "empty" | "ready" | "missing_quotes" | "mixed_currency";

export interface PortfolioTruthHolding {
  symbol: string;
  quoteCurrency?: string | null;
  hasLivePrice: boolean;
}

export interface PortfolioValuationCoverage {
  currencyCodes: string[];
  pricedCount: number;
  holdingCount: number;
  allPriced: boolean;
  singleCurrency: boolean;
  canAggregateWeights: boolean;
  reason: PortfolioValuationReason;
}

export function resolveHoldingCurrency(symbol: string, quoteCurrency?: string | null): string {
  const authoritative = quoteCurrency?.trim();
  return authoritative || inferCurrencyFromSymbol(symbol);
}

export function evaluatePortfolioValuationCoverage(holdings: readonly PortfolioTruthHolding[]): PortfolioValuationCoverage {
  const currencyCodes = [...new Set(holdings.map((holding) => resolveHoldingCurrency(holding.symbol, holding.quoteCurrency)))];
  const pricedCount = holdings.filter((holding) => holding.hasLivePrice).length;
  const holdingCount = holdings.length;
  const allPriced = holdingCount > 0 && pricedCount === holdingCount;
  const singleCurrency = currencyCodes.length <= 1;
  const canAggregateWeights = holdingCount > 0 && allPriced && singleCurrency;

  const reason: PortfolioValuationReason = holdingCount === 0
    ? "empty"
    : !singleCurrency
      ? "mixed_currency"
      : !allPriced
        ? "missing_quotes"
        : "ready";

  return { currencyCodes, pricedCount, holdingCount, allPriced, singleCurrency, canAggregateWeights, reason };
}
