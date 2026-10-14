import type { CapabilityManifestV2 } from "./dataFabric";
import type { ConnectorRuntimeState } from "./connectorRegistry";

export interface SourceRouteCandidate {
  connectorId: string;
  providerName: string;
  contractFamily: string;
  priority?: number;
  manifest: CapabilityManifestV2;
  runtimeState: ConnectorRuntimeState | null;
  entitlement: "allowed" | "denied" | "unknown";
  /** Optional field-level restriction supplied by the organization policy. */
  fields?: string[];
}

export interface SourceRouteDecision {
  contractFamily: string;
  field: string | null;
  selected: SourceRouteCandidate | null;
  considered: Array<{ connectorId: string; status: "selected" | "skipped"; reason: string }>;
  reason: string;
}

function isOperational(state: ConnectorRuntimeState | null): boolean {
  return state === "live_verified" || state === "credential_configured";
}

function manifestSupports(candidate: SourceRouteCandidate, contractFamily: string, field?: string): boolean {
  const capability = candidate.manifest.capabilities.find((entry) => entry.contractFamily === contractFamily);
  if (!capability) return false;
  if (!field) return true;
  return capability.fields.length === 0 || capability.fields.includes(field) || candidate.fields?.includes(field) === true;
}

/**
 * Deterministic provider-neutral routing. The router only selects a source
 * that advertises the requested contract, is operational in this process,
 * and has an explicit entitlement decision. No provider fallback or blend is
 * silently invented when a required field is unavailable.
 */
export function routeSource(
  contractFamily: string,
  candidates: readonly SourceRouteCandidate[],
  options: { field?: string; allowUnknownEntitlement?: boolean } = {},
): SourceRouteDecision {
  const field = options.field?.trim() || null;
  const considered: SourceRouteDecision["considered"] = [];
  const sorted = [...candidates]
    .filter((candidate) => candidate.contractFamily === contractFamily)
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0) || left.connectorId.localeCompare(right.connectorId));

  for (const candidate of sorted) {
    if (!manifestSupports(candidate, contractFamily, field ?? undefined)) {
      considered.push({ connectorId: candidate.connectorId, status: "skipped", reason: field ? `Does not advertise ${contractFamily}.${field}.` : `Does not advertise ${contractFamily}.` });
      continue;
    }
    if (!isOperational(candidate.runtimeState)) {
      considered.push({ connectorId: candidate.connectorId, status: "skipped", reason: `Runtime state is ${candidate.runtimeState ?? "unknown"}.` });
      continue;
    }
    if (candidate.entitlement === "denied") {
      considered.push({ connectorId: candidate.connectorId, status: "skipped", reason: "Organization/provider entitlement denied this source." });
      continue;
    }
    if (candidate.entitlement === "unknown" && !options.allowUnknownEntitlement) {
      considered.push({ connectorId: candidate.connectorId, status: "skipped", reason: "Entitlement is unknown; explicit authorization is required before routing." });
      continue;
    }
    considered.push({ connectorId: candidate.connectorId, status: "selected", reason: "Advertised, operational, and explicitly entitled." });
    return {
      contractFamily,
      field,
      selected: candidate,
      considered,
      reason: candidate.entitlement === "unknown"
        ? "Selected with an explicit allowUnknownEntitlement override."
        : "Selected the highest-priority eligible source.",
    };
  }

  return {
    contractFamily,
    field,
    selected: null,
    considered,
    reason: field
      ? `No eligible source advertises ${contractFamily}.${field}.`
      : `No eligible source advertises ${contractFamily}.`,
  };
}
