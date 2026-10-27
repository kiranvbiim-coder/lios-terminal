import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceObservation } from "@shared/trustContracts";
import { presentTrustCitations, trustCitationHref } from "./trustCitationPresentation";

const observed = (sourceRef: string, kind: EvidenceObservation["kind"] = "provider", state?: string): EvidenceObservation => ({
  evidenceId: "00000000-0000-4000-8000-000000000001",
  sourceRef, providerId: "one", providerLabel: "Recorded publisher",
  kind, observedAt: "2026-10-27T12:00:00Z", asOf: "2026-10-27T11:00:00Z",
  freshness: "feed", quality: "high", confidence: "medium", connectorState: null,
  isFallback: false, access: state ? {
    state, servedTier: null, bestAvailableTier: null, entitlementRequired: null,
    upgradeConnectorId: null, upgradeConnectorLabel: null, reason: null,
  } : null, fields: [], valueHash: null, notes: [],
});

test("only an explicit public HTTPS provider URL becomes a deliberate outbound link", () => {
  assert.equal(trustCitationHref(observed("https://publisher.example/story?id=1")), "https://publisher.example/story?id=1");
  for (const raw of [
    "javascript:alert(1)", "file:///tmp/private", "http://publisher.example/story",
    "https://localhost/token", "https://127.0.0.1/", "https://192.168.1.2/",
    "https://publisher.example/?access_token=secret", "https://user:pass@publisher.example/",
    "file:local-123", "p4://project/private", "provider:sec",
  ]) assert.equal(trustCitationHref(observed(raw)), null, raw);
  assert.equal(trustCitationHref(observed("https://publisher.example/story", "file")), null);
  for (const state of ["blocked", "restricted", "revoked", "access_denied"])
    assert.equal(trustCitationHref(observed("https://publisher.example/story", "provider", state)), null, state);
});

test("presentation retains source identity, provenance, status and original observation order", () => {
  const first = observed("project:sealed", "project");
  first.notes = ["Human verified"];
  first.isFallback = true;
  const second = observed("https://publisher.example/a");
  second.evidenceId = "00000000-0000-4000-8000-000000000002";
  const projected = presentTrustCitations([first, second]);
  assert.deepEqual(projected.map(item => item.id), [first.evidenceId, second.evidenceId]);
  assert.equal(projected[0].href, null);
  assert.equal(projected[0].sourceRef, first.sourceRef);
  assert.ok(projected[0].details.includes("Fallback observation"));
  assert.ok(projected[0].details.includes("Human verified"));
  assert.equal(projected[1].href, "https://publisher.example/a");
});

test("beUI source is reused in canonical P3 Trust panel, not an alternate evidence store", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const trustPanel = readFileSync(fileURLToPath(new URL("../components/terminal/ConversationTrustPanel.tsx", import.meta.url)), "utf8");
  const beui = readFileSync(fileURLToPath(new URL("../components/vendor/beui/BeuiCitations.tsx", import.meta.url)), "utf8");
  assert.match(trustPanel, /<BeuiCitations key=\{manifest\.trustId\} items=\{presentTrustCitations\(manifest\.evidence\)\}/);
  assert.match(beui, /starc007\/ui-components/);
  assert.match(beui, /81e5b9be45c248de16645c1554d37d7d33d8960b/);
  assert.doesNotMatch(beui, /fetch\(|useQuery\(|axios\.|<img/);
});
