import assert from "node:assert/strict";
import test from "node:test";
import { BUILT_IN_CONNECTORS, type ConnectorDefinition } from "@shared/connectorRegistry";
import {
  buildProviderDepthAudit,
  buildProviderDepthReport,
  PROVIDER_DEPTH_AUDIT_TARGETS,
} from "./providerDepthAudit";
import {
  calculateProviderDepthLoss,
  evaluateProviderMarketingEligibility,
  maturityFromStageCounts,
} from "@shared/providerDepth";

const fixture = (overrides: Partial<ConnectorDefinition> = {}): ConnectorDefinition => ({
  id: "fixture",
  name: "Fixture provider",
  category: "market",
  sourceType: "public_api",
  authMode: "none",
  custodyMode: "public",
  adapterImplemented: true,
  capabilities: [{ contractFamily: "market_data", fields: ["price", "volume"] }],
  setupGuide: "No setup",
  builtIn: true,
  ...overrides,
});

test("provider depth maturity follows the deepest evidenced stage", () => {
  assert.equal(maturityFromStageCounts({ exposed: 0, retrievable: 0, mapped: 0, visible: 0, engineIntegrated: 0 }), 0);
  assert.equal(maturityFromStageCounts({ exposed: 2, retrievable: 0, mapped: 0, visible: 0, engineIntegrated: 0 }), 1);
  assert.equal(maturityFromStageCounts({ exposed: 2, retrievable: 1, mapped: 0, visible: 0, engineIntegrated: 0 }), 2);
  assert.equal(maturityFromStageCounts({ exposed: 2, retrievable: 1, mapped: 1, visible: 0, engineIntegrated: 0 }), 3);
  assert.equal(maturityFromStageCounts({ exposed: 2, retrievable: 1, mapped: 1, visible: 1, engineIntegrated: 0 }), 4);
  assert.equal(maturityFromStageCounts({ exposed: 2, retrievable: 1, mapped: 1, visible: 1, engineIntegrated: 1 }), 5);
  assert.deepEqual(calculateProviderDepthLoss({ exposed: 4, retrievable: 3, mapped: 2, visible: 1, engineIntegrated: 0 }), {
    exposedToRetrievable: 1,
    retrievableToMapped: 1,
    mappedToVisible: 1,
    visibleToEngineIntegrated: 1,
  });
});

test("audit never advances a field past a missing prior stage", () => {
  const audit = buildProviderDepthAudit(fixture(), null, {
    evidenceFiles: ["fixture.ts"],
    retrievableFields: ["market_data.price", "market_data.volume"],
    mappedFields: ["market_data.price"],
    visibleFields: ["market_data.price", "market_data.volume"],
    engineIntegratedFields: ["market_data.volume"],
    redistribution: "permitted",
  });
  const price = audit.fields.find((field) => field.fieldKey === "market_data.price")!;
  const volume = audit.fields.find((field) => field.fieldKey === "market_data.volume")!;
  assert.equal(price.visible, true);
  assert.equal(price.engineIntegrated, false);
  assert.equal(volume.mapped, false);
  assert.equal(volume.visible, false);
  assert.equal(volume.engineIntegrated, false);
  assert.equal(audit.maturityLevel, 4);
  assert.equal(audit.loss.retrievableToMapped, 1);
});

test("marketing eligibility fails closed for incomplete or unlicensed providers", () => {
  assert.equal(evaluateProviderMarketingEligibility({ maturityLevel: 5, adapterImplemented: true, redistribution: "permitted" }).eligible, true);
  const restricted = evaluateProviderMarketingEligibility({ maturityLevel: 5, adapterImplemented: true, redistribution: "restricted" });
  assert.equal(restricted.eligible, false);
  assert.match(restricted.reasons.join(" "), /license-restricted/i);
  const incomplete = evaluateProviderMarketingEligibility({ maturityLevel: 2, adapterImplemented: false, redistribution: "unknown" });
  assert.equal(incomplete.eligible, false);
  assert.equal(incomplete.reasons.length, 3);
});

test("wave B report includes built-in connectors and explicit macro/India audit targets", () => {
  const report = buildProviderDepthReport({ connectors: BUILT_IN_CONNECTORS, includeAuditTargets: true });
  assert.equal(report.evidencePolicy, "static-code-evidence");
  assert.equal(report.summary.providerCount, report.providers.length);
  assert.ok(report.providers.some((provider) => provider.providerId === "lse"));
  for (const target of PROVIDER_DEPTH_AUDIT_TARGETS) {
    assert.ok(report.providers.some((provider) => provider.providerId === target.providerId), `missing audit target ${target.providerId}`);
  }
  const imf = report.providers.find((provider) => provider.providerId === "imf")!;
  assert.equal(imf.maturityLevel, 5);
  assert.equal(imf.adapterImplemented, true);
  assert.equal(imf.stageCounts.engineIntegrated, 5);
  assert.ok(imf.notes.some((note) => /DataMapper v2/i.test(note)));
  const bse = report.providers.find((provider) => provider.providerId === "bse")!;
  assert.equal(bse.maturityLevel, 5);
  assert.equal(bse.stageCounts.engineIntegrated, 5);
});
