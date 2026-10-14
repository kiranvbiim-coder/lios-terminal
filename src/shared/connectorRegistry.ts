/**
 * Connector registry: every external/private data source enters LiOS through
 * a declared connector.  This module defines the *shape* and the *built-in*
 * set; user-added connectors are stored in the DB but share the same
 * ConnectorDefinition interface.
 *
 * Shared between server + client — keep it free of Node/browser-only imports.
 */

export type ConnectorSourceType =
  | "public_api"
  | "keyed_api"
  | "file"
  | "database"
  | "private_api"
  | "cloud_storage"
  | "sidecar"
  | "local_model"
  | "mcp";

export type ConnectorAuthMode =
  | "none"
  | "api_key"
  | "bearer"
  | "basic"
  | "oauth"
  | "database_credentials"
  | "local";

export type ConnectorCategory =
  | "market"
  | "fundamentals"
  | "macro"
  | "filings"
  | "research"
  | "platform"
  | "ai"
  | "private_data"
  | "operations"
  | "crypto";

export type ConnectorCustodyMode =
  | "public"       // freely available public data
  | "user_licensed" // user provides their own license/key
  | "local_only"   // data stays local, never leaves machine
  | "client_private"; // org-scoped private data

/**
 * Truthful runtime state for a connector, distinguishing five separate
 * facts that a naive "healthy" boolean used to conflate:
 *  - whether adapter code exists at all (adapterImplemented, on
 *    ConnectorDefinition) vs. this being a pure catalog entry
 *  - whether the prerequisites (a credential, if one is required) are met
 *  - whether the adapter has actually been exercised against the vendor's
 *    real API and what the most recent outcome was
 *  - whether the vendor is currently rate-limiting local requests
 *  - whether the connector has been explicitly disabled by configuration
 *
 * States, in the order a connector normally progresses through them:
 *  catalog_only         -- listed here, but no adapter code calls this
 *                           vendor's API anywhere in the codebase yet.
 *  adapter_available     -- adapter code exists and is ready to run, but a
 *                           required credential is missing (keyed_api) or
 *                           it has never actually been exercised.
 *  credential_configured -- ready to run (credential present, or none
 *                           required) but not yet confirmed against a real
 *                           call this process's lifetime.
 *  live_verified          -- ready to run, and the most recent real call
 *                           against the vendor's API succeeded.
 *  degraded               -- ready to run, but the most recent real call
 *                           failed.
 *  rate_limited            -- the vendor rejected a recent request with
 *                           HTTP 429; requests are paused locally.
 *  disabled                -- explicitly turned off by configuration.
 *
 * Deliberately process-local, not persisted: a "verified" claim surviving
 * a restart without a new real call would itself be a fabrication.
 */
export type ConnectorRuntimeState =
  | "catalog_only"
  | "adapter_available"
  | "credential_configured"
  | "live_verified"
  | "degraded"
  | "rate_limited"
  | "disabled";

export interface ConnectorCapability {
  /** Semantic contract family this connector can partially/fully satisfy */
  contractFamily: string;
  /** Specific fields or coverage this connector provides */
  fields?: string[];
  /** Coverage region/exchange/instrument restrictions */
  coverage?: string;
}

/**
 * Free/public access to a data source is not the same claim as having the
 * right to redistribute or commercially display it. This never asserts a
 * specific vendor's actual terms (that would be a fabricated legal claim);
 * it surfaces the vendor's own `licenseNotes` when the catalog has them,
 * or an advisory prompt to go verify when the connector's shape suggests
 * license terms are likely to matter.
 */
export function getConnectorLicenseCaveat(connector: ConnectorDefinition): string | null {
  if (connector.licenseNotes) return connector.licenseNotes;
  if (connector.custodyMode === "user_licensed") {
    return "Requires your own account with the vendor. A free or trial plan's terms of service typically do not include redistribution, commercial display, or downstream-client rights -- confirm your plan's license before using this data in a client-facing deliverable.";
  }
  if (connector.freeTier) {
    return "Free/public-tier data source. Free access does not by itself confirm redistribution or commercial-use rights -- verify the vendor's terms of service for your intended use.";
  }
  return null;
}

/** True when a connector is ready to serve requests right now, based on its most recently observed state. */
export function isConnectorRuntimeOperational(state: ConnectorRuntimeState): boolean {
  return state === "live_verified" || state === "credential_configured";
}

export interface ConnectorDefinition {
  id: string;
  name: string;
  category: ConnectorCategory;
  sourceType: ConnectorSourceType;
  authMode: ConnectorAuthMode;
  custodyMode: ConnectorCustodyMode;

  /** Env var name for credential lookup */
  envKey?: string;
  /** Vault key name for credential lookup */
  vaultKey?: string;

  /** Whether real fetch/SDK code in this codebase actually calls this vendor's API, as opposed to this being a catalog-only listing awaiting implementation. */
  adapterImplemented: boolean;

  /** What data contracts this connector can satisfy */
  capabilities: ConnectorCapability[];

  /** Human-readable setup instructions */
  setupGuide: string;
  /** Whether this connector is a built-in or user-added */
  builtIn: boolean;

  /** Rate limit documentation */
  rateLimits?: string;
  /** License restrictions documentation */
  licenseNotes?: string;

  /** URL to provider's website */
  websiteUrl?: string;
  /** Short one-line description */
  description?: string;
  /** Whether this has a free tier */
  freeTier?: boolean;
}

export interface ConnectorRuntimeReport {
  connectorId: string;
  state: ConnectorRuntimeState;
  detail: string;
  checkedAt: string;
  adapterImplemented: boolean;
  /** ISO timestamp of the most recent real call that succeeded, or null if none has been observed this process's lifetime. */
  lastVerifiedAt: string | null;
}

export interface ConnectorRegistrySnapshot {
  connectors: ConnectorDefinition[];
  health: ConnectorRuntimeReport[];
}

// ─── Built-in connector definitions ───────────────────────────────────────

export const BUILT_IN_CONNECTORS: ConnectorDefinition[] = [
  // Market data
  {
    id: "fred",
    name: "FRED (Federal Reserve Economic Data)",
    category: "macro",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "FRED_API_KEY",
    vaultKey: "fredApiKey",
    capabilities: [
      { contractFamily: "macro", fields: ["gdp", "cpi", "unemployment", "rates", "yield_curve"], coverage: "US" },
      { contractFamily: "price_history", fields: ["economic_series"], coverage: "US" },
    ],
    setupGuide: "Register at https://fred.stlouisfed.org/docs/api/api_key.html for a free API key.",
    builtIn: true,
    rateLimits: "120 requests/minute on free tier.",
    websiteUrl: "https://fred.stlouisfed.org",
    description: "US Federal Reserve economic time-series covering GDP, CPI, rates, and yield curves.",
    freeTier: true,
  },
  {
    id: "finnhub",
    name: "Finnhub",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "FINNHUB_API_KEY",
    vaultKey: "finnhubApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote", "trades"], coverage: "US equities" },
      { contractFamily: "financial_statements", fields: ["income_statement", "balance_sheet", "cash_flow"], coverage: "US" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "US equities" },
      { contractFamily: "filings", fields: ["sec_filings"], coverage: "US" },
    ],
    setupGuide: "Register at https://finnhub.io for a free API key.",
    builtIn: true,
    rateLimits: "60 calls/minute on free tier. WebSocket: 50 symbols.",
    websiteUrl: "https://finnhub.io",
    description: "Real-time US equity quotes, financials, SEC filings, and WebSocket streaming.",
    freeTier: true,
  },
  {
    id: "lse",
    name: "London Strategic Edge",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "LSE_API_KEY",
    vaultKey: "lseApiKey",
    capabilities: [
      { contractFamily: "instrument_identity", fields: ["provider_symbol", "catalogue", "canonical_mapping"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "market_data", fields: ["live_ticks", "candles"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "price_history", fields: ["ohlcv", "parquet_export"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "financial_statements", fields: ["financial_reports"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "company", fields: ["profile", "snapshot_fundamentals"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "ownership", fields: ["insider_trades"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "derivatives", fields: ["options_chain", "options_flow", "option_candles", "live_option_ticks"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "macro", fields: ["economic_series", "economic_calendar", "bond_yields", "cot"], coverage: "runtime-discovered from provider catalogue" },
      { contractFamily: "corporate_actions", fields: ["dividends", "stock_splits"], coverage: "runtime-discovered from provider catalogue" },
    ],
    setupGuide: "Connect your own LSE data key in Connection Center. LiOS verifies it against /vault/usage and discovers actual catalogue/meta capabilities at runtime.",
    builtIn: true,
    rateLimits: "Plan quota and usage are read from the provider at runtime; LiOS does not hardcode a marketing limit.",
    websiteUrl: "https://londonstrategicedge.com",
    description: "Optional user-key market-data provider. LiOS treats the live provider catalogue/meta response as the breadth authority.",
    licenseNotes: "The verified MIT license covers the upstream client code, not rights in hosted data. LiOS keeps LSE BYOD local, blocks redistribution/resale/central cache use, and treats external data rights as a separate release gate.",
    freeTier: true,
  },
  {
    id: "simfin",
    name: "SimFin",
    category: "fundamentals",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "SIMFIN_API_KEY",
    vaultKey: "simfinApiKey",
    capabilities: [
      { contractFamily: "financial_statements", fields: ["income_statement", "balance_sheet", "cash_flow"], coverage: "global" },
    ],
    setupGuide: "Register at https://simfin.com for a free API key.",
    builtIn: true,
    websiteUrl: "https://simfin.com",
    description: "Standardized global financial statements and ratios.",
    freeTier: true,
  },
  {
    id: "fmp",
    name: "Financial Modeling Prep",
    category: "fundamentals",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "FMP_API_KEY",
    vaultKey: "fmpApiKey",
    capabilities: [
      { contractFamily: "financial_statements", fields: ["income_statement", "balance_sheet", "cash_flow"], coverage: "global" },
      { contractFamily: "estimates", fields: ["revenue", "eps", "ebitda"], coverage: "US" },
      { contractFamily: "market_data", fields: ["quote", "ratios", "earnings_calendar"], coverage: "global" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
      { contractFamily: "ownership", fields: ["institutional_holders"], coverage: "US" },
    ],
    setupGuide: "Register at https://financialmodelingprep.com for a free API key.",
    builtIn: true,
    rateLimits: "250 calls/day on free tier.",
    websiteUrl: "https://financialmodelingprep.com",
    description: "Financial statements, estimates, ratios, and price history with global coverage.",
    freeTier: true,
  },

  {
    id: "openfigi",
    name: "OpenFIGI",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "OPENFIGI_API_KEY",
    vaultKey: "openFigiApiKey",
    capabilities: [
      { contractFamily: "instrument_identity", fields: ["figi", "composite_figi", "share_class_figi", "ticker", "name", "exchange", "security_type"], coverage: "global" },
    ],
    setupGuide: "Add your OpenFIGI API key in Connection Center. LiOS also supports the lower-rate unauthenticated API only when explicitly invoked outside the keyed connector path.",
    builtIn: true,
    rateLimits: "OpenFIGI v3 mapping: 25 requests per 6 seconds with API key; search/filter: 20 requests per minute. Response rate-limit headers are honored.",
    websiteUrl: "https://www.openfigi.com",
    description: "Global financial-instrument identity mapping and search for FIGI, Composite FIGI, Share Class FIGI, ticker and related symbology.",
    freeTier: true,
  },

  // Public data (no key)
  {
    id: "sec_edgar",
    name: "SEC EDGAR",
    category: "filings",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "filings", fields: ["10-K", "10-Q", "8-K", "DEF14A"], coverage: "US" },
      { contractFamily: "financial_statements", fields: ["xbrl_income", "xbrl_balance", "xbrl_cashflow"], coverage: "US" },
    ],
    setupGuide: "No key required. Uses SEC EDGAR XBRL and full-text search APIs.",
    builtIn: true,
    rateLimits: "10 requests/second (SEC fair access policy).",
    websiteUrl: "https://www.sec.gov/edgar",
    description: "Official SEC filings including 10-K, 10-Q, 8-K, and XBRL financial data.",
    freeTier: true,
  },
  {
    id: "world_bank",
    name: "World Bank",
    category: "macro",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "macro", fields: ["gdp", "population", "trade", "poverty"], coverage: "global" },
    ],
    setupGuide: "No key required.",
    builtIn: true,
    websiteUrl: "https://data.worldbank.org",
    description: "Global development indicators including GDP, population, trade, and poverty.",
    freeTier: true,
  },
  {
    id: "imf",
    name: "International Monetary Fund",
    category: "macro",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "macro", fields: ["gdp", "inflation", "unemployment", "current_account", "fiscal_balance"], coverage: "global DataMapper indicators requested by explicit indicator + country/entity code" },
    ],
    setupGuide: "No key required. Uses the IMF DataMapper API v2 with explicit indicator and country/entity codes; LiOS preserves the exact provider URL as provenance.",
    builtIn: true,
    websiteUrl: "https://data.imf.org",
    description: "Public IMF DataMapper macro series through the current v2 API. Availability remains subject to the IMF endpoint and the requested indicator/entity coverage.",
    freeTier: true,
  },
  {
    id: "bls",
    name: "Bureau of Labor Statistics",
    category: "macro",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "macro", fields: ["cpi", "employment", "wages"], coverage: "US" },
    ],
    setupGuide: "No key required for v1 API.",
    builtIn: true,
    websiteUrl: "https://www.bls.gov",
    description: "US labor market statistics including CPI, employment, and wages.",
    freeTier: true,
  },

  // Market data — additional providers
  {
    id: "yahoo_finance",
    name: "Yahoo Finance",
    category: "market",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "market_data", fields: ["quote", "ohlcv"], coverage: "global" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
    ],
    setupGuide: "No key required. Uses the public Yahoo Finance endpoints.",
    builtIn: true,
    websiteUrl: "https://finance.yahoo.com",
    description: "Free global equity quotes and historical OHLCV price data.",
    freeTier: true,
  },
  {
    id: "bse_india",
    name: "BSE India",
    category: "market",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "market_data", fields: ["quote"], coverage: "BSE-listed securities" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "BSE bhavcopy-supported securities" },
      { contractFamily: "corporate_actions", fields: ["splits", "bonus"], coverage: "BSE-listed securities" },
    ],
    setupGuide: "No API key required. LiOS uses the BSE quote/bhavcopy adapters and preserves corporate-action adjustment provenance.",
    builtIn: true,
    websiteUrl: "https://www.bseindia.com",
    description: "Official BSE public-market paths used by LiOS for BSE quotes, historical bhavcopy data, and adjustment inputs.",
    freeTier: true,
  },
  {
    id: "stooq",
    name: "Stooq",
    category: "market",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "market_data", fields: ["quote"], coverage: "fallback coverage varies by symbol" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "daily historical fallback where available" },
    ],
    setupGuide: "No API key required. LiOS uses Stooq only as a governed public fallback when preferred market-data paths do not return usable observations.",
    builtIn: true,
    websiteUrl: "https://stooq.com",
    description: "Public daily market-data fallback. P3 marks Stooq evidence as fallback rather than presenting it as the primary source.",
    freeTier: true,
  },
  {
    id: "alpha_vantage",
    name: "Alpha Vantage",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "ALPHA_VANTAGE_API_KEY",
    vaultKey: "alphaVantageApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote"], coverage: "global" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
      { contractFamily: "financial_statements", fields: ["income_statement", "balance_sheet", "cash_flow"], coverage: "US" },
    ],
    setupGuide: "Register at https://www.alphavantage.co/support/#api-key for a free API key.",
    builtIn: true,
    rateLimits: "25 calls/day on free tier.",
    websiteUrl: "https://www.alphavantage.co",
    description: "Market data, price history, and financial statements with a generous free tier.",
    freeTier: true,
  },
  {
    id: "polygon",
    name: "Polygon.io",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "POLYGON_API_KEY",
    vaultKey: "polygonApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote", "trades", "aggregates"], coverage: "US equities" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "US equities" },
    ],
    setupGuide: "Register at https://polygon.io for a free API key.",
    builtIn: true,
    rateLimits: "5 calls/minute on free tier.",
    websiteUrl: "https://polygon.io",
    description: "US equity and options market data with real-time and historical aggregates.",
    freeTier: true,
  },
  {
    id: "twelve_data",
    name: "Twelve Data",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "TWELVE_DATA_API_KEY",
    vaultKey: "twelveDataApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote"], coverage: "global" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
      { contractFamily: "forex", fields: ["exchange_rates"], coverage: "global" },
    ],
    setupGuide: "Register at https://twelvedata.com for a free API key.",
    builtIn: true,
    rateLimits: "800 calls/day on free tier.",
    websiteUrl: "https://twelvedata.com",
    description: "Global equities, forex, and crypto market data with real-time and historical coverage.",
    freeTier: true,
  },
  {
    id: "tiingo",
    name: "Tiingo",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "TIINGO_API_KEY",
    vaultKey: "tiingoApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote"], coverage: "US equities" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "US equities" },
      { contractFamily: "news", fields: ["articles"], coverage: "US" },
    ],
    setupGuide: "Register at https://api.tiingo.com for a free API key.",
    builtIn: true,
    websiteUrl: "https://www.tiingo.com",
    description: "US equity end-of-day data, IEX real-time prices, and curated financial news.",
    freeTier: true,
  },
  {
    id: "eodhd",
    name: "EODHD",
    category: "market",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "EODHD_API_KEY",
    vaultKey: "eodhdApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote"], coverage: "global" },
      { contractFamily: "financial_statements", fields: ["income_statement", "balance_sheet", "cash_flow"], coverage: "global" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
    ],
    setupGuide: "Register at https://eodhd.com for an API key. Free trial available.",
    builtIn: true,
    websiteUrl: "https://eodhd.com",
    description: "Global end-of-day and intraday data covering 70+ exchanges and fundamentals.",
    freeTier: false,
  },
  {
    id: "intrinio",
    name: "Intrinio",
    category: "fundamentals",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: false,
    envKey: "INTRINIO_API_KEY",
    vaultKey: "intrinioApiKey",
    capabilities: [
      { contractFamily: "financial_statements", fields: ["income_statement", "balance_sheet", "cash_flow"], coverage: "US" },
      { contractFamily: "market_data", fields: ["quote"], coverage: "US equities" },
      { contractFamily: "estimates", fields: ["revenue", "eps"], coverage: "US" },
    ],
    setupGuide: "Register at https://intrinio.com for an enterprise API key.",
    builtIn: true,
    websiteUrl: "https://intrinio.com",
    description: "Enterprise-grade US financial data including statements, estimates, and real-time prices.",
    freeTier: false,
  },
  {
    id: "nasdaq_data_link",
    name: "Nasdaq Data Link (Quandl)",
    category: "macro",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: false,
    envKey: "NASDAQ_DATA_LINK_API_KEY",
    vaultKey: "nasdaqDataLinkApiKey",
    capabilities: [
      { contractFamily: "macro", fields: ["gdp", "rates", "commodities"], coverage: "global" },
      { contractFamily: "price_history", fields: ["ohlcv"], coverage: "global" },
    ],
    setupGuide: "Register at https://data.nasdaq.com for a free API key.",
    builtIn: true,
    websiteUrl: "https://data.nasdaq.com",
    description: "Curated macro and financial datasets formerly known as Quandl.",
    freeTier: true,
  },

  // Crypto
  {
    id: "coinmarketcap",
    name: "CoinMarketCap",
    category: "crypto",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "public",
    adapterImplemented: true,
    envKey: "COINMARKETCAP_API_KEY",
    vaultKey: "coinmarketcapApiKey",
    capabilities: [
      { contractFamily: "market_data", fields: ["quote", "market_cap", "volume"], coverage: "crypto" },
    ],
    setupGuide: "Register at https://coinmarketcap.com/api/ for a free API key.",
    builtIn: true,
    rateLimits: "333 calls/day on free tier.",
    websiteUrl: "https://coinmarketcap.com",
    description: "Cryptocurrency market capitalizations, rankings, and pricing data.",
    freeTier: true,
  },
  {
    id: "coingecko",
    name: "CoinGecko",
    category: "crypto",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "market_data", fields: ["quote", "market_cap", "volume", "ohlcv"], coverage: "crypto" },
    ],
    setupGuide: "No key required. Uses the public CoinGecko API.",
    builtIn: true,
    rateLimits: "10-30 calls/minute on public API.",
    websiteUrl: "https://www.coingecko.com",
    description: "Free cryptocurrency market data including prices, volumes, and historical charts.",
    freeTier: true,
  },

  // Macro — additional providers
  {
    id: "oecd",
    name: "OECD",
    category: "macro",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "macro", fields: ["gdp", "trade", "employment"], coverage: "OECD Data Explorer datasets requested through explicit agency + dataset + bounded data selection" },
    ],
    setupGuide: "No key required. Use the OECD Data Explorer Developer API to copy the agency, dataset and bounded data selection; LiOS preserves the exact SDMX request as provenance.",
    builtIn: true,
    websiteUrl: "https://data-explorer.oecd.org",
    description: "OECD Data Explorer macro observations through the current public SDMX REST API. Dataset dimensions remain provider-native and explicit.",
    freeTier: true,
  },
  {
    id: "ecb",
    name: "European Central Bank",
    category: "macro",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "macro", fields: ["rates", "money_supply", "forex"], coverage: "ECB Data Portal series requested through explicit dataflow + series key" },
    ],
    setupGuide: "No key required. Uses the ECB Data Portal API. Supply an ECB dataflow and series key; LiOS bounds each request and preserves provider provenance.",
    builtIn: true,
    websiteUrl: "https://data.ecb.europa.eu",
    description: "Eurozone monetary policy rates, money supply aggregates, and exchange rates.",
    freeTier: true,
  },
  {
    id: "rbi",
    name: "Reserve Bank of India",
    category: "macro",
    sourceType: "public_api",
    authMode: "none",
    custodyMode: "public",
    adapterImplemented: false,
    capabilities: [
      { contractFamily: "macro", fields: ["rates", "inflation", "forex"], coverage: "India" },
    ],
    setupGuide: "RBI DBIE is available as a public data/query/download portal. LiOS does not claim a stable public RBI API in this build; use DBIE exports as user-owned imports until RBI publishes a documented machine API contract.",
    builtIn: true,
    websiteUrl: "https://data.rbi.org.in",
    description: "Indian macro-financial data from RBI DBIE. Catalogued for discovery/import today; live API execution remains unavailable until RBI exposes a stable documented public API contract.",
    freeTier: true,
  },

  // AI providers
  {
    id: "anthropic",
    name: "Anthropic",
    category: "ai",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "ANTHROPIC_API_KEY",
    vaultKey: "anthropicApiKey",
    capabilities: [
      { contractFamily: "ai", fields: ["chat", "analysis", "memo_drafting", "research"] },
    ],
    setupGuide: "Set ANTHROPIC_API_KEY or add anthropicApiKey to the credential vault.",
    builtIn: true,
    websiteUrl: "https://www.anthropic.com",
    description: "Claude AI for chat, analysis, memo drafting, and research tasks.",
    freeTier: false,
  },
  {
    id: "gemini",
    name: "Google Gemini",
    category: "ai",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "GEMINI_API_KEY",
    vaultKey: "geminiApiKey",
    capabilities: [
      { contractFamily: "ai", fields: ["chat", "news_analysis", "field_mapping"] },
    ],
    setupGuide: "Set GEMINI_API_KEY or add geminiApiKey to the credential vault.",
    builtIn: true,
    websiteUrl: "https://ai.google.dev",
    description: "Google Gemini AI for chat, news analysis, and data field mapping.",
    freeTier: true,
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "OPENAI_API_KEY",
    vaultKey: "openaiApiKey",
    capabilities: [
      { contractFamily: "ai", fields: ["chat", "analysis", "embeddings"] },
    ],
    setupGuide: "Set OPENAI_API_KEY or add openaiApiKey to the credential vault.",
    builtIn: true,
    websiteUrl: "https://openai.com",
    description: "OpenAI GPT models for chat, analysis, and text embeddings.",
    freeTier: false,
  },
  {
    id: "mistral",
    name: "Mistral AI",
    category: "ai",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "MISTRAL_API_KEY",
    vaultKey: "mistralApiKey",
    capabilities: [
      { contractFamily: "ai", fields: ["chat", "analysis"] },
    ],
    setupGuide: "Set MISTRAL_API_KEY or add mistralApiKey to the credential vault.",
    builtIn: true,
    websiteUrl: "https://mistral.ai",
    description: "Mistral AI models for chat and analytical tasks.",
    freeTier: true,
  },
  {
    id: "groq",
    name: "Groq",
    category: "ai",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "GROQ_API_KEY",
    vaultKey: "groqApiKey",
    capabilities: [
      { contractFamily: "ai", fields: ["chat", "fast_inference"] },
    ],
    setupGuide: "Set GROQ_API_KEY or add groqApiKey to the credential vault.",
    builtIn: true,
    websiteUrl: "https://groq.com",
    description: "Ultra-fast LPU inference for chat and real-time AI workloads.",
    freeTier: true,
  },
  {
    id: "together",
    name: "Together AI",
    category: "ai",
    sourceType: "keyed_api",
    authMode: "api_key",
    custodyMode: "user_licensed",
    adapterImplemented: true,
    envKey: "TOGETHER_API_KEY",
    vaultKey: "togetherApiKey",
    capabilities: [
      { contractFamily: "ai", fields: ["chat", "embeddings"] },
    ],
    setupGuide: "Set TOGETHER_API_KEY or add togetherApiKey to the credential vault.",
    builtIn: true,
    websiteUrl: "https://www.together.ai",
    description: "Open-source model hosting for chat, embeddings, and fine-tuned inference.",
    freeTier: true,
  },

  // BYOD placeholder connectors
  {
    id: "file_upload",
    name: "File Upload (Excel/CSV/JSON/Parquet/XML)",
    category: "private_data",
    sourceType: "file",
    authMode: "none",
    custodyMode: "local_only",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "financial_statements" },
      { contractFamily: "portfolio" },
      { contractFamily: "fixed_income" },
      { contractFamily: "derivatives" },
      { contractFamily: "operations" },
      { contractFamily: "assumptions" },
    ],
    setupGuide: "Upload files through the BYOD panel or workspace import.",
    builtIn: true,
    description: "Import spreadsheets, CSVs, JSON, Parquet, or XML files as local data sources.",
    freeTier: true,
  },
  {
    id: "database",
    name: "Database Connector (PostgreSQL/MySQL/SQLite/DuckDB)",
    category: "private_data",
    sourceType: "database",
    authMode: "database_credentials",
    custodyMode: "client_private",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "financial_statements" },
      { contractFamily: "portfolio" },
      { contractFamily: "operations" },
      { contractFamily: "assumptions" },
    ],
    setupGuide: "Add database credentials through the connector management panel.",
    builtIn: true,
    description: "Connect to relational databases for portfolio, financial, and operational data.",
    freeTier: true,
  },
  {
    id: "cloud_storage",
    name: "Cloud/Object Storage Connector",
    category: "private_data",
    sourceType: "cloud_storage",
    authMode: "bearer",
    custodyMode: "client_private",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "provider_extension", fields: ["json", "csv", "text", "object"], coverage: "user-configured" },
    ],
    setupGuide: "Configure an HTTPS object/presigned endpoint and optional vault credential. LiOS applies endpoint, size and tenant policies before reading.",
    builtIn: true,
    description: "Governed user-owned cloud/object-storage reads without storing raw credentials in connector configuration.",
    freeTier: true,
  },
  {
    id: "mcp_source",
    name: "MCP Server Connector",
    category: "private_data",
    sourceType: "mcp",
    authMode: "bearer",
    custodyMode: "client_private",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "provider_extension", fields: ["tools", "resources"], coverage: "server-defined" },
    ],
    setupGuide: "Configure a trusted MCP HTTPS endpoint and a credential reference. Tool/resource access remains Project-scoped and approval-gated.",
    builtIn: true,
    description: "Connect to a governed external Model Context Protocol server without exposing LiOS filesystem, credentials, or internal state.",
    freeTier: true,
  },
  {
    id: "private_api",
    name: "Private API Connector (REST/GraphQL)",
    category: "private_data",
    sourceType: "private_api",
    authMode: "bearer",
    custodyMode: "client_private",
    adapterImplemented: true,
    capabilities: [
      { contractFamily: "financial_statements" },
      { contractFamily: "market_data" },
      { contractFamily: "portfolio" },
      { contractFamily: "operations" },
    ],
    setupGuide: "Configure a private API endpoint and credentials in the connector panel.",
    builtIn: true,
    description: "Connect to internal REST or GraphQL APIs for proprietary data feeds.",
    freeTier: true,
  },
];
