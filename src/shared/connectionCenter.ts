/**
 * LiOS V4 Connection Center contracts.
 *
 * This module is intentionally provider-neutral and shared by client/server.
 * It defines the setup lifecycle and persistence boundary without implementing
 * provider-specific transport, schema mapping, or credential custody.
 */
import { validateDiscoveryPath } from "./sourceDiscovery";

export const CONNECTION_CENTER_CATEGORIES = [
  {
    id: "data_providers",
    label: "Data Providers",
    description: "Market, fundamentals, macro, filings and other licensed/public data sources.",
  },
  {
    id: "databases",
    label: "Databases",
    description: "PostgreSQL, MySQL, SQLite and DuckDB sources under your control.",
  },
  {
    id: "files",
    label: "Files",
    description: "Local files, folders and user-controlled storage sources.",
  },
  {
    id: "ai_providers",
    label: "AI Providers",
    description: "Bring your own cloud or local AI provider. AI remains optional.",
  },
  {
    id: "communications",
    label: "Communications",
    description: "Mail, collaboration and webhook connections for later communication workflows.",
  },
] as const;

export type ConnectionCenterCategoryId = typeof CONNECTION_CENTER_CATEGORIES[number]["id"];

export const CONNECTOR_SETUP_STAGES = [
  "configure",
  "validate",
  "test",
  "discover",
  "save",
  "health",
] as const;

export type ConnectorSetupStage = typeof CONNECTOR_SETUP_STAGES[number];

export type ConnectorSetupState =
  | "draft"
  | "invalid"
  | "ready_to_test"
  | "testing"
  | "test_failed"
  | "verified"
  | "configured"
  | "healthy"
  | "degraded"
  | "unavailable";

export type DataProviderAuthMode = "none" | "bearer" | "x-api-key";
export type DataProviderProtocol = "rest";
export type DataProviderMethod = "GET" | "POST";

/**
 * Raw wizard draft. `credential` is deliberately ephemeral and MUST NOT be
 * copied into the persisted source-connection config.
 */
export interface DataProviderSetupDraft {
  name: string;
  endpoint: string;
  protocol: DataProviderProtocol;
  method?: DataProviderMethod;
  authMode: DataProviderAuthMode;
  credential: string;
  credentialRef?: string | null;
  responsePath?: string;
  pageParam?: string;
  pageSizeParam?: string;
  pageSize?: number;
  maxPages?: number;
}

export interface ConnectionValidationIssue {
  field: "name" | "endpoint" | "credential" | "responsePath" | "pagination";
  code:
    | "required"
    | "invalid_url"
    | "unsupported_protocol"
    | "embedded_credentials"
    | "insecure_remote_endpoint"
    | "credential_required"
    | "invalid_response_path"
    | "invalid_pagination";
  message: string;
}

export interface ConnectionValidationResult {
  valid: boolean;
  issues: ConnectionValidationIssue[];
}

export interface PersistableDataProviderConnection {
  connectorId: "private_api";
  name: string;
  sourceType: "private_api";
  config: {
    endpoint: string;
    protocol: DataProviderProtocol;
    method: DataProviderMethod;
    authMode: DataProviderAuthMode;
    responsePath?: string;
    pageParam?: string;
    pageSizeParam?: string;
    pageSize?: number;
    maxPages?: number;
  };
  credentialRef: string | null;
}

export interface NormalizedConnectionTestResult {
  state: Extract<ConnectorSetupState, "verified" | "test_failed" | "configured" | "degraded" | "unavailable">;
  detail: string;
  verified: boolean;
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost"
    || normalized === "127.0.0.1"
    || normalized === "::1"
    || normalized === "[::1]";
}

/**
 * Validation used before a generic provider can be tested.
 * Remote HTTP endpoints are rejected; loopback HTTP is allowed for local
 * development/provider sidecars. URL-embedded credentials are never allowed.
 */
export function validateDataProviderDraft(
  draft: DataProviderSetupDraft,
  options: { requireCredential?: boolean } = {},
): ConnectionValidationResult {
  const issues: ConnectionValidationIssue[] = [];
  const name = draft.name.trim();
  const endpoint = draft.endpoint.trim();

  if (!name) {
    issues.push({ field: "name", code: "required", message: "Provider name is required." });
  }

  if (!endpoint) {
    issues.push({ field: "endpoint", code: "required", message: "Endpoint URL is required." });
  } else {
    try {
      const parsed = new URL(endpoint);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        issues.push({ field: "endpoint", code: "unsupported_protocol", message: "Provider endpoint must use HTTP or HTTPS." });
      }
      if (parsed.username || parsed.password) {
        issues.push({ field: "endpoint", code: "embedded_credentials", message: "Do not place credentials in the endpoint URL." });
      }
      if (parsed.protocol === "http:" && !isLoopbackHostname(parsed.hostname)) {
        issues.push({ field: "endpoint", code: "insecure_remote_endpoint", message: "Remote provider endpoints must use HTTPS." });
      }
    } catch {
      issues.push({ field: "endpoint", code: "invalid_url", message: "Enter a valid provider endpoint URL." });
    }
  }

  const pathValidation = validateDiscoveryPath(draft.responsePath);
  if (!pathValidation.valid) {
    issues.push({ field: "responsePath", code: "invalid_response_path", message: pathValidation.reason });
  }

  if (draft.pageSize !== undefined && (!Number.isInteger(draft.pageSize) || draft.pageSize < 1 || draft.pageSize > 1_000)) {
    issues.push({ field: "pagination", code: "invalid_pagination", message: "Page size must be an integer from 1 to 1000." });
  }
  if (draft.maxPages !== undefined && (!Number.isInteger(draft.maxPages) || draft.maxPages < 1 || draft.maxPages > 50)) {
    issues.push({ field: "pagination", code: "invalid_pagination", message: "Maximum pages must be an integer from 1 to 50." });
  }

  if (options.requireCredential && draft.authMode !== "none" && !draft.credential.trim() && !draft.credentialRef) {
    issues.push({ field: "credential", code: "credential_required", message: "A credential is required for the selected authentication mode." });
  }

  return { valid: issues.length === 0, issues };
}

/**
 * Creates the source-connection payload. The return type has no credential
 * property by design, making accidental secret persistence harder.
 */
export function buildPersistableDataProviderConnection(
  draft: DataProviderSetupDraft,
  credentialRef: string | null,
): PersistableDataProviderConnection {
  const validation = validateDataProviderDraft(draft);
  if (!validation.valid) {
    throw new Error(validation.issues[0]?.message ?? "Invalid provider connection draft.");
  }

  const config: PersistableDataProviderConnection["config"] = {
    endpoint: draft.endpoint.trim(),
    protocol: "rest",
    method: draft.method ?? "GET",
    authMode: draft.authMode,
  };
  if (draft.responsePath?.trim()) config.responsePath = draft.responsePath.trim();
  if (draft.pageParam?.trim()) config.pageParam = draft.pageParam.trim();
  if (draft.pageSizeParam?.trim()) config.pageSizeParam = draft.pageSizeParam.trim();
  if (draft.pageSize !== undefined) config.pageSize = draft.pageSize;
  if (draft.maxPages !== undefined) config.maxPages = draft.maxPages;

  return {
    connectorId: "private_api",
    name: draft.name.trim(),
    sourceType: "private_api",
    config,
    credentialRef: draft.authMode === "none" ? null : credentialRef,
  };
}

/**
 * Converts existing setup-service states into one honest V4 test result.
 * Only explicit healthy/live-verified responses count as verification.
 */
export function normalizeConnectionTestResult(status: string | null | undefined, detail?: string | null): NormalizedConnectionTestResult {
  const normalized = (status ?? "").toLowerCase();
  const message = detail?.trim() || "No connection-test detail was returned.";

  if (normalized === "healthy" || normalized === "live_verified") {
    return { state: "verified", detail: message, verified: true };
  }
  if (normalized === "configured" || normalized === "credential_configured") {
    return { state: "configured", detail: message, verified: false };
  }
  if (normalized === "degraded" || normalized === "rate_limited" || normalized === "unreachable") {
    return { state: "degraded", detail: message, verified: false };
  }
  if (normalized === "unavailable" || normalized === "disabled" || normalized === "adapter_available" || normalized === "catalog_only") {
    return { state: "unavailable", detail: message, verified: false };
  }
  return { state: "test_failed", detail: message, verified: false };
}

export function canAdvanceConnectionSetup(state: ConnectorSetupState, nextStage: ConnectorSetupStage): boolean {
  switch (nextStage) {
    case "configure":
      return true;
    case "validate":
      return state !== "testing";
    case "test":
      return state === "ready_to_test" || state === "test_failed" || state === "degraded" || state === "configured" || state === "unavailable";
    case "discover":
      return state === "verified" || state === "healthy";
    case "save":
      return state === "verified" || state === "healthy" || state === "configured";
    case "health":
      return state === "verified" || state === "healthy" || state === "configured" || state === "degraded" || state === "unavailable";
  }
}
