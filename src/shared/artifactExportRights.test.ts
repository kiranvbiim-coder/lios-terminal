import assert from "node:assert/strict";
import test from "node:test";
import type { TrustManifest } from "./trustContracts";
import { recordedBlockedArtifactSources } from "./artifactExportRights";

function evidence(...states: string[]): TrustManifest {
  return { evidence: states.map((state, index) => ({
    evidenceId: `src-${index}`, access: { state },
  })) } as unknown as TrustManifest;
}

test("WS-63 server and client share explicit recorded-denial policy", () => {
  for (const state of [
    "denied", "blocked", "revoked", "forbidden", "unauthorized", "not authorized",
    "rights_revoked", "access-denied", "entitlement_denied", "license_expired", "expired",
  ]) {
    assert.equal(recordedBlockedArtifactSources(evidence(state)), 1, state);
  }
  assert.equal(recordedBlockedArtifactSources(evidence("allowed", "current", "licensed")), 0);
  assert.equal(recordedBlockedArtifactSources(evidence("allowed", "revoked", "expired")), 2);
  assert.equal(recordedBlockedArtifactSources(null), 0);
});
