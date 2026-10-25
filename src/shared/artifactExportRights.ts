import type { TrustManifest } from "./trustContracts";

/**
 * Canonical explicit recorded-denial classifier for both P4 server export plan
 * and renderer. This does not infer rights from missing data, nor substitute
 * for a current source licensing/redistribution check.
 */
export function recordedBlockedArtifactSources(manifest: TrustManifest | null): number {
  if (!manifest) return 0;
  const denied = /^(denied|blocked|revoked|forbidden|unauthorized|not_authorized|rights_revoked|access_denied|entitlement_denied|license_expired|expired)$/i;
  return manifest.evidence.filter((item) =>
    Boolean(item.access && denied.test(item.access.state.trim().replace(/[\s-]+/g, "_")))).length;
}
