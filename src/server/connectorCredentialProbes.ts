/**
 * Live credential verification probes for keyed connectors.
 * Used by Connection Center test/save before secrets are trusted.
 */
import { BUILT_IN_CONNECTORS, type ConnectorDefinition } from "@shared/connectorRegistry";
import { discoverConnectorPlugins } from "./connectorPluginService";

function allConnectors(): ConnectorDefinition[] {
  return [...BUILT_IN_CONNECTORS, ...discoverConnectorPlugins().definitions];
}

export type CredentialProbeRequest = {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
};
export type CredentialProbeFactory = (credential: string) => CredentialProbeRequest;

/** Marketing/catalog ids that differ from the runtime connector registry. */
export const CONNECTOR_ID_ALIASES: Record<string, string> = {
  polygon_io: "polygon",
  iex_cloud: "iex_cloud",
};

const CREDENTIAL_PROBE_FACTORIES: Record<string, CredentialProbeFactory> = {
  fred: key => ({ url: `https://api.stlouisfed.org/fred/series?series_id=GDP&api_key=${encodeURIComponent(key)}&file_type=json` }),
  finnhub: key => ({ url: "https://finnhub.io/api/v1/quote?symbol=AAPL", headers: { "X-Finnhub-Token": key } }),
  fmp: key => ({ url: `https://financialmodelingprep.com/stable/quote?symbol=AAPL&apikey=${encodeURIComponent(key)}` }),
  openfigi: key => ({
    url: "https://api.openfigi.com/v3/mapping",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-OPENFIGI-APIKEY": key,
    },
    body: JSON.stringify([{ idType: "TICKER", idValue: "IBM" }]),
  }),
  polygon: key => ({ url: `https://api.polygon.io/v2/last/trade/AAPL?apiKey=${encodeURIComponent(key)}` }),
  twelve_data: key => ({ url: `https://api.twelvedata.com/quote?symbol=AAPL&apikey=${encodeURIComponent(key)}` }),
  tiingo: key => ({ url: "https://api.tiingo.com/iex/AAPL", headers: { Authorization: `Token ${key}` } }),
  eodhd: key => ({ url: `https://eodhd.com/api/real-time/AAPL.US?api_token=${encodeURIComponent(key)}&fmt=json` }),
  nasdaq_data_link: key => ({ url: `https://data.nasdaq.com/api/v3/datasets/WIKI/AAPL.json?api_key=${encodeURIComponent(key)}` }),
  coinmarketcap: key => ({ url: "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=BTC", headers: { "X-CMC_PRO_API_KEY": key } }),
  anthropic: key => ({ url: "https://api.anthropic.com/v1/models", headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } }),
  gemini: key => ({
    url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100",
    headers: { "x-goog-api-key": key },
  }),
  openai: key => ({ url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${key}` } }),
  mistral: key => ({ url: "https://api.mistral.ai/v1/models", headers: { Authorization: `Bearer ${key}` } }),
  groq: key => ({ url: "https://api.groq.com/openai/v1/models", headers: { Authorization: `Bearer ${key}` } }),
  together: key => ({ url: "https://api.together.xyz/v1/models", headers: { Authorization: `Bearer ${key}` } }),
  alpha_vantage: key => ({
    url: `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${encodeURIComponent(key)}`,
  }),
  lse: key => ({
    url: "https://api.londonstrategicedge.com/vault/usage",
    headers: { "x-api-key": key },
  }),
  simfin: key => ({
    url: "https://backend.simfin.com/api/v3/companies/list",
    headers: { Authorization: `api-key ${key}` },
  }),
};

export function canonicalConnectorIdForCredentialTest(connectorId: string): string {
  const trimmed = connectorId.trim();
  return CONNECTOR_ID_ALIASES[trimmed] ?? trimmed;
}

export function resolveConnectorForCredentialTest(connectorId: string): ConnectorDefinition | undefined {
  const trimmed = connectorId.trim();
  const canonical = canonicalConnectorIdForCredentialTest(trimmed);
  const connectors = allConnectors();
  const direct = connectors.find((c) => c.id === canonical) ?? connectors.find((c) => c.id === trimmed);
  if (direct) return direct;
  return connectors.find(
    (connector) => connector.vaultKey === trimmed || connector.envKey === trimmed,
  );
}

export function getCredentialProbeFactory(connectorId: string): CredentialProbeFactory | undefined {
  const canonical = canonicalConnectorIdForCredentialTest(connectorId);
  return CREDENTIAL_PROBE_FACTORIES[canonical];
}

export function implementedKeyedConnectorsMissingCredentialProbes(): string[] {
  return BUILT_IN_CONNECTORS
    .filter((c) => c.sourceType === "keyed_api" && c.adapterImplemented)
    .map((c) => c.id)
    .filter((id) => !CREDENTIAL_PROBE_FACTORIES[id]);
}

const missingImplementedProbes = implementedKeyedConnectorsMissingCredentialProbes();
if (missingImplementedProbes.length > 0 && process.env.NODE_ENV !== "production") {
  console.warn(
    `[connectors] Missing credential verification probes for: ${missingImplementedProbes.join(", ")}`,
  );
}
