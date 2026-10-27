import type { EvidenceObservation } from "@shared/trustContracts";
import { safePublicSourceUrl } from "@shared/publicSourceUrl";

/** Presentation only: canonical P3 TrustManifest remains the evidence authority. */
export interface TrustCitationItem {
  id: string;
  title: string;
  sourceRef: string;
  href: string | null;
  details: string[];
}

/**
 * Only an explicit, non-restricted public HTTPS provider reference can be an
 * external link. Project IDs, file paths, internal receipts and credentialed
 * URLs remain readable text; rendering this list never contacts the source.
 */
export function trustCitationHref(item: Pick<EvidenceObservation, "kind" | "sourceRef" | "access">): string | null {
  if (item.kind !== "provider") return null;
  const access = item.access?.state.toLowerCase() ?? "";
  if (["blocked", "restricted", "denied", "revoked", "unauthorized", "forbidden"].some(value => access.includes(value))) return null;
  const safe = safePublicSourceUrl(item.sourceRef);
  if (!safe) return null;
  try {
    const url = new URL(safe);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    // This is link filtering, not an SSRF defense or network authorization.
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
        host.endsWith(".internal") || host === "0.0.0.0" ||
        host.startsWith("[") || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
    return safe;
  } catch {
    return null;
  }
}

export function presentTrustCitations(evidence: readonly EvidenceObservation[]): TrustCitationItem[] {
  return evidence.map(item => ({
    id: item.evidenceId,
    title: item.providerLabel,
    sourceRef: item.sourceRef,
    href: trustCitationHref(item),
    details: [
      item.freshness.replaceAll("_", " "),
      item.quality + " quality",
      item.asOf ? "As of " + item.asOf : "As-of unavailable",
      ...(item.isFallback ? ["Fallback observation"] : []),
      ...(item.access ? ["Access: " + item.access.state.replaceAll("_", " ")] : []),
      ...(item.access?.servedTier ? ["Served tier: " + item.access.servedTier.replaceAll("_", " ")] : []),
      ...(item.access?.entitlementRequired ? ["Entitlement required"] : []),
      ...(item.access?.reason ? [item.access.reason] : []),
      ...item.notes,
    ],
  }));
}
