import { z } from "zod";
import type {
  ConnectorRegistrySnapshot,
  ConnectorRuntimeReport,
  ConnectorRuntimeState,
} from "./connectorRegistry";
import { isConnectorRuntimeOperational } from "./connectorRegistry";

export const localSourceMonitorSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  folderPath: z.string().trim().min(1).max(2_000),
  includeExtensions: z.array(z.string().trim().regex(/^\.[A-Za-z0-9][A-Za-z0-9._-]*$/)).max(50).default([]),
  pollIntervalSeconds: z.number().int().min(10).max(86_400).default(300),
  recursive: z.boolean().default(true),
  enabled: z.boolean().default(true),
}).strict();
export type LocalSourceMonitor = z.infer<typeof localSourceMonitorSchema>;

export interface LocalSourceMonitorValidation {
  valid: boolean;
  value: LocalSourceMonitor | null;
  reason: string | null;
}

function isAbsolutePath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

/**
 * Validates a local-folder monitor without touching the filesystem. The
 * server performs the actual permission/existence check when the monitor is
 * saved; this shared gate rejects traversal and ambiguous relative paths in
 * both the desktop and hosted clients.
 */
export function validateLocalSourceMonitor(input: unknown): LocalSourceMonitorValidation {
  const parsed = localSourceMonitorSchema.safeParse(input);
  if (!parsed.success) return { valid: false, value: null, reason: parsed.error.issues[0]?.message ?? "Invalid local source monitor." };
  const folderPath = parsed.data.folderPath;
  if (folderPath.includes("\0")) return { valid: false, value: null, reason: "Folder path must not contain a null byte." };
  if (!isAbsolutePath(folderPath)) return { valid: false, value: null, reason: "Folder path must be absolute; relative paths are not accepted." };
  const segments = folderPath.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) return { valid: false, value: null, reason: "Folder path traversal is not allowed." };
  return { valid: true, value: parsed.data, reason: null };
}

export type CommunicationPlaceholderId = "gmail" | "microsoft_365" | "imap" | "smtp" | "slack" | "teams" | "webhook";

export interface CommunicationConnectorPlaceholder {
  id: CommunicationPlaceholderId;
  label: string;
  authMode: "oauth" | "basic" | "api_key" | "none";
  operations: readonly ("read" | "send" | "webhook")[];
  state: "placeholder";
  sideEffectsRequireConfirmation: true;
  note: string;
}

/** Communication catalog entries are intentionally non-executable in Wave B. */
export const COMMUNICATION_CONNECTOR_PLACEHOLDERS: readonly CommunicationConnectorPlaceholder[] = [
  { id: "gmail", label: "Gmail", authMode: "oauth", operations: ["read", "send"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "OAuth contract only; no mailbox read/send adapter is enabled by this catalog entry." },
  { id: "microsoft_365", label: "Microsoft 365", authMode: "oauth", operations: ["read", "send"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "OAuth contract only; tenant consent and Graph scopes remain explicit setup work." },
  { id: "imap", label: "IMAP", authMode: "basic", operations: ["read"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "Read-only mailbox contract; credentials must remain in the encrypted custody boundary." },
  { id: "smtp", label: "SMTP", authMode: "basic", operations: ["send"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "Send contract only; every outbound send requires explicit user authorization and an audit event." },
  { id: "slack", label: "Slack", authMode: "oauth", operations: ["read", "send"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "OAuth contract only; channel scopes and send authorization are not inferred." },
  { id: "teams", label: "Microsoft Teams", authMode: "oauth", operations: ["read", "send"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "OAuth contract only; tenant scopes and send authorization are not inferred." },
  { id: "webhook", label: "Webhook", authMode: "api_key", operations: ["webhook"], state: "placeholder", sideEffectsRequireConfirmation: true, note: "Outbound webhook contract only; destination allow-listing is required before execution." },
];

export interface ConnectionHealthSummary {
  generatedAt: string;
  totalConnectors: number;
  byState: Record<ConnectorRuntimeState, number>;
  operationalConnectorIds: string[];
  attentionConnectorIds: string[];
  capabilityFamilies: string[];
  coverageByCapability: Record<string, { connectorIds: string[]; operationalConnectorIds: string[] }>;
}

const ALL_RUNTIME_STATES: readonly ConnectorRuntimeState[] = [
  "catalog_only", "adapter_available", "credential_configured", "live_verified", "degraded", "rate_limited", "disabled",
];

export function buildConnectionHealthSummary(
  snapshot: ConnectorRegistrySnapshot,
  generatedAt = new Date().toISOString(),
): ConnectionHealthSummary {
  const healthById = new Map(snapshot.health.map((report) => [report.connectorId, report]));
  const byState = Object.fromEntries(ALL_RUNTIME_STATES.map((state) => [state, 0])) as Record<ConnectorRuntimeState, number>;
  const operationalConnectorIds: string[] = [];
  const attentionConnectorIds: string[] = [];
  const coverageByCapability: ConnectionHealthSummary["coverageByCapability"] = {};
  for (const connector of snapshot.connectors) {
    const state = healthById.get(connector.id)?.state ?? (connector.adapterImplemented ? "adapter_available" : "catalog_only");
    byState[state] += 1;
    if (isConnectorRuntimeOperational(state)) operationalConnectorIds.push(connector.id);
    if (["degraded", "rate_limited", "disabled"].includes(state)) attentionConnectorIds.push(connector.id);
    for (const capability of connector.capabilities) {
      const entry = coverageByCapability[capability.contractFamily] ?? { connectorIds: [], operationalConnectorIds: [] };
      if (!entry.connectorIds.includes(connector.id)) entry.connectorIds.push(connector.id);
      if (isConnectorRuntimeOperational(state) && !entry.operationalConnectorIds.includes(connector.id)) entry.operationalConnectorIds.push(connector.id);
      coverageByCapability[capability.contractFamily] = entry;
    }
  }
  for (const entry of Object.values(coverageByCapability)) {
    entry.connectorIds.sort();
    entry.operationalConnectorIds.sort();
  }
  return {
    generatedAt,
    totalConnectors: snapshot.connectors.length,
    byState,
    operationalConnectorIds: operationalConnectorIds.sort(),
    attentionConnectorIds: attentionConnectorIds.sort(),
    capabilityFamilies: Object.keys(coverageByCapability).sort(),
    coverageByCapability,
  };
}

export interface OnboardingConnectionReadiness {
  state: "needs_connection" | "ready" | "attention";
  connectedCount: number;
  operationalCount: number;
  nextAction: "open_connection_center" | "continue_to_workspace" | "review_connection_health";
  reason: string;
}

/**
 * The first-run shell can use this small decision instead of duplicating
 * provider-health heuristics. It never treats a catalog-only connector as a
 * completed onboarding connection.
 */
export function resolveOnboardingConnectionReadiness(input: {
  connectedCount: number;
  health: Pick<ConnectorRuntimeReport, "state">[];
}): OnboardingConnectionReadiness {
  const operationalCount = input.health.filter((report) => isConnectorRuntimeOperational(report.state)).length;
  const attentionCount = input.health.filter((report) => ["degraded", "rate_limited", "disabled"].includes(report.state)).length;
  if (operationalCount > 0 && attentionCount === 0) return { state: "ready", connectedCount: input.connectedCount, operationalCount, nextAction: "continue_to_workspace", reason: "At least one source is operational and no connection needs attention." };
  if (operationalCount > 0 && attentionCount > 0) return { state: "attention", connectedCount: input.connectedCount, operationalCount, nextAction: "review_connection_health", reason: "A usable source exists, but one or more configured sources need attention." };
  return { state: "needs_connection", connectedCount: input.connectedCount, operationalCount, nextAction: "open_connection_center", reason: "Connect and verify at least one source before relying on live data." };
}
