/**
 * One market-data access policy for every ticker surface.
 *
 * A market-data provider may serve a person only when that person selected it in Connections, and, for
 * unofficial/community sources on the retail profile, only after that person accepted its consent.
 * The server enforces this with `isProviderAuthorizedBySelection` (server/marketDataScope.ts); the
 * first-run step and empty states use `decideMarketDataAccess` to explain it, so the rule is written once.
 */

/** Connectors the price router can serve quotes or history from. A selection of any other source does not enable ticker data. */
export const MARKET_DATA_SOURCE_IDS = [
  "yahoo_finance",
  "bse_india",
  "coingecko",
  "stooq",
  "twelve_data",
  "tiingo",
  "eodhd",
  "polygon",
  "alpha_vantage",
  "coinmarketcap",
] as const;

export type MarketDataSourceId = (typeof MARKET_DATA_SOURCE_IDS)[number];

const MARKET_DATA_SOURCE_SET: ReadonlySet<string> = new Set(MARKET_DATA_SOURCE_IDS);

export function isMarketDataSourceId(id: string): id is MarketDataSourceId {
  return MARKET_DATA_SOURCE_SET.has(id);
}

/** The scope fields the policy reads. `ResolvedMarketDataScope` satisfies this. */
export interface MarketDataSelection {
  readonly selectedConnectorIds: readonly string[];
  readonly retail: boolean;
  readonly communityYahooConsent: boolean;
  readonly publicFillerConsent: boolean;
}

/** Why a selection cannot serve ticker data. Carried on `DataStatus.reason` so every surface can explain it. */
export const MARKET_DATA_GAP_REASONS = ["no_source_selected", "consent_required"] as const;
export type MarketDataGapReason = (typeof MARKET_DATA_GAP_REASONS)[number];

/** Shown wherever ticker data is missing because nothing is selected. Plain language; names where to fix it. */
export const NO_MARKET_SOURCE_MESSAGE = "No market-data source selected. Open Connections.";
/** The same gap as an action, used as a recovery step in chat data gaps. */
export const CHOOSE_MARKET_SOURCE_ACTION = "Choose a market-data source in Connections";
export const MARKET_CONSENT_MESSAGE = "Your selected market-data source needs your consent. Open Connections.";

/** Selection-only authorization of one provider. Unscoped (no signed-in owner) work is decided by the caller. */
export function isProviderAuthorizedBySelection(providerId: string, selection: MarketDataSelection): boolean {
  if (!selection.selectedConnectorIds.includes(providerId)) return false;
  if (providerId === "yahoo_finance") return !selection.retail || selection.communityYahooConsent;
  if (providerId === "stooq") return !selection.retail || selection.publicFillerConsent;
  return true;
}

export type MarketDataAccess =
  | { state: "ready"; usable: string[]; blocked: string[] }
  | { state: "no_source_selected"; usable: []; blocked: []; reason: "no_source_selected"; message: string }
  | { state: "consent_required"; usable: []; blocked: string[]; reason: "consent_required"; message: string };

/**
 * ready: at least one selected price source may serve this person.
 * consent_required: sources are selected, but every one of them waits for a consent not yet given.
 * no_source_selected: nothing that can serve prices is selected.
 */
export function decideMarketDataAccess(selection: MarketDataSelection): MarketDataAccess {
  const selected = MARKET_DATA_SOURCE_IDS.filter((id) => selection.selectedConnectorIds.includes(id));
  if (!selected.length) {
    return { state: "no_source_selected", usable: [], blocked: [], reason: "no_source_selected", message: NO_MARKET_SOURCE_MESSAGE };
  }
  const usable = selected.filter((id) => isProviderAuthorizedBySelection(id, selection));
  if (usable.length) return { state: "ready", usable, blocked: selected.filter((id) => !usable.includes(id)) };
  return { state: "consent_required", usable: [], blocked: [...selected], reason: "consent_required", message: MARKET_CONSENT_MESSAGE };
}
