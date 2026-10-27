import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { trustManifestSchema, type TrustManifest } from "@shared/trustContracts";
import {
  describeObservationRights,
  inspectEvidenceClaim,
  inspectEvidenceClaimObservedBy,
  claimObservedTimeChoices,
  readableAssumptionValue,
} from "./evidencePrism";
import EvidencePrism from "../components/terminal/EvidencePrism";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_ID = "22222222-2222-4222-8222-222222222222";
const EVIDENCE_ID = "33333333-3333-4333-8333-333333333333";
const RECEIPT_ID = "44444444-4444-4444-8444-444444444444";

function fixture(): TrustManifest {
  return trustManifestSchema.parse({
    schemaVersion: "1",
    trustId: "55555555-5555-4555-8555-555555555555",
    requestId: REQUEST_ID,
    generatedAt: "2026-10-24T10:00:00Z",
    sourceScope: "auto",
    summary: {
      freshness: "delayed", quality: "medium", confidence: "medium",
      conflictState: "none", evidenceCoveragePct: 50, sourceCount: 1,
      receiptCount: 1, missingCount: 1,
    },
    evidence: [{
      evidenceId: EVIDENCE_ID, sourceRef: "provider:fred", providerId: "fred",
      providerLabel: "FRED macro", kind: "provider",
      observedAt: "2026-10-24T09:00:00Z", asOf: "2026-09-30T00:00:00Z",
      freshness: "delayed", quality: "medium", confidence: "medium",
      access: { state: "limited", servedTier: "delayed", entitlementRequired: true, reason: "Paid access required" },
      fields: ["CPI"], isFallback: true,
    }],
    claims: [{
      claimId: CLAIM_ID, label: "Inflation claim",
      path: "macro.cpi", status: "partial", confidence: "medium",
      sourceRefs: ["provider:fred", "provider:unknown", "provider:fred"],
      receiptIds: [RECEIPT_ID], formulaRefs: ["year_on_year_change"],
      assumptionRefs: ["assumption:period", "assumption:missing"],
      explanation: "One observed provider; historical period assumption.",
    }],
    assumptions: [{
      ref: "assumption:period", label: "Period", value: "FY2026",
      source: "user",
    }],
  });
}

test("WS-30: a claim opens only exact recorded P3 sources, never similar names or fabricated units", () => {
  const manifest = fixture();
  const inspected = inspectEvidenceClaim(manifest, CLAIM_ID);
  assert.ok(inspected);
  assert.equal(inspected.unit, null, "the canonical trust schema has no unit field");
  assert.deepEqual(inspected.sources.map(s => s.ref), ["provider:fred", "provider:unknown"]);
  assert.deepEqual(inspected.sources.map(s => s.observations.length), [1, 0]);
  assert.equal(inspected.sources[0].observations[0].providerLabel, "FRED macro");
  assert.equal(inspected.sources[0].observations[0].asOf, "2026-09-30T00:00:00Z");
  assert.equal(inspected.sources[0].observations[0].kind, "provider");
  assert.equal(inspected.missingSourceCount, 1);
  assert.equal(inspected.missingAssumptionCount, 1);
  assert.deepEqual(inspected.assumptions.map(a => a.record?.label ?? null), ["Period", null]);
  assert.deepEqual(inspected.receiptIds, [RECEIPT_ID]);
  assert.deepEqual(inspected.formulaRefs, ["year_on_year_change"]);
  assert.equal(inspectEvidenceClaim(manifest, "66666666-6666-4666-8666-666666666666"), null);
});

test("WS-30: a supported claim with a missing source never gains a fake observation", () => {
  const manifest = fixture();
  const claim = manifest.claims[0];
  const changed: TrustManifest = {
    ...manifest,
    evidence: manifest.evidence.map(e => ({ ...e, sourceRef: "provider:unrelated", providerLabel: "FRED macro" })),
    claims: [{ ...claim, status: "supported", sourceRefs: ["provider:fred"] }],
  };
  const inspected = inspectEvidenceClaim(changed, CLAIM_ID);
  assert.equal(inspected?.missingSourceCount, 1);
  assert.deepEqual(inspected?.sources[0].observations, []);
});

test("WS-30: entitlements are reported verbatim and never inferred from health, labels or quality", () => {
  const observation = fixture().evidence[0];
  const restricted = describeObservationRights(observation);
  assert.match(restricted, /Recorded access: limited/);
  assert.match(restricted, /served tier delayed/);
  assert.match(restricted, /entitlement required/);
  assert.match(restricted, /Paid access required/);
  assert.match(describeObservationRights({ ...observation, access: null }), /no usage grant established/);
  assert.match(describeObservationRights({ ...observation, access: { ...observation.access!, entitlementRequired: null } }), /not assessed/);
});

test("WS-30: private structured assumption values do not become synthetic formatted facts", () => {
  assert.equal(readableAssumptionValue(0.07), "0.07");
  assert.equal(readableAssumptionValue(false), "false");
  assert.equal(readableAssumptionValue(null), "null (recorded)");
  assert.match(readableAssumptionValue({ secret: "never render me" }), /Structured value recorded/);
  assert.ok(!readableAssumptionValue({ secret: "never render me" }).includes("never render me"));
});

test("WS-30: claim list is interactive but evidence stays behind deliberate disclosure", () => {
  const html = renderToStaticMarkup(React.createElement(EvidencePrism, { manifest: fixture() }));
  assert.match(html, /data-testid="ws30-evidence-prism"/);
  assert.match(html, /Evidence Prism claim inspection/);
  assert.match(html, /Inflation claim/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-controls=/);
  assert.doesNotMatch(html, /Paid access required|assumption:period|No matching observation/, "closed claims do not expose detailed evidence");
  const src = readFileSync(fileURLToPath(new URL("../components/terminal/EvidencePrism.tsx", import.meta.url)), "utf8");
  assert.match(src, /onClick=\{\(\) => setSelectedId/);
  assert.match(src, /role="region"/);
  assert.match(src, /Unit: /);
  assert.match(src, /Not recorded in trust manifest/);
  assert.match(src, /inspectEvidenceClaim\(manifest, selectedId\)/);
  assert.match(src, /describeObservationRights\(observation\)/);
  const panel = readFileSync(fileURLToPath(new URL("../components/terminal/ConversationTrustPanel.tsx", import.meta.url)), "utf8");
  assert.match(panel, /<EvidencePrism key=\{manifest.trustId\} manifest=\{manifest\}/);
});

test("WS-30: empty claims render no extra inspector chrome", () => {
  const manifest = { ...fixture(), claims: [] };
  assert.equal(renderToStaticMarkup(React.createElement(EvidencePrism, { manifest })), "");
});

test("B05–B06 Evidence Time Machine selects exact recorded P3 observations without reclassifying the claim", () => {
  const { inspectEvidenceClaimObservedBy, claimObservedTimeChoices } = requirePrismTimeExports();
  const initial=fixture();
  const recent=initial.evidence[0];
  const manifest: TrustManifest={...initial,evidence:[
    {...recent,evidenceId:"77777777-7777-4777-8777-777777777777",observedAt:"2026-10-24T08:00:00Z",providerLabel:"Earlier recorded provider"},
    recent,
  ]};
  const times=claimObservedTimeChoices(manifest,CLAIM_ID);
  assert.deepEqual(times,["2026-10-24T08:00:00.000Z","2026-10-24T09:00:00.000Z"]);
  const earlier=inspectEvidenceClaimObservedBy(manifest,CLAIM_ID,times[0]);
  assert.deepEqual(earlier?.sources[0].observations.map(item=>item.providerLabel),["Earlier recorded provider"]);
  assert.equal(earlier?.missingSourceCount,1);
  assert.equal(earlier?.claim.status,"partial");
  const missing=inspectEvidenceClaimObservedBy(manifest,CLAIM_ID,"2026-10-24T07:00:00Z");
  assert.equal(missing?.sources[0].observations.length,0);
  assert.equal(missing?.missingSourceCount,2);
  assert.equal(inspectEvidenceClaimObservedBy(manifest,CLAIM_ID,"2026-10-24T08:00:00"),null);
  assert.equal(inspectEvidenceClaimObservedBy(manifest,CLAIM_ID,"2026-02-30T08:00:00Z"),null);
  assert.equal(inspectEvidenceClaimObservedBy(manifest,CLAIM_ID,null)?.sources[0].observations.length,2);
  assert.deepEqual(initial.evidence.map(x=>x.providerLabel),["FRED macro"]);
});
function requirePrismTimeExports() {
  return { inspectEvidenceClaimObservedBy, claimObservedTimeChoices };
}
