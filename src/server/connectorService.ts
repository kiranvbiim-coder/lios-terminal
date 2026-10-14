/**
 * Connector service: resolves each built-in connector's truthful runtime
 * state and provides the registry snapshot consumed by the UI and
 * contract resolver.
 *
 * State is computed from three independent, honestly-sourced facts (see
 * ConnectorRuntimeState in shared/connectorRegistry.ts for the full state
 * machine): whether real adapter code exists (static, ConnectorDefinition.
 * adapterImplemented), whether a required credential is present, and
 * whether the adapter has actually been exercised against the vendor's
 * real API (connectorVerification.ts, fed passively by each adapter
 * module's own fetch call). Credential presence alone is never reported
 * as "healthy".
 */
import { isCredentialAvailable, isUserScopedCredentialAvailable } from "./credentialVault";
import { discoverConnectorPlugins } from "./connectorPluginService";
import { getConnectorVerification, recordConnectorVerification } from "./connectorVerification";
import { isAdapterCoolingDown } from "./keyedQuoteAdapters";
import {
  getCredentialProbeFactory,
  resolveConnectorForCredentialTest,
} from "./connectorCredentialProbes";
import { normalizeProviderApiCredential } from "@shared/providerCredentialNormalize";
import {
  BUILT_IN_CONNECTORS,
  type ConnectorDefinition,
  type ConnectorRegistrySnapshot,
  type ConnectorRuntimeReport,
  type ConnectorRuntimeState,
} from "@shared/connectorRegistry";

function allConnectors(): ConnectorDefinition[] {
  return [...BUILT_IN_CONNECTORS, ...discoverConnectorPlugins().definitions];
}

function report(
  connector: ConnectorDefinition,
  state: ConnectorRuntimeState,
  detail: string,
  lastVerifiedAt: string | null = null,
): ConnectorRuntimeReport {
  return {
    connectorId: connector.id,
    state,
    detail,
    checkedAt: new Date().toISOString(),
    adapterImplemented: connector.adapterImplemented,
    lastVerifiedAt,
  };
}

/** Resolves the shared "ready, but has it actually been exercised?" tail shared by every implemented adapter, keyed or not. */
function verifiedTail(connector: ConnectorDefinition, readyDetail: string): ConnectorRuntimeReport {
  const verification = getConnectorVerification(connector.id);
  if (!verification) return report(connector, "credential_configured", readyDetail);
  if (verification.ok) return report(connector, "live_verified", verification.detail, verification.at);
  return report(connector, "degraded", verification.detail);
}

function resolveKeyedHealth(connector: ConnectorDefinition, credentialAvailable: boolean): ConnectorRuntimeReport {
  if (!connector.adapterImplemented) {
    return report(connector, "catalog_only", `${connector.name} is listed in the connector catalog, but no adapter code in this build calls its API yet.`);
  }
  if (!credentialAvailable) {
    return report(connector, "adapter_available", `${connector.name}'s adapter is implemented and ready. ${connector.setupGuide}`);
  }
  if (isAdapterCoolingDown(connector.id)) {
    return report(connector, "rate_limited", `${connector.name} recently returned HTTP 429 and is in a local cooldown to protect the rest of your quota.`);
  }
  return verifiedTail(connector, `${connector.name} credential is configured; not yet exercised against a live call this session.`);
}

function resolvePublicHealth(connector: ConnectorDefinition): ConnectorRuntimeReport {
  if (!connector.adapterImplemented) {
    return report(connector, "catalog_only", `${connector.name} is listed in the connector catalog, but no adapter code in this build calls its API yet.`);
  }
  return verifiedTail(connector, `${connector.name} requires no credential and is ready; not yet exercised against a live call this session.`);
}

/** Generic user-configured connector types (file/database/private_api/cloud_storage): each saved connection is tested for real by sourceConnectionService.testSourceConnection, so there's no single global state to verify here beyond whether the type itself has real implementing code. */
function resolvePlaceholderHealth(connector: ConnectorDefinition): ConnectorRuntimeReport {
  if (!connector.adapterImplemented) {
    return report(connector, "catalog_only", `${connector.name} — configure through the connector panel.`);
  }
  return report(connector, "adapter_available", `${connector.name} is implemented; add a specific connection through the connector panel to exercise it live.`);
}

async function resolveHealth(connector: ConnectorDefinition, credentialAvailable: boolean): Promise<ConnectorRuntimeReport> {
  switch (connector.sourceType) {
    case "keyed_api": return resolveKeyedHealth(connector, credentialAvailable);
    case "public_api": return resolvePublicHealth(connector);
    case "sidecar":
    case "file":
    case "database":
    case "private_api":
    case "cloud_storage":
    case "local_model":
      return resolvePlaceholderHealth(connector);
    default:
      return report(connector, "catalog_only", "Unknown connector type.");
  }
}

export type ConnectorCredentialTestState = "healthy" | "degraded" | "invalid" | "unreachable";

export interface ConnectorCredentialTestResult {
  connectorId: string;
  state: ConnectorCredentialTestState;
  detail: string;
  checkedAt: string;
  /** Provider-advertised chat model IDs returned by an explicit credential probe. */
  availableModels?: string[];
  /** False when the provider returned a continuation token and more pages were not requested. */
  availableModelsComplete?: boolean;
}

const MAX_CREDENTIAL_PROBE_BODY_BYTES = 4_000;
const MAX_GEMINI_MODEL_LIST_BYTES = 256_000;

async function readResponseTextBounded(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) return { text: "", truncated: false };

  const decoder = new TextDecoder();
  let text = "";
  let bytesRead = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const remaining = maxBytes - bytesRead;
    if (value.byteLength > remaining) {
      text += decoder.decode(value.subarray(0, Math.max(0, remaining)), { stream: true });
      await reader.cancel().catch(() => undefined);
      text += decoder.decode();
      return { text, truncated: true };
    }
    bytesRead += value.byteLength;
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return { text, truncated: false };
}

function geminiChatModelDiscovery(rawBody: string): { modelIds: string[]; complete: boolean } | undefined {
  try {
    const payload = JSON.parse(rawBody) as { models?: unknown; nextPageToken?: unknown };
    if (!Array.isArray(payload.models)) return undefined;
    const ids = payload.models.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const model = entry as { name?: unknown; supportedGenerationMethods?: unknown };
      if (typeof model.name !== "string" || !Array.isArray(model.supportedGenerationMethods)) return [];
      if (!model.supportedGenerationMethods.includes("generateContent")) return [];
      const id = model.name.replace(/^models\//, "").trim();
      return /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(id) ? [id] : [];
    });
    return {
      modelIds: [...new Set(ids)].slice(0, 100),
      complete: typeof payload.nextPageToken !== "string" || payload.nextPageToken.length === 0,
    };
  } catch {
    return undefined;
  }
}

function explainProviderAuthFailure(status: number, rawBody: string): string {
  const trimmed = rawBody.trim();
  if (trimmed.startsWith("{")) {
    try {
      const json = JSON.parse(trimmed) as { detail?: unknown; message?: unknown; error?: unknown };
      for (const candidate of [json.detail, json.message, json.error]) {
        if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
      }
    } catch {
      // Fall through to HTTP status wording.
    }
  }
  if (status === 401) return "HTTP 401 Unauthorized";
  if (status === 403) return "HTTP 403 Forbidden";
  return "provider authentication failed";
}

function credentialRejectionHint(connectorId: string): string {
  if (connectorId === "lse") {
    return " Use the API key from londonstrategicedge.com/data → Vault (not your site login password).";
  }
  return "";
}

export async function testConnectorCredential(connectorId: string, credential: string): Promise<ConnectorCredentialTestResult> {
  const checkedAt = new Date().toISOString();
  const connector = resolveConnectorForCredentialTest(connectorId);
  const resolvedId = connector?.id ?? connectorId.trim();
  if (!connector || connector.sourceType !== "keyed_api") {
    return {
      connectorId: resolvedId,
      state: "invalid",
      detail: connector
        ? `${connector.name} does not accept API-key verification through this flow.`
        : `Unknown connector "${connectorId.trim()}". Use a built-in provider from the catalog.`,
      checkedAt,
    };
  }
  if (!connector.adapterImplemented) {
    return {
      connectorId: resolvedId,
      state: "unreachable",
      detail: `${connector.name} is listed in the catalog, but no live adapter is implemented in this build yet. Credential was not saved.`,
      checkedAt,
    };
  }
  const normalized = normalizeProviderApiCredential(credential);
  if (normalized.rejection) {
    return { connectorId: resolvedId, state: "invalid", detail: `${normalized.rejection} Nothing was saved.`, checkedAt };
  }
  const probeFactory = getCredentialProbeFactory(connector.id);
  if (!probeFactory) {
    return {
      connectorId: resolvedId,
      state: "unreachable",
      detail: `No verification probe is registered for ${connector.name} (${connector.id}). Credential was not accepted.`,
      checkedAt,
    };
  }
  try {
    const probe = probeFactory(normalized.value);
    const response = await fetch(probe.url, {
      method: probe.method ?? "GET",
      headers: probe.headers,
      body: probe.body,
      signal: AbortSignal.timeout(8_000),
    });
    const maxResponseBytes = connector.id === "gemini" ? MAX_GEMINI_MODEL_LIST_BYTES : MAX_CREDENTIAL_PROBE_BODY_BYTES;
    const { text: rawBody, truncated: responseTruncated } = await readResponseTextBounded(response, maxResponseBytes);
    const errorBody = rawBody.slice(0, MAX_CREDENTIAL_PROBE_BODY_BYTES);
    const body = errorBody.toLowerCase();
    if (response.status === 401 || response.status === 403 || /invalid (api )?key|api key is invalid|unauthorized|authentication failed|invalid token|missing x-api-key/.test(body)) {
      const reason = explainProviderAuthFailure(response.status, errorBody);
      return {
        connectorId: resolvedId,
        state: "invalid",
        detail: `${connector.name} rejected the credential (${reason}).${credentialRejectionHint(connector.id)} Nothing was saved.`,
        checkedAt,
      };
    }
    if (response.status === 429) return { connectorId, state: "degraded", detail: `${connector.name} rate-limited the verification request. Retry before saving the credential.`, checkedAt };
    if (!response.ok) return { connectorId, state: "unreachable", detail: `${connector.name} verification returned HTTP ${response.status}. Nothing was saved.`, checkedAt };
    if (connector.id === "alpha_vantage") {
      try {
        const payload = JSON.parse(errorBody) as { "Error Message"?: string; Note?: string };
        if (payload["Error Message"] || (payload.Note && /api key|premium/i.test(payload.Note))) {
          return { connectorId, state: "invalid", detail: `${connector.name} rejected the credential. Nothing was saved.`, checkedAt };
        }
      } catch {
        return { connectorId, state: "unreachable", detail: `${connector.name} returned an unreadable verification response. Nothing was saved.`, checkedAt };
      }
    }
    const modelDiscovery = connector.id === "gemini" && !responseTruncated ? geminiChatModelDiscovery(rawBody) : undefined;
    const detail = connector.id === "gemini"
      ? responseTruncated
        ? "Google Gemini accepted the credential probe, but its model list exceeded the safe response limit; the curated model list is shown instead."
        : modelDiscovery
          ? modelDiscovery.complete
            ? `Google Gemini accepted the credential probe; ${modelDiscovery.modelIds.length} models supporting generateContent were returned.`
            : `Google Gemini accepted the credential probe; the first page returned ${modelDiscovery.modelIds.length} models supporting generateContent and more pages are available.`
          : "Google Gemini accepted the credential probe, but its model list could not be parsed; the curated model list remains unverified."
      : `${connector.name} accepted the credential probe.`;
    recordConnectorVerification(connector.id, true, detail);
    return {
      connectorId: resolvedId,
      state: "healthy",
      detail,
      checkedAt,
      ...(modelDiscovery ? { availableModels: modelDiscovery.modelIds, availableModelsComplete: modelDiscovery.complete } : {}),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "network failure";
    const friendly = /ByteString|greater than 255/i.test(message)
      ? "The API key contains characters that cannot be sent in an HTTP header. Paste only the raw key from the provider — no symbols or text copied from LiOS messages."
      : message;
    return { connectorId: resolvedId, state: "unreachable", detail: `${connector.name} could not be verified: ${friendly}. Nothing was saved.`, checkedAt };
  }
}

export async function getConnectorRegistrySnapshot(): Promise<ConnectorRegistrySnapshot> {
  const connectors = allConnectors();
  const health = await Promise.all(connectors.map((connector) =>
    resolveHealth(connector, Boolean(connector.envKey && connector.vaultKey && isCredentialAvailable(connector.envKey, connector.vaultKey))),
  ));
  return { connectors, health };
}

/**
 * User-scoped connector health: only credentials available in the request
 * identity's configured store count as configured. Server-operator env vars
 * are intentionally excluded so the setup gateway reflects the user's or
 * organization's configuration, not the developer machine's .env file.
 */
export async function getUserScopedConnectorRegistrySnapshot(): Promise<ConnectorRegistrySnapshot> {
  const connectors = allConnectors();
  const health = await Promise.all(connectors.map((connector) =>
    resolveHealth(connector, Boolean(connector.vaultKey && isUserScopedCredentialAvailable(connector.vaultKey))),
  ));
  return { connectors, health };
}

export function getConnectorById(id: string): ConnectorDefinition | undefined {
  return allConnectors().find((c) => c.id === id);
}

export function getConnectorsByCapability(contractFamily: string): ConnectorDefinition[] {
  return allConnectors().filter((c) =>
    c.capabilities.some((cap) => cap.contractFamily === contractFamily),
  );
}

export function getOperationalConnectorIds(health: ConnectorRuntimeReport[]): string[] {
  return health
    .filter((h) => h.state === "live_verified" || h.state === "credential_configured")
    .map((h) => h.connectorId);
}

export function getConnectorRuntimeState(health: ConnectorRuntimeReport[], connectorId: string): ConnectorRuntimeState {
  return health.find((h) => h.connectorId === connectorId)?.state ?? "catalog_only";
}
