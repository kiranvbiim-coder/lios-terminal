import { AI_PROVIDERS, getAvailableProviders } from "./byoaiRouter";
import { hasCredential } from "./terminalConfig";

export type ProviderState = "configured" | "disabled" | "not_configured" | "unreachable";

export interface ProviderStatus {
  id: string;
  label: string;
  category: "market" | "fundamentals" | "platform" | "ai";
  state: ProviderState;
  detail: string;
  setup: string;
}


function configured(value: boolean, detail: string, setup: string): Pick<ProviderStatus, "state" | "detail" | "setup"> {
  return value
    ? { state: "configured", detail, setup }
    : { state: "not_configured", detail: "No credential is available to this runtime.", setup };
}

/**
 * Deliberately returns capability only. Credentials never leave the process,
 * which lets the terminal be candid about a missing data source without
 * turning its diagnostics screen into a secret-management surface.
 */
export async function getProviderStatuses(): Promise<ProviderStatus[]> {
  return [
    { id: "fred", label: "FRED", category: "market", ...configured(hasCredential("FRED_API_KEY", "fredApiKey"), "Macro and rates data are available.", "Set FRED_API_KEY or fredApiKey.") },
    { id: "finnhub", label: "Finnhub", category: "market", ...configured(hasCredential("FINNHUB_API_KEY", "finnhubApiKey"), "Live-stream and US filing fallback are available.", "Set FINNHUB_API_KEY or finnhubApiKey.") },
    { id: "lse", label: "LSE API", category: "market", ...configured(hasCredential("LSE_API_KEY", "lseApiKey"), "London Strategic Edge credential is loaded; cross-asset market and reference data are available.", "Set LSE_API_KEY or lseApiKey.") },
    { id: "simfin", label: "SimFin", category: "fundamentals", ...configured(hasCredential("SIMFIN_API_KEY", "simfinApiKey"), "Global financial-statement fallback is available.", "Set SIMFIN_API_KEY or simfinApiKey.") },
    { id: "fmp", label: "Financial Modeling Prep", category: "fundamentals", ...configured(hasCredential("FMP_API_KEY", "fmpApiKey"), "Financial Modeling Prep fundamentals and estimate adapters are available.", "Set FMP_API_KEY or fmpApiKey separately from SimFin.") },
    ...AI_PROVIDERS.map((provider) => {
      const availability = getAvailableProviders().find((entry) => entry.id === provider.id);
      const isConfigured = availability?.available === true;
      const detail = provider.isLocal
        ? "Local AI runtime is available when its endpoint is configured."
        : "Optional AI provider credential is available to this runtime.";
      const setup = provider.requiredEnvKeys?.length
        ? `Set ${provider.envKey} and ${provider.requiredEnvKeys.join(", ")}.`
        : provider.isLocal
          ? `Set ${provider.envKey} to the local endpoint.`
          : `Set ${provider.envKey} or ${provider.vaultKey}.`;
      return { id: provider.id, label: provider.name, category: "ai" as const, ...configured(isConfigured, detail, setup) };
    }),
  ];
}
