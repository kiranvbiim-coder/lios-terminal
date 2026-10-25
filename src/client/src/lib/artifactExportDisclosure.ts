import type { TrustManifest } from "@shared/trustContracts";

export interface ArtifactExportDisclosure {
  blocked: boolean;
  blockedSourceCount: number;
  rightsReviewRequired: boolean;
  sourceCount: number;
  note: string;
}

/**
 * Presentation-only conservative safety check over the original P3 evidence.
 * Never confuses an explicit revoked/denied/blocked access record with a valid
 * permission. This does NOT replace server export authorization or current
 * per-recipient redistribution permission.
 */
export function artifactExportDisclosure(
  manifest: TrustManifest | null,
  sourceRefs: readonly string[],
): ArtifactExportDisclosure {
  const evidence = manifest?.evidence ?? [];
  const revokedStates = /^(denied|blocked|revoked|forbidden|unauthorized|not_authorized|rights_revoked|access_denied|entitlement_denied|license_expired|expired)$/i;
  const blockedSourceCount = evidence.filter((item) =>
    Boolean(item.access && revokedStates.test(item.access.state.trim().replace(/[\s-]+/g, "_")))).length;
  const rightsReviewRequired = evidence.some((item) => item.access?.entitlementRequired === true
    || /^(restricted|license_required|entitlement_required|unknown)$/i.test(item.access?.state ?? ""));
  const sourceCount = sourceRefs.length;
  return {
    blocked: blockedSourceCount > 0,
    blockedSourceCount,
    rightsReviewRequired,
    sourceCount,
    note: blockedSourceCount > 0
      ? `${blockedSourceCount} recorded source${blockedSourceCount === 1 ? "" : "s"} show denied, revoked or expired access. Export is blocked until permissions and evidence are reviewed.`
      : rightsReviewRequired
        ? "Some source records require an entitlement or rights review. The export plan does not grant redistribution rights."
        : sourceCount > 0 && !manifest
          ? "This saved revision has source references but no recorded trust manifest. Verify access and redistribution rights before downloading."
          : "An export creates a local copy of this recorded revision. You are responsible for authorized use and redistribution; this action does not grant recipient access or source rights.",
  };
}
