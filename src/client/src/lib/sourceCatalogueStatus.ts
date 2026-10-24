import type { SourceRegistryItem } from "@shared/sourceRegistry";

/**
 * Display-only interpretation of the canonical per-user SourceRegistry record.
 * A saved connection, a successful check and a legal AI-use grant are three
 * different facts; none of these labels is an execution/entitlement decision.
 */
export interface SourceCatalogueStatus {
  connection: string;
  runtime: string;
  requiresAttention: boolean;
  advisory: string;
}

export function sourceCatalogueStatus(item: SourceRegistryItem): SourceCatalogueStatus {
  const adapterMissing = !item.adapterImplemented;
  if (item.kind === "catalog") {
    return {
      connection: "Catalog listing · not saved",
      runtime: adapterMissing ? "No runtime adapter"
        : item.state === "live_verified" ? "Adapter recently verified"
        : item.state === "credential_configured" ? "Adapter configured · no live check"
        : item.state === "rate_limited" ? "Adapter rate limited"
        : item.state === "degraded" ? "Adapter degraded"
        : item.state === "disabled" ? "Adapter disabled"
        : "Adapter available · not verified",
      requiresAttention: adapterMissing || ["disabled", "degraded", "rate_limited"].includes(item.state),
      advisory: "Listing a provider does not connect your account or authorize source use.",
    };
  }
  return {
    connection: "Saved connection",
    runtime: adapterMissing ? "No runtime adapter"
      : item.state === "healthy" ? "Last connection test healthy"
      : item.state === "configured" ? "Configured · not verified"
      : item.state === "unreachable" ? "Connection unreachable"
      : item.state === "degraded" ? "Connection degraded"
      : item.state === "invalid" ? "Invalid configuration"
      : "Connection status needs review",
    requiresAttention: adapterMissing || !item.operational,
    advisory: "A saved connection or successful check does not grant AI transmission, export or redistribution rights.",
  };
}

/** Compact, truthful coverage label from the existing registry, not a new source authority. */
export function sourceCatalogueCoverage(item: SourceRegistryItem): string | null {
  const families = [...new Set(item.capabilities.map(c => c.contractFamily.trim()).filter(Boolean))];
  if (!families.length) return null;
  const display = families.slice(0, 3).join(" · ");
  return families.length > 3 ? `${display} · +${families.length - 3} more` : display;
}
