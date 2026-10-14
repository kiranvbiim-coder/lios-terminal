export interface CatalogProvider {
  id: string;
  name: string;
  category:
    | "market"
    | "fundamentals"
    | "macro"
    | "filings"
    | "crypto"
    | "ai"
    | "alt_data"
    | "storage";
  description: string;
  defaultEndpoint?: string;
  authType:
    | "api_key"
    | "bearer"
    | "oauth"
    | "database_credentials"
    | "none";
  signupUrl?: string;
  defaultSourceType?:
    | "keyed_api"
    | "public_api"
    | "database"
    | "cloud_storage"
    | "sidecar"
    | "local_model";
  defaultConfig?: Record<string, string>;
}

export type CatalogCategory = CatalogProvider["category"];

export const CATALOG_CATEGORIES: {
  key: CatalogCategory | "all";
  label: string;
}[] = [
  { key: "all", label: "All" },
  { key: "market", label: "Market Data" },
  { key: "fundamentals", label: "Fundamentals" },
  { key: "macro", label: "Macro & Economic" },
  { key: "filings", label: "Filings & Research" },
  { key: "crypto", label: "Crypto & Digital" },
  { key: "ai", label: "AI Providers" },
  { key: "alt_data", label: "Alternative Data" },
  { key: "storage", label: "Storage" },
];

export const PROVIDER_CATALOG: CatalogProvider[] = [
  // ── Market Data ──────────────────────────────────────────────────
  {
    id: "yahoo_finance",
    name: "Yahoo Finance",
    category: "market",
    description:
      "Free delayed quotes, historical data, and financials via community APIs",
    defaultEndpoint: "https://query1.finance.yahoo.com/v8",
    authType: "none",
    defaultSourceType: "public_api",
  },
  {
    id: "bloomberg_bpipe",
    name: "Bloomberg B-PIPE",
    category: "market",
    description:
      "Enterprise-grade real-time and reference data from Bloomberg",
    authType: "api_key",
    signupUrl: "https://www.bloomberg.com/professional/product/b-pipe/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "refinitiv_eikon",
    name: "Refinitiv Eikon",
    category: "market",
    description:
      "LSEG Workspace data platform for real-time market data and analytics",
    defaultEndpoint: "https://api.refinitiv.com",
    authType: "api_key",
    signupUrl: "https://developers.lseg.com/en/api-catalog",
    defaultSourceType: "keyed_api",
  },
  {
    id: "finnhub",
    name: "Finnhub",
    category: "market",
    description:
      "Real-time stock prices, company fundamentals, and alternative data",
    defaultEndpoint: "https://finnhub.io/api/v1",
    authType: "api_key",
    signupUrl: "https://finnhub.io/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "alpha_vantage",
    name: "Alpha Vantage",
    category: "market",
    description:
      "Free and premium APIs for stocks, forex, crypto, and technical indicators",
    defaultEndpoint: "https://www.alphavantage.co/query",
    authType: "api_key",
    signupUrl: "https://www.alphavantage.co/support/#api-key",
    defaultSourceType: "keyed_api",
  },
  {
    id: "polygon_io",
    name: "Polygon.io",
    category: "market",
    description:
      "Real-time and historical stock, options, forex, and crypto data",
    defaultEndpoint: "https://api.polygon.io/v2",
    authType: "api_key",
    signupUrl: "https://polygon.io/dashboard/signup",
    defaultSourceType: "keyed_api",
  },
  {
    id: "twelve_data",
    name: "Twelve Data",
    category: "market",
    description:
      "Financial data APIs covering stocks, forex, crypto, ETFs, and indices",
    defaultEndpoint: "https://api.twelvedata.com",
    authType: "api_key",
    signupUrl: "https://twelvedata.com/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "tiingo",
    name: "Tiingo",
    category: "market",
    description:
      "End-of-day and intraday stock prices, news, and fundamental data",
    defaultEndpoint: "https://api.tiingo.com",
    authType: "api_key",
    signupUrl: "https://www.tiingo.com/account/api/token",
    defaultSourceType: "keyed_api",
  },
  {
    id: "eodhd",
    name: "EODHD",
    category: "market",
    description:
      "End-of-day and intraday data for 70+ exchanges worldwide",
    defaultEndpoint: "https://eodhd.com/api",
    authType: "api_key",
    signupUrl: "https://eodhd.com/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "intrinio",
    name: "Intrinio",
    category: "market",
    description:
      "US equities, options, and ETF data with real-time and historical feeds",
    defaultEndpoint: "https://api-v2.intrinio.com",
    authType: "api_key",
    signupUrl: "https://intrinio.com/signup",
    defaultSourceType: "keyed_api",
  },
  {
    id: "nasdaq_data_link",
    name: "Nasdaq Data Link",
    category: "market",
    description:
      "Premium and community datasets from Nasdaq's data marketplace",
    defaultEndpoint: "https://data.nasdaq.com/api/v3",
    authType: "api_key",
    signupUrl: "https://data.nasdaq.com/sign-up",
    defaultSourceType: "keyed_api",
  },
  {
    id: "iex_cloud",
    name: "IEX Cloud",
    category: "market",
    description:
      "US equity data including quotes, fundamentals, and market statistics",
    defaultEndpoint: "https://cloud.iexapis.com/stable",
    authType: "api_key",
    signupUrl: "https://iexcloud.io/cloud-login#/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "marketstack",
    name: "Marketstack",
    category: "market",
    description:
      "Real-time and historical market data for 70+ stock exchanges",
    defaultEndpoint: "https://api.marketstack.com/v1",
    authType: "api_key",
    signupUrl: "https://marketstack.com/signup",
    defaultSourceType: "keyed_api",
  },
  {
    id: "tradier",
    name: "Tradier",
    category: "market",
    description:
      "Brokerage and market data API for equities and options trading",
    defaultEndpoint: "https://api.tradier.com/v1",
    authType: "bearer",
    signupUrl: "https://developer.tradier.com/user/sign_up",
    defaultSourceType: "keyed_api",
  },
  {
    id: "alpaca_markets",
    name: "Alpaca Markets",
    category: "market",
    description:
      "Commission-free trading and real-time market data API",
    defaultEndpoint: "https://data.alpaca.markets/v2",
    authType: "api_key",
    signupUrl: "https://app.alpaca.markets/signup",
    defaultSourceType: "keyed_api",
  },
  {
    id: "interactive_brokers",
    name: "Interactive Brokers",
    category: "market",
    description:
      "Professional-grade trading and market data via Client Portal API",
    defaultEndpoint: "https://localhost:5000/v1/api",
    authType: "oauth",
    signupUrl: "https://www.interactivebrokers.com/en/trading/ib-api.php",
    defaultSourceType: "keyed_api",
  },
  {
    id: "barchart",
    name: "Barchart",
    category: "market",
    description:
      "Real-time and historical data for equities, futures, and forex",
    defaultEndpoint: "https://marketdata.websol.barchart.com/getQuote.json",
    authType: "api_key",
    signupUrl: "https://www.barchart.com/ondemand/api",
    defaultSourceType: "keyed_api",
  },
  {
    id: "xignite",
    name: "Xignite",
    category: "market",
    description:
      "Cloud-based financial market data APIs for enterprise applications",
    defaultEndpoint: "https://globalquotes.xignite.com/v3",
    authType: "api_key",
    signupUrl: "https://www.xignite.com/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "dxfeed",
    name: "dxFeed",
    category: "market",
    description:
      "Low-latency market data for equities, options, and futures",
    authType: "api_key",
    signupUrl: "https://dxfeed.com/contact-us/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "quandl",
    name: "Quandl",
    category: "market",
    description:
      "Financial, economic, and alternative datasets (now Nasdaq Data Link)",
    defaultEndpoint: "https://data.nasdaq.com/api/v3",
    authType: "api_key",
    signupUrl: "https://data.nasdaq.com/sign-up",
    defaultSourceType: "keyed_api",
  },
  {
    id: "yfinance",
    name: "yfinance (Python)",
    category: "market",
    description:
      "Python library providing Yahoo Finance data via local sidecar",
    authType: "none",
    defaultSourceType: "sidecar",
  },

  // ── Fundamentals ─────────────────────────────────────────────────
  {
    id: "financial_modeling_prep",
    name: "Financial Modeling Prep",
    category: "fundamentals",
    description:
      "Company financials, ratios, DCF, and stock screening APIs",
    defaultEndpoint: "https://financialmodelingprep.com/api/v3",
    authType: "api_key",
    signupUrl: "https://site.financialmodelingprep.com/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "simfin",
    name: "SimFin",
    category: "fundamentals",
    description:
      "Free fundamental financial data including income, balance, and cash flow statements",
    defaultEndpoint: "https://simfin.com/api/v3",
    authType: "api_key",
    signupUrl: "https://app.simfin.com/login",
    defaultSourceType: "keyed_api",
  },
  {
    id: "london_strategic_edge",
    name: "London Strategic Edge",
    category: "fundamentals",
    description:
      "UK and European company fundamentals and analytics",
    authType: "api_key",
    signupUrl: "https://www.lse.co.uk/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "morningstar",
    name: "Morningstar",
    category: "fundamentals",
    description:
      "Investment research, ratings, and fundamental data for equities and funds",
    authType: "api_key",
    signupUrl: "https://developer.morningstar.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "sp_capital_iq",
    name: "S&P Capital IQ",
    category: "fundamentals",
    description:
      "Comprehensive company financials, estimates, and credit analytics from S&P Global",
    authType: "api_key",
    signupUrl: "https://www.spglobal.com/marketintelligence/en/solutions/sp-capital-iq-pro",
    defaultSourceType: "keyed_api",
  },
  {
    id: "factset",
    name: "FactSet",
    category: "fundamentals",
    description:
      "Integrated financial data, analytics, and portfolio management tools",
    defaultEndpoint: "https://api.factset.com",
    authType: "api_key",
    signupUrl: "https://developer.factset.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "visible_alpha",
    name: "Visible Alpha",
    category: "fundamentals",
    description:
      "Consensus estimates and detailed analyst model data",
    authType: "api_key",
    signupUrl: "https://visiblealpha.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "calcbench",
    name: "Calcbench",
    category: "fundamentals",
    description:
      "Standardized and as-reported financial data extracted from SEC filings",
    defaultEndpoint: "https://www.calcbench.com/api",
    authType: "api_key",
    signupUrl: "https://www.calcbench.com/join",
    defaultSourceType: "keyed_api",
  },
  {
    id: "last10k",
    name: "Last10K",
    category: "fundamentals",
    description:
      "AI-powered summaries and analysis of SEC 10-K and 10-Q filings",
    authType: "api_key",
    signupUrl: "https://last10k.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "wisesheets",
    name: "Wisesheets",
    category: "fundamentals",
    description:
      "Stock data add-in for Excel and Google Sheets with fundamentals and estimates",
    authType: "api_key",
    signupUrl: "https://wisesheets.io/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "stockanalysis",
    name: "Stock Analysis",
    category: "fundamentals",
    description:
      "Free stock quotes, financials, and analysis for US equities",
    defaultEndpoint: "https://stockanalysis.com/api/v1",
    authType: "api_key",
    signupUrl: "https://stockanalysis.com/pro/",
    defaultSourceType: "keyed_api",
  },

  // ── Macro & Economic ────────────────────────────────────────────
  {
    id: "fred",
    name: "FRED",
    category: "macro",
    description:
      "Federal Reserve Economic Data with 800,000+ US and international time series",
    defaultEndpoint: "https://api.stlouisfed.org/fred",
    authType: "api_key",
    signupUrl: "https://fred.stlouisfed.org/docs/api/api_key.html",
    defaultSourceType: "keyed_api",
  },
  {
    id: "world_bank",
    name: "World Bank",
    category: "macro",
    description:
      "Open data on global development indicators, poverty, and economic statistics",
    defaultEndpoint: "https://api.worldbank.org/v2",
    authType: "none",
    signupUrl: "https://data.worldbank.org/",
    defaultSourceType: "public_api",
  },
  {
    id: "imf",
    name: "IMF",
    category: "macro",
    description:
      "International Monetary Fund DataMapper macro series through the current v2 public API",
    defaultEndpoint: "https://www.imf.org/external/datamapper/api/v2",
    authType: "none",
    signupUrl: "https://data.imf.org/",
    defaultSourceType: "public_api",
  },
  {
    id: "bls",
    name: "Bureau of Labor Statistics",
    category: "macro",
    description:
      "US labor market data including employment, CPI, and wages",
    defaultEndpoint: "https://api.bls.gov/publicAPI/v2",
    authType: "api_key",
    signupUrl: "https://data.bls.gov/registrationEngine/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "oecd",
    name: "OECD",
    category: "macro",
    description:
      "OECD Data Explorer statistics through the current public SDMX REST API using explicit dataset selections",
    defaultEndpoint: "https://sdmx.oecd.org/public/rest",
    authType: "none",
    signupUrl: "https://data.oecd.org/",
    defaultSourceType: "public_api",
  },
  {
    id: "ecb",
    name: "European Central Bank",
    category: "macro",
    description:
      "Euro area monetary policy, exchange rates, and economic statistics",
    defaultEndpoint: "https://data-api.ecb.europa.eu/service",
    authType: "none",
    signupUrl: "https://data.ecb.europa.eu/",
    defaultSourceType: "public_api",
  },
  {
    id: "rbi",
    name: "Reserve Bank of India",
    category: "macro",
    description:
      "RBI Database on Indian Economy (DBIE) public query/download portal; live API integration is not claimed until RBI publishes a stable documented machine API",
    defaultEndpoint: "https://data.rbi.org.in",
    authType: "none",
    signupUrl: "https://data.rbi.org.in",
    defaultSourceType: "public_api",
  },
  {
    id: "bank_of_england",
    name: "Bank of England",
    category: "macro",
    description:
      "UK monetary and financial statistics from the central bank",
    defaultEndpoint: "https://www.bankofengland.co.uk/boeapps/database",
    authType: "none",
    signupUrl:
      "https://www.bankofengland.co.uk/statistics",
    defaultSourceType: "public_api",
  },
  {
    id: "eurostat",
    name: "Eurostat",
    category: "macro",
    description:
      "Official statistics for the European Union and euro area",
    defaultEndpoint: "https://ec.europa.eu/eurostat/api/dissemination",
    authType: "none",
    signupUrl: "https://ec.europa.eu/eurostat/data/database",
    defaultSourceType: "public_api",
  },
  {
    id: "un_data",
    name: "UN Data",
    category: "macro",
    description:
      "United Nations statistical data across demographics, trade, and development",
    defaultEndpoint: "https://data.un.org/ws/rest",
    authType: "none",
    signupUrl: "https://data.un.org/",
    defaultSourceType: "public_api",
  },
  {
    id: "ceic",
    name: "CEIC",
    category: "macro",
    description:
      "Comprehensive macroeconomic and industry data for 200+ countries",
    authType: "api_key",
    signupUrl: "https://www.ceicdata.com/en/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "trading_economics",
    name: "Trading Economics",
    category: "macro",
    description:
      "Economic indicators, forecasts, and market data for 196 countries",
    defaultEndpoint: "https://api.tradingeconomics.com",
    authType: "api_key",
    signupUrl: "https://tradingeconomics.com/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "dbnomics",
    name: "DBnomics",
    category: "macro",
    description:
      "Free aggregator of economic data from dozens of official providers",
    defaultEndpoint: "https://api.db.nomics.world/v22",
    authType: "none",
    signupUrl: "https://db.nomics.world/",
    defaultSourceType: "public_api",
  },
  {
    id: "haver_analytics",
    name: "Haver Analytics",
    category: "macro",
    description:
      "Curated economic and financial databases for institutional research",
    authType: "api_key",
    signupUrl: "https://www.haver.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "oxford_economics",
    name: "Oxford Economics",
    category: "macro",
    description:
      "Global economic forecasts, scenarios, and country-level analysis",
    authType: "api_key",
    signupUrl: "https://www.oxfordeconomics.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "bea",
    name: "Bureau of Economic Analysis",
    category: "macro",
    description:
      "US GDP, personal income, and international trade statistics",
    defaultEndpoint: "https://apps.bea.gov/api/data",
    authType: "api_key",
    signupUrl: "https://apps.bea.gov/api/signup/",
    defaultSourceType: "keyed_api",
  },

  // ── Filings & Research ──────────────────────────────────────────
  {
    id: "sec_edgar",
    name: "SEC EDGAR",
    category: "filings",
    description:
      "Full-text SEC filings, XBRL data, and company submissions",
    defaultEndpoint: "https://efts.sec.gov/LATEST",
    authType: "none",
    signupUrl: "https://www.sec.gov/search",
    defaultSourceType: "public_api",
    defaultConfig: { "User-Agent": "YourCompany admin@example.com" },
  },
  {
    id: "sebi_edgar",
    name: "SEBI EDGAR",
    category: "filings",
    description:
      "Indian corporate filings and disclosures from SEBI",
    defaultEndpoint: "https://www.sebi.gov.in/sebiweb/home",
    authType: "none",
    signupUrl: "https://www.sebi.gov.in/",
    defaultSourceType: "public_api",
  },
  {
    id: "companies_house_uk",
    name: "Companies House UK",
    category: "filings",
    description:
      "UK company registrations, filings, and officer information",
    defaultEndpoint: "https://api.company-information.service.gov.uk",
    authType: "api_key",
    signupUrl: "https://developer.company-information.service.gov.uk/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "opencorporates",
    name: "OpenCorporates",
    category: "filings",
    description:
      "Open database of corporate registrations from 140+ jurisdictions",
    defaultEndpoint: "https://api.opencorporates.com/v0.4",
    authType: "api_key",
    signupUrl: "https://opencorporates.com/api_accounts/new",
    defaultSourceType: "keyed_api",
  },
  {
    id: "alphasense",
    name: "AlphaSense",
    category: "filings",
    description:
      "AI-powered search engine for financial documents, filings, and transcripts",
    authType: "api_key",
    signupUrl: "https://www.alpha-sense.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "sentieo",
    name: "Sentieo",
    category: "filings",
    description:
      "Financial research platform with document search and data visualization",
    authType: "api_key",
    signupUrl: "https://sentieo.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "koyfin",
    name: "Koyfin",
    category: "filings",
    description:
      "Financial data and analytics platform for equity research",
    authType: "api_key",
    signupUrl: "https://www.koyfin.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "tegus",
    name: "Tegus",
    category: "filings",
    description:
      "Expert interview transcripts and primary research for institutional investors",
    authType: "api_key",
    signupUrl: "https://www.tegus.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "expert_market",
    name: "Expert Market",
    category: "filings",
    description:
      "Expert network call transcripts and industry-specific research",
    authType: "api_key",
    signupUrl: "https://expertmarket.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "xbrl_international",
    name: "XBRL International",
    category: "filings",
    description:
      "Structured business reporting data in XBRL format from global filings",
    defaultEndpoint: "https://filings.xbrl.org/api/filings",
    authType: "none",
    signupUrl: "https://www.xbrl.org/",
    defaultSourceType: "public_api",
  },

  // ── Crypto & Digital ────────────────────────────────────────────
  {
    id: "coingecko",
    name: "CoinGecko",
    category: "crypto",
    description:
      "Cryptocurrency prices, market cap, volume, and exchange data",
    defaultEndpoint: "https://api.coingecko.com/api/v3",
    authType: "api_key",
    signupUrl: "https://www.coingecko.com/en/api/pricing",
    defaultSourceType: "keyed_api",
  },
  {
    id: "coinmarketcap",
    name: "CoinMarketCap",
    category: "crypto",
    description:
      "Crypto market data including prices, rankings, and exchange volumes",
    defaultEndpoint: "https://pro-api.coinmarketcap.com/v1",
    authType: "api_key",
    signupUrl: "https://coinmarketcap.com/api/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "messari",
    name: "Messari",
    category: "crypto",
    description:
      "Crypto asset data, research reports, and on-chain metrics",
    defaultEndpoint: "https://data.messari.io/api/v2",
    authType: "api_key",
    signupUrl: "https://messari.io/api",
    defaultSourceType: "keyed_api",
  },
  {
    id: "glassnode",
    name: "Glassnode",
    category: "crypto",
    description:
      "On-chain analytics and blockchain intelligence for crypto assets",
    defaultEndpoint: "https://api.glassnode.com/v1",
    authType: "api_key",
    signupUrl: "https://studio.glassnode.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "cryptocompare",
    name: "CryptoCompare",
    category: "crypto",
    description:
      "Real-time and historical crypto data with social and trading signals",
    defaultEndpoint: "https://min-api.cryptocompare.com/data",
    authType: "api_key",
    signupUrl: "https://www.cryptocompare.com/cryptopian/api-keys",
    defaultSourceType: "keyed_api",
  },
  {
    id: "kaiko",
    name: "Kaiko",
    category: "crypto",
    description:
      "Institutional-grade cryptocurrency market data and analytics",
    defaultEndpoint: "https://us.market-api.kaiko.io/v2",
    authType: "api_key",
    signupUrl: "https://www.kaiko.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "amberdata",
    name: "Amberdata",
    category: "crypto",
    description:
      "Digital asset data covering DeFi, blockchain networks, and market analytics",
    defaultEndpoint: "https://web3api.io/api/v2",
    authType: "api_key",
    signupUrl: "https://amberdata.io/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "the_graph",
    name: "The Graph",
    category: "crypto",
    description:
      "Decentralized protocol for indexing and querying blockchain data via GraphQL",
    defaultEndpoint: "https://gateway.thegraph.com/api",
    authType: "api_key",
    signupUrl: "https://thegraph.com/studio/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "dune_analytics",
    name: "Dune Analytics",
    category: "crypto",
    description:
      "Community-driven blockchain analytics with SQL-based queries",
    defaultEndpoint: "https://api.dune.com/api/v1",
    authType: "api_key",
    signupUrl: "https://dune.com/auth/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "defillama",
    name: "DefiLlama",
    category: "crypto",
    description:
      "Open DeFi analytics tracking TVL, yields, and protocol metrics",
    defaultEndpoint: "https://api.llama.fi",
    authType: "none",
    signupUrl: "https://defillama.com/docs/api",
    defaultSourceType: "public_api",
  },
  {
    id: "nansen",
    name: "Nansen",
    category: "crypto",
    description:
      "Blockchain analytics platform with wallet labeling and smart money tracking",
    authType: "api_key",
    signupUrl: "https://www.nansen.ai/",
    defaultSourceType: "keyed_api",
  },

  // ── AI Providers ────────────────────────────────────────────────
  {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    description:
      "GPT-4, GPT-3.5, DALL-E, Whisper, and embedding models",
    defaultEndpoint: "https://api.openai.com/v1",
    authType: "bearer",
    signupUrl: "https://platform.openai.com/signup",
    defaultSourceType: "keyed_api",
  },
  {
    id: "anthropic",
    name: "Anthropic",
    category: "ai",
    description:
      "Claude family of AI assistants for analysis, coding, and reasoning",
    defaultEndpoint: "https://api.anthropic.com/v1",
    authType: "api_key",
    signupUrl: "https://console.anthropic.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "google_gemini",
    name: "Google Gemini",
    category: "ai",
    description:
      "Google's multimodal AI models for text, image, and code generation",
    defaultEndpoint: "https://generativelanguage.googleapis.com/v1beta",
    authType: "api_key",
    signupUrl: "https://aistudio.google.com/apikey",
    defaultSourceType: "keyed_api",
  },
  {
    id: "mistral",
    name: "Mistral",
    category: "ai",
    description:
      "Open-weight and commercial LLMs for text generation and embeddings",
    defaultEndpoint: "https://api.mistral.ai/v1",
    authType: "bearer",
    signupUrl: "https://console.mistral.ai/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "groq",
    name: "Groq",
    category: "ai",
    description:
      "Ultra-fast LLM inference on custom LPU hardware",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    authType: "bearer",
    signupUrl: "https://console.groq.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "together_ai",
    name: "Together AI",
    category: "ai",
    description:
      "Open-source model hosting for Llama, Mixtral, and other LLMs",
    defaultEndpoint: "https://api.together.xyz/v1",
    authType: "bearer",
    signupUrl: "https://api.together.ai/signin",
    defaultSourceType: "keyed_api",
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "ai",
    description:
      "Run open-source LLMs locally including Llama, Mistral, and CodeLlama",
    defaultEndpoint: "http://localhost:11434/api",
    authType: "none",
    signupUrl: "https://ollama.com/download",
    defaultSourceType: "local_model",
  },
  {
    id: "azure_openai",
    name: "Azure OpenAI",
    category: "ai",
    description:
      "Microsoft-hosted OpenAI models with enterprise security and compliance",
    authType: "api_key",
    signupUrl: "https://azure.microsoft.com/en-us/products/ai-services/openai-service",
    defaultSourceType: "keyed_api",
    defaultConfig: { deployment: "", resource: "" },
  },
  {
    id: "aws_bedrock",
    name: "AWS Bedrock",
    category: "ai",
    description:
      "Managed access to foundation models from Anthropic, Meta, and others on AWS",
    authType: "api_key",
    signupUrl: "https://aws.amazon.com/bedrock/",
    defaultSourceType: "keyed_api",
    defaultConfig: { region: "us-east-1" },
  },
  {
    id: "cohere",
    name: "Cohere",
    category: "ai",
    description:
      "Enterprise NLP models for text generation, classification, and embeddings",
    defaultEndpoint: "https://api.cohere.com/v1",
    authType: "bearer",
    signupUrl: "https://dashboard.cohere.com/welcome/register",
    defaultSourceType: "keyed_api",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    category: "ai",
    description:
      "AI search and chat models with real-time web access",
    defaultEndpoint: "https://api.perplexity.ai",
    authType: "bearer",
    signupUrl: "https://www.perplexity.ai/settings/api",
    defaultSourceType: "keyed_api",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    category: "ai",
    description:
      "High-performance open-source LLMs for code and reasoning tasks",
    defaultEndpoint: "https://api.deepseek.com/v1",
    authType: "bearer",
    signupUrl: "https://platform.deepseek.com/sign_up",
    defaultSourceType: "keyed_api",
  },
  {
    id: "xai_grok",
    name: "xAI / Grok",
    category: "ai",
    description:
      "Grok language models from xAI with real-time knowledge",
    defaultEndpoint: "https://api.x.ai/v1",
    authType: "bearer",
    signupUrl: "https://console.x.ai/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "fireworks_ai",
    name: "Fireworks AI",
    category: "ai",
    description:
      "Fast inference platform for open-source and fine-tuned LLMs",
    defaultEndpoint: "https://api.fireworks.ai/inference/v1",
    authType: "bearer",
    signupUrl: "https://fireworks.ai/login",
    defaultSourceType: "keyed_api",
  },
  {
    id: "replicate",
    name: "Replicate",
    category: "ai",
    description:
      "Run open-source ML models in the cloud via simple API",
    defaultEndpoint: "https://api.replicate.com/v1",
    authType: "bearer",
    signupUrl: "https://replicate.com/signin",
    defaultSourceType: "keyed_api",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    category: "ai",
    description:
      "Inference API for thousands of open-source ML models",
    defaultEndpoint: "https://api-inference.huggingface.co/models",
    authType: "bearer",
    signupUrl: "https://huggingface.co/join",
    defaultSourceType: "keyed_api",
  },

  // ── Alternative Data ────────────────────────────────────────────
  {
    id: "google_trends",
    name: "Google Trends",
    category: "alt_data",
    description:
      "Search interest trends and regional popularity data from Google",
    authType: "none",
    defaultSourceType: "sidecar",
  },
  {
    id: "reddit_api",
    name: "Reddit API",
    category: "alt_data",
    description:
      "Subreddit posts, comments, and sentiment data from Reddit",
    defaultEndpoint: "https://oauth.reddit.com",
    authType: "oauth",
    signupUrl: "https://www.reddit.com/prefs/apps",
    defaultSourceType: "keyed_api",
  },
  {
    id: "twitter_x_api",
    name: "Twitter / X API",
    category: "alt_data",
    description:
      "Tweets, trends, and social engagement data from X (formerly Twitter)",
    defaultEndpoint: "https://api.x.com/2",
    authType: "bearer",
    signupUrl: "https://developer.x.com/en/portal/dashboard",
    defaultSourceType: "keyed_api",
  },
  {
    id: "glassdoor",
    name: "Glassdoor",
    category: "alt_data",
    description:
      "Employee reviews, salary data, and company ratings",
    authType: "api_key",
    signupUrl: "https://www.glassdoor.com/developer/index.htm",
    defaultSourceType: "keyed_api",
  },
  {
    id: "indeed_job_postings",
    name: "Indeed Job Postings",
    category: "alt_data",
    description:
      "Job posting volume and hiring trends from Indeed",
    authType: "api_key",
    signupUrl: "https://developer.indeed.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "patsnap_patents",
    name: "PatSnap Patents",
    category: "alt_data",
    description:
      "Global patent search and IP analytics across 170+ authorities",
    authType: "api_key",
    signupUrl: "https://www.patsnap.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "similarweb",
    name: "SimilarWeb",
    category: "alt_data",
    description:
      "Website traffic, audience insights, and digital market intelligence",
    defaultEndpoint: "https://api.similarweb.com/v1",
    authType: "api_key",
    signupUrl: "https://www.similarweb.com/corp/developer/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "sensor_tower",
    name: "Sensor Tower",
    category: "alt_data",
    description:
      "Mobile app analytics including downloads, revenue, and engagement",
    authType: "api_key",
    signupUrl: "https://sensortower.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "orbital_insight",
    name: "Orbital Insight",
    category: "alt_data",
    description:
      "Geospatial analytics from satellite imagery for economic insights",
    authType: "api_key",
    signupUrl: "https://orbitalinsight.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "spire_maritime_ais",
    name: "Spire Maritime AIS",
    category: "alt_data",
    description:
      "Global ship tracking and maritime AIS data for supply chain analysis",
    authType: "api_key",
    signupUrl: "https://spire.com/maritime/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "bright_data",
    name: "Bright Data",
    category: "alt_data",
    description:
      "Web data collection platform with structured datasets and proxies",
    authType: "api_key",
    signupUrl: "https://brightdata.com/",
    defaultSourceType: "keyed_api",
  },
  {
    id: "yelp_fusion",
    name: "Yelp Fusion",
    category: "alt_data",
    description:
      "Business reviews, ratings, and local search data from Yelp",
    defaultEndpoint: "https://api.yelp.com/v3",
    authType: "api_key",
    signupUrl: "https://www.yelp.com/developers/v3/manage_app",
    defaultSourceType: "keyed_api",
  },

  // ── Storage ─────────────────────────────────────────────────────
  {
    id: "aws_s3",
    name: "AWS S3",
    category: "storage",
    description:
      "Amazon Simple Storage Service for scalable cloud object storage",
    authType: "api_key",
    signupUrl: "https://aws.amazon.com/s3/",
    defaultSourceType: "cloud_storage",
    defaultConfig: { region: "us-east-1", bucket: "" },
  },
  {
    id: "google_cloud_storage",
    name: "Google Cloud Storage",
    category: "storage",
    description:
      "Unified object storage on Google Cloud Platform",
    authType: "oauth",
    signupUrl: "https://console.cloud.google.com/storage",
    defaultSourceType: "cloud_storage",
    defaultConfig: { bucket: "" },
  },
  {
    id: "azure_blob_storage",
    name: "Azure Blob Storage",
    category: "storage",
    description:
      "Microsoft Azure cloud storage for unstructured data",
    authType: "api_key",
    signupUrl: "https://azure.microsoft.com/en-us/products/storage/blobs",
    defaultSourceType: "cloud_storage",
    defaultConfig: { container: "", account: "" },
  },
  {
    id: "google_drive",
    name: "Google Drive",
    category: "storage",
    description:
      "Cloud file storage and synchronization from Google Workspace",
    defaultEndpoint: "https://www.googleapis.com/drive/v3",
    authType: "oauth",
    signupUrl: "https://console.cloud.google.com/apis/library/drive.googleapis.com",
    defaultSourceType: "cloud_storage",
  },
  {
    id: "microsoft_onedrive",
    name: "Microsoft OneDrive",
    category: "storage",
    description:
      "Cloud file storage integrated with Microsoft 365",
    defaultEndpoint: "https://graph.microsoft.com/v1.0/me/drive",
    authType: "oauth",
    signupUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps",
    defaultSourceType: "cloud_storage",
  },
  {
    id: "sharepoint",
    name: "SharePoint",
    category: "storage",
    description:
      "Microsoft SharePoint document libraries and team sites",
    defaultEndpoint: "https://graph.microsoft.com/v1.0/sites",
    authType: "oauth",
    signupUrl: "https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps",
    defaultSourceType: "cloud_storage",
  },
  {
    id: "sftp_server",
    name: "SFTP Server",
    category: "storage",
    description:
      "Secure file transfer over SSH for remote file access",
    authType: "database_credentials",
    defaultSourceType: "cloud_storage",
    defaultConfig: { host: "", port: "22", path: "/" },
  },
  {
    id: "local_folder",
    name: "Local Folder",
    category: "storage",
    description:
      "Access files from a local directory on the server filesystem",
    authType: "none",
    defaultSourceType: "cloud_storage",
    defaultConfig: { path: "" },
  },
  {
    id: "dropbox",
    name: "Dropbox",
    category: "storage",
    description:
      "Cloud file storage and sharing with team collaboration features",
    defaultEndpoint: "https://api.dropboxapi.com/2",
    authType: "oauth",
    signupUrl: "https://www.dropbox.com/developers/apps",
    defaultSourceType: "cloud_storage",
  },
  {
    id: "minio",
    name: "MinIO",
    category: "storage",
    description:
      "S3-compatible high-performance object storage for self-hosted deployments",
    authType: "api_key",
    signupUrl: "https://min.io/download",
    defaultSourceType: "cloud_storage",
    defaultConfig: { endpoint: "http://localhost:9000", bucket: "" },
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    category: "storage",
    description:
      "Open-source relational database for structured data storage and queries",
    authType: "database_credentials",
    defaultSourceType: "database",
    defaultConfig: { host: "localhost", port: "5432", database: "" },
  },
  {
    id: "mysql",
    name: "MySQL",
    category: "storage",
    description:
      "Popular open-source relational database management system",
    authType: "database_credentials",
    defaultSourceType: "database",
    defaultConfig: { host: "localhost", port: "3306", database: "" },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "storage",
    description:
      "Document-oriented NoSQL database for flexible data storage",
    authType: "database_credentials",
    defaultSourceType: "database",
    defaultConfig: { host: "localhost", port: "27017", database: "" },
  },
  {
    id: "snowflake",
    name: "Snowflake",
    category: "storage",
    description:
      "Cloud data warehouse for analytics and large-scale data processing",
    authType: "database_credentials",
    signupUrl: "https://signup.snowflake.com/",
    defaultSourceType: "database",
    defaultConfig: { account: "", warehouse: "", database: "" },
  },
  {
    id: "bigquery",
    name: "Google BigQuery",
    category: "storage",
    description:
      "Serverless cloud data warehouse for SQL analytics at scale",
    authType: "oauth",
    signupUrl: "https://console.cloud.google.com/bigquery",
    defaultSourceType: "database",
    defaultConfig: { project: "", dataset: "" },
  },
  {
    id: "clickhouse",
    name: "ClickHouse",
    category: "storage",
    description:
      "Column-oriented OLAP database for real-time analytical queries",
    authType: "database_credentials",
    signupUrl: "https://clickhouse.com/",
    defaultSourceType: "database",
    defaultConfig: { host: "localhost", port: "8123", database: "default" },
  },
  {
    id: "redis",
    name: "Redis",
    category: "storage",
    description:
      "In-memory data store for caching, queues, and real-time analytics",
    authType: "database_credentials",
    signupUrl: "https://redis.io/",
    defaultSourceType: "database",
    defaultConfig: { host: "localhost", port: "6379" },
  },
  {
    id: "elasticsearch",
    name: "Elasticsearch",
    category: "storage",
    description:
      "Distributed search and analytics engine for structured and unstructured data",
    authType: "database_credentials",
    signupUrl: "https://www.elastic.co/elasticsearch",
    defaultSourceType: "database",
    defaultConfig: { host: "localhost", port: "9200" },
  },
];
