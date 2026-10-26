import type { TrustManifest } from "./trustContracts";

/** Recorded denial is a veto, never a replacement for current source authorization. */
export function recordedBlockedArtifactSources(manifest: TrustManifest | null): number {
  if (!manifest) return 0;
  const denied = /^(denied|blocked|revoked|forbidden|unauthorized|not_authorized|rights_revoked|access_denied|entitlement_denied|license_expired|expired)$/i;
  return manifest.evidence.filter(item => Boolean(item.access && denied.test(item.access.state.trim().replace(/[\s-]+/g, "_")))).length;
}
