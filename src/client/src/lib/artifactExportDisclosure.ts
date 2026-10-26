import type { TrustManifest } from "@shared/trustContracts";
import { recordedBlockedArtifactSources } from "@shared/artifactExportRights";

/** Presentation of recorded evidence only; recipient rights remain independently required. */
export function artifactExportDisclosure(manifest: TrustManifest | null, sourceRefs: readonly string[]) {
  const blockedSourceCount = recordedBlockedArtifactSources(manifest);
  const rightsReviewRequired = (manifest?.evidence ?? []).some(item => item.access?.entitlementRequired === true
    || /^(restricted|license_required|entitlement_required|unknown)$/i.test(item.access?.state ?? ""));
  return {
    blocked: blockedSourceCount > 0,
    blockedSourceCount,
    rightsReviewRequired,
    sourceCount: sourceRefs.length,
    note: blockedSourceCount > 0
      ? `${blockedSourceCount} recorded source${blockedSourceCount === 1 ? "" : "s"} show denied, revoked or expired access. Export is blocked until permissions and evidence are reviewed.`
      : rightsReviewRequired
        ? "Some source records require an entitlement or rights review. The export plan does not grant redistribution rights."
        : sourceRefs.length > 0 && !manifest
          ? "This saved revision has source references but no recorded trust manifest. Verify access and redistribution rights before downloading."
          : "An export creates a local copy of this recorded revision. You are responsible for authorized use and redistribution; this action does not grant recipient access or source rights.",
  };
}
