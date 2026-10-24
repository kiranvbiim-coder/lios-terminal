import assert from "node:assert/strict";
import test from "node:test";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { trustManifestSchema, type TrustManifest } from "@shared/trustContracts";
import { reviewEvidenceExceptions, recordedSourceAccess, sourceExceptionCaveats } from "./evidenceExceptions";
import EvidenceExceptionDetails from "../components/terminal/EvidenceExceptionDetails";
import ConversationTrustPanel from "../components/terminal/ConversationTrustPanel";
import { trustCaveats } from "../components/terminal/ConversationRuntimeTrace";

const REQUEST = "11111111-1111-4111-8111-111111111111";
const C1 = "22222222-2222-4222-8222-222222222222";
const C2 = "33333333-3333-4333-8333-333333333333";
function observation(evidenceId: string, sourceRef: string, state: string | null, overrides: Record<string, unknown> = {}) {
  return {
    evidenceId, sourceRef, providerId: sourceRef, providerLabel: `Recorded ${sourceRef}`,
    kind: "provider", observedAt: "2026-10-24T10:00:00Z", asOf: "2026-09-30T00:00:00Z",
    freshness: "delayed", quality: "medium", confidence: "medium",
    access: state ? { state, entitlementRequired: state === "restricted", reason: null } : null,
    ...overrides,
  };
}
function fixture(): TrustManifest {
  return trustManifestSchema.parse({
    schemaVersion: "1",
    trustId: "55555555-5555-4555-8555-555555555555",
    requestId: REQUEST,
    generatedAt: "2026-10-24T10:30:00Z",
    sourceScope: "auto",
    summary: { freshness: "delayed", quality: "medium", confidence: "low",
      conflictState: "material", evidenceCoveragePct: 25, sourceCount: 3, receiptCount: 0, missingCount: 1 },
    evidence: [
      observation("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "provider:alpha", "revoked"),
      observation("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "provider:beta", "allowed"),
      observation("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "provider:beta", null),
    ],
    claims: [
      { claimId: C1, label: "Revenue conflict", path: "revenue",
        status: "conflicted", confidence: "low", sourceRefs: ["provider:alpha", "provider:beta"],
        explanation: "Different filed figures." },
      { claimId: C2, label: "Margin estimate", path: "margin",
        status: "supported", confidence: "high", sourceRefs: ["provider:missing"], explanation: "A recorded assertion." },
    ],
    conflicts: [{
      field: "revenue", state: "material",
      sourceRefs: ["provider:alpha", "provider:beta", "provider:missing"],
      relativeDifference: 0.17, summary: "Sources disagree on revenue; neither amount is silently preferred.",
    }],
    missing: [{ field: "margin", reason: "No entitled source available", recoveryActions: ["Review source entitlement"] }],
  });
}

test("WS-31 joins contradictory observations by exact ref, preserves multiple rows and unresolved references", () => {
  const result = reviewEvidenceExceptions(fixture());
  assert.equal(result.conflicts.length, 1);
  const conflict = result.conflicts[0];
  assert.equal(conflict.differencePct, 17);
  assert.deepEqual(conflict.sourceRefs, ["provider:alpha", "provider:beta", "provider:missing"]);
  assert.deepEqual(conflict.sources.map(source => source.observations.length), [1, 2, 0]);
  assert.equal(conflict.sources[0].observations[0].access?.state, "revoked");
  assert.deepEqual(result.recoveryActions, ["Review source entitlement"]);
  assert.ok(result.unknown.some(value => value.claimId === C2 && /missing from the recorded evidence/.test(value.message)));
});

test("WS-31 recorded revocation is blocked but unknown never becomes either denied or allowed", () => {
  const observations = fixture().evidence;
  assert.equal(recordedSourceAccess(observations[0]).level, "blocked");
  assert.equal(recordedSourceAccess(observations[1]).level, "recorded");
  assert.equal(recordedSourceAccess(observations[2]).level, "unknown");
  assert.match(recordedSourceAccess(observations[1]).label, /not a live rights check/);
  for (const state of ["entitlement_denied", "policy-denied", "revoked", "expired"]) {
    assert.equal(recordedSourceAccess({ ...observations[0], access: { ...observations[0].access!, state } }).level, "blocked");
  }
  for (const state of ["rate_limited", "limited", "degraded"]) {
    assert.equal(recordedSourceAccess({ ...observations[0], access: { ...observations[0].access!, state } }).level, "restricted");
  }
  assert.equal(recordedSourceAccess({ ...observations[1], access: null, connectorState: "disabled" }).level, "blocked");
  assert.equal(recordedSourceAccess({ ...observations[1], access: { ...observations[1].access!, state: "unknown" } }).level, "unknown");
});

test("WS-31 unknown and unsupported claims preserve their original status instead of being upgraded", () => {
  const manifest = fixture();
  const claim = manifest.claims[1];
  const unsupported: TrustManifest = {
    ...manifest, conflicts: [], evidence: [],
    claims: [
      { ...claim, status: "unsupported", sourceRefs: [] },
      { ...manifest.claims[0], status: "supported", sourceRefs: [], receiptIds: [] },
    ],
  };
  const review = reviewEvidenceExceptions(unsupported);
  assert.ok(review.unknown.some(x => x.status === "unsupported" && /unsupported/.test(x.message)));
  assert.ok(review.unknown.some(x => x.status === "supported" && /No source reference or receipt/.test(x.message)));
  assert.equal(review.conflicts.length, 0);
  const empty: TrustManifest = { ...manifest, conflicts: [], claims: [], evidence: [], missing: [] };
  assert.equal(reviewEvidenceExceptions(empty).unknown.length, 0);
});

test("WS-31 warning text appears outside Show work for recorded revoked/restricted sources and missing referenced claims", () => {
  const manifest = fixture();
  const issues = reviewEvidenceExceptions(manifest);
  const visible = sourceExceptionCaveats(issues);
  assert.ok(visible.some(x => /revoked/.test(x) && /Recheck entitlement before reuse/.test(x)));
  assert.ok(visible.some(x => /Margin estimate/.test(x)));
  assert.ok(!visible.some(x => /Recorded provider:beta: Recorded source access: allowed/.test(x)));
  const caveat = trustCaveats(manifest);
  assert.ok(caveat?.lines.some(line => /revoked/.test(line)));
  assert.ok(caveat?.lines.some(line => /Sources disagree/.test(line)));
  assert.deepEqual(caveat?.recoveryActions, ["Review source entitlement"]);
});

test("WS-31 read-only detail renders all conflicting refs, missing observations, revoked and unknown states", () => {
  const html = renderToStaticMarkup(React.createElement(EvidenceExceptionDetails, { manifest: fixture() }));
  assert.match(html, /data-testid="ws31-evidence-exceptions"/);
  assert.match(html, /Source contradictions/);
  assert.match(html, /Recorded relative difference: 17\.00%/);
  assert.match(html, /provider:alpha/);
  assert.match(html, /provider:beta/);
  assert.match(html, /Referenced source observation unavailable/);
  assert.match(html, /ws31-source-access/);
  assert.match(html, /Recorded source access: revoked/);
  assert.match(html, /Source access\/entitlement not confirmed/);
  assert.match(html, /No conflicting value is silently selected/);
  assert.doesNotMatch(html, /onclick=|<script|<a /i);
  const nothing = { ...fixture(), conflicts: [], claims: [], evidence: [], missing: [] };
  assert.equal(renderToStaticMarkup(React.createElement(EvidenceExceptionDetails, { manifest: nothing })), "");
});

test("WS-31 conflict messages and external source names are escaped, not executable HTML", () => {
  const manifest = fixture();
  const html = renderToStaticMarkup(React.createElement(EvidenceExceptionDetails, {
    manifest: { ...manifest,
      conflicts: [{ ...manifest.conflicts[0], summary: "<script>bad()</script>" }],
      evidence: [{ ...manifest.evidence[0], providerLabel: "<img src=x onerror=bad()>" }],
    },
  }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script|<img/);
});

test("WS-31 a trust record with material conflicts is not shown as an all-green approval", () => {
  const withProblems = renderToStaticMarkup(React.createElement(ConversationTrustPanel, { manifest: fixture() }));
  assert.match(withProblems, /Evidence needs review/);
  assert.match(withProblems, /border-amber-300/);
  assert.doesNotMatch(withProblems, /h-3\.5 w-3\.5 text-emerald-300/);
  const empty = fixture();
  const clean: TrustManifest = {
    ...empty,
    summary: { ...empty.summary, conflictState: "none", missingCount: 0, quality: "high" },
    evidence: [], claims: [], conflicts: [], missing: [], warnings: [],
  };
  const cleanHtml = renderToStaticMarkup(React.createElement(ConversationTrustPanel, { manifest: clean }));
  assert.match(cleanHtml, />Trust</);
  assert.doesNotMatch(cleanHtml, /Evidence needs review/);
});

test("WS-31 summary-only material conflict and missing evidence remain visible without detailed rows", () => {
  const source = fixture();
  const summaryOnly: TrustManifest = {
    ...source,
    conflicts: [], claims: [], evidence: [], missing: [],
    summary: { ...source.summary, conflictState: "material", missingCount: 2 },
  };
  const issues = trustCaveats(summaryOnly);
  assert.match((issues?.lines ?? []).join(" "), /conflict is recorded in the trust summary/);
  assert.match((issues?.lines ?? []).join(" "), /missing evidence is recorded in the summary/);
  const header = renderToStaticMarkup(React.createElement(ConversationTrustPanel, { manifest: summaryOnly }));
  assert.match(header, /Evidence needs review/);
});
