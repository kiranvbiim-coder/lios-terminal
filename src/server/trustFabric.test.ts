import assert from "node:assert/strict";
import test from "node:test";
import { buildDataStatus } from "@shared/dataStatus";
import {
  buildEvidenceClaim,
  buildTrustManifest,
  buildTrustManifestFromCapabilityResolution,
  detectNumericEvidenceConflicts,
  evidenceFromDataStatus,
} from "./trustFabric";

test("P3 evidence quality is deterministic from freshness/runtime facts", () => {
  const live = evidenceFromDataStatus({
    sourceRef: "provider:yahoo_finance",
    providerId: "yahoo_finance",
    providerLabel: "Yahoo Finance",
    connectorState: "live_verified",
    status: buildDataStatus({
      provider: "Yahoo Finance",
      freshness: "current",
      asOf: "2026-09-26T05:30:00.000Z",
      isFallback: false,
    }),
    fields: ["price"],
    value: 215.4,
  });
  const fallback = evidenceFromDataStatus({
    sourceRef: "provider:fallback",
    providerId: "fallback",
    providerLabel: "Fallback",
    connectorState: "degraded",
    status: buildDataStatus({
      provider: "Fallback",
      freshness: "reference",
      asOf: "2026-09-20T00:00:00.000Z",
      isFallback: true,
    }),
    fields: ["price"],
    value: 210,
  });

  assert.equal(live.quality, "high");
  assert.notEqual(fallback.quality, "high");
  assert.equal(live.valueHash?.length, 64);
});

test("P3 conflict detection preserves meaningful provider disagreement", () => {
  const conflicts = detectNumericEvidenceConflicts([
    { field: "price", sourceRef: "provider:a", value: 100 },
    { field: "price", sourceRef: "provider:b", value: 103 },
    { field: "pe", sourceRef: "provider:a", value: 20 },
    { field: "pe", sourceRef: "provider:b", value: 20.02 },
  ]);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "price");
  assert.equal(conflicts[0].state, "material");
  assert.match(conflicts[0].summary, /preserved the disagreement/);
});

test("P3 trust manifest reports coverage, conflict and missing evidence separately", () => {
  const evidence = evidenceFromDataStatus({
    sourceRef: "provider:test",
    providerId: "test",
    providerLabel: "Test",
    connectorState: "live_verified",
    status: buildDataStatus({
      provider: "Test",
      freshness: "daily",
      asOf: "2026-09-25T00:00:00.000Z",
    }),
    fields: ["price"],
    value: 100,
  });
  const supported = buildEvidenceClaim({
    label: "Observed price",
    path: "quote.price",
    sourceRefs: [evidence.sourceRef],
    explanation: "Observed directly from the selected provider.",
  });
  const partial = buildEvidenceClaim({
    label: "Valuation input",
    path: "valuation.growth",
    status: "partial",
    sourceRefs: [],
    confidence: "low",
    explanation: "The requested growth input is not present in connected evidence.",
  });

  const manifest = buildTrustManifest({
    requestId: "7ca80532-7b4f-42e2-8cbe-b0394fb7ad0f",
    sourceScope: "web",
    evidence: [evidence],
    claims: [supported, partial],
    conflicts: [],
    methodology: [],
    receipts: [],
    missing: [{
      field: "growth",
      reason: "No connected source supplied growth.",
      recoveryActions: ["Connect fundamentals provider"],
    }],
  });

  assert.equal(manifest.summary.evidenceCoveragePct, 75);
  assert.equal(manifest.summary.missingCount, 1);
  assert.equal(manifest.summary.conflictState, "not_evaluated_single_source");
  assert.equal(manifest.summary.sourceCount, 1);
});


test("P3 converts real capability-broker disagreement into explicit TrustManifest conflicts", () => {
  const manifest = buildTrustManifestFromCapabilityResolution({
    requestId: "3b9af21b-4404-4265-9baf-018c9bcd8ecb",
    sourceScope: "auto",
    resolution: {
      capability: "financial_statements",
      entity: "AAPL",
      authoritative: {
        providerId: "sec_edgar",
        providerLabel: "SEC EDGAR",
        value: { revenue: 100 },
      },
      observations: [
        { providerId: "sec_edgar", providerLabel: "SEC EDGAR", value: { revenue: 100 } },
        { providerId: "finnhub", providerLabel: "Finnhub", value: { revenue: 104 } },
      ],
      attemptedProviders: ["sec_edgar", "finnhub"],
      failures: [],
      conflicts: [{
        key: "income:2026:FY",
        field: "revenue",
        values: [
          { providerId: "sec_edgar", value: 100 },
          { providerId: "finnhub", value: 104 },
        ],
        material: true,
      }],
      authoritativeReason: "SEC EDGAR ranked highest among providers that returned data.",
      resolvedAt: "2026-09-26T06:00:00.000Z",
    },
  });

  assert.equal(manifest.summary.conflictState, "material");
  assert.equal(manifest.evidence.length, 2);
  assert.equal(manifest.conflicts[0].field, "income:2026:FY.revenue");
  assert.equal(manifest.conflicts[0].sourceRefs.includes("provider:sec_edgar"), true);
  assert.equal(manifest.claims[0].status, "conflicted");
});
