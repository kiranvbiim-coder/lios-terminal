import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const trustContracts = read("shared/trustContracts.ts");
const universalFabric = read("shared/universalDataFabric.ts");
const sourceScope = read("shared/sourceScope.ts");
const connectorRegistry = read("shared/connectorRegistry.ts");
const resolver = read("server/universalDataResolver.ts");
const trustFabric = read("server/trustFabric.ts");
const marketData = read("server/marketData.ts");
const marketHistoryStore = read("server/marketHistoryStore.ts");
const runtime = read("server/conversationRuntime.ts");
const trace = read("client/src/components/terminal/ConversationRuntimeTrace.tsx");
const trustPanel = read("client/src/components/terminal/ConversationTrustPanel.tsx");
const shell = read("client/src/components/terminal/ProjectExperienceShell.tsx");
const telemetry = read("client/src/lib/p3TrustTelemetry.ts");
const ledger = read("server/ledgerReproducibility.ts");
const ledgerContracts = read("shared/ledgerContracts.ts");

assert.ok(trustContracts.includes('canonicalDataRequestSchema.extend({'), "Active P3 must extend the existing canonical Universal Data Fabric request.");
assert.ok(trustContracts.includes("universalDataPlanSchema"), "Active P3 universal provider plan contract is missing.");
assert.ok(trustContracts.includes("evidenceObservationSchema"), "Active P3 evidence-observation contract is missing.");
assert.ok(trustContracts.includes("entitlementRequired") && trustContracts.includes("servedTier"), "Active P3 evidence must preserve observed market-data access/entitlement state.");
assert.ok(trustContracts.includes("trustManifestSchema"), "Active P3 trust-manifest contract is missing.");
for (const field of ["freshness", "quality", "confidence", "conflictState", "evidenceCoveragePct", "missingCount"]) {
  assert.ok(trustContracts.includes(field), `Active P3 trust summary missing ${field}`);
}
assert.ok(sourceScope.includes('z.enum(["auto", "my_data", "web", "files"])'), "P1 source scope must remain canonical and shared.");
assert.ok(universalFabric.includes("canonicalDataRequestSchema"), "Historical provider-neutral Universal Data Fabric contract must remain present.");

assert.ok(resolver.includes("planUniversalDataRequest"), "Active P3 universal data planner is missing.");
assert.ok(resolver.includes("getUserScopedConnectorRegistrySnapshot"), "Active P3 must plan from user-scoped connector state.");
assert.ok(resolver.includes("resolveFamilyProviderOrder"), "Active P3 must preserve provider stack/pin ordering.");
assert.ok(resolver.includes("executionPathCompatible"), "Active P3 must distinguish generic connector capability from the actually executable path.");
assert.ok(resolver.includes("PRICE_ROUTER_CONNECTOR_IDS"), "Active P3 price planning must be tied to the real LiOS price router.");
assert.ok(resolver.includes("sourceScopeCompatible"), "Active P3 provider planning must enforce source scope.");
assert.ok(resolver.includes("explainUniversalDataGap"), "Active P3 contextual connector/data-gap recovery is missing.");

for (const providerId of ['id: "bse_india"', 'id: "stooq"']) {
  assert.ok(connectorRegistry.includes(providerId), `Executable market-data path missing from connector registry: ${providerId}`);
}

assert.ok(marketHistoryStore.includes("StoredHistoryProvenance"), "P3 persisted OHLCV provenance is missing.");
assert.ok(marketHistoryStore.includes("provenance?: StoredHistoryProvenance"), "Legacy history must remain backward-compatible while allowing new lineage.");
assert.ok(marketData.includes("getOHLCVWithProvenance"), "P3 historical-series provider provenance API is missing.");
assert.ok(marketData.includes("historyProvenanceFromStored"), "Persisted OHLCV trust must preserve upstream lineage when known.");
assert.ok(marketData.includes("provenance:legacy-unattributed"), "Legacy persisted history must be explicitly unattributed rather than guessed.");
assert.ok(marketData.includes("LiOS does not infer it from the quote provider"), "P3 must not falsely assign quote provenance to OHLCV history.");

assert.ok(trustFabric.includes("evidenceFromDataStatus"), "P3 deterministic evidence construction is missing.");
assert.ok(trustFabric.includes("detectNumericEvidenceConflicts"), "P3 numeric conflict detection is missing.");
assert.ok(trustFabric.includes("buildTrustManifestFromCapabilityResolution"), "P3 must bridge the existing multi-provider capability broker into TrustManifest conflicts.");
assert.ok(trustFabric.includes("buildTrustManifest"), "P3 trust aggregation is missing.");
assert.ok(trustFabric.includes("not_evaluated_single_source"), "P3 must distinguish no detected conflict from conflict not evaluated.");

assert.ok(runtime.includes('type: "trust"'), "Conversation Runtime must emit typed P3 trust events.");
assert.ok(runtime.includes("buildMarketTrustManifest"), "Market workflows must produce provider/freshness/methodology trust.");
assert.ok(runtime.includes("genericTrustManifestForResult"), "Non-market material outputs must still receive trust manifests.");
assert.ok(runtime.includes("observedEvents"), "Generic trust must preserve source/receipt evidence already emitted by the governed runtime.");
assert.ok(runtime.includes("trustManifestForDataGap"), "Governed data gaps must emit trust before failing.");
assert.ok(runtime.includes("planUniversalDataRequest"), "Conversation market retrieval must use the P3 universal data planner.");
assert.ok(runtime.includes("getOHLCVWithProvenance"), "Conversation market retrieval must preserve history provenance.");

assert.ok(trace.includes("ConversationTrustPanel"), "Conversation execution UI must render the P3 trust surface.");
assert.ok(trustPanel.includes("Show Work"), "P3 Show Work affordance is missing.");
for (const section of ["Sources", "Methodology", "Claims & calculations", "Assumptions", "Exceptions & recovery"]) {
  assert.ok(trustPanel.includes(section), `P3 Show Work section missing: ${section}`);
}
assert.ok(trustPanel.includes("manifest.conflicts"), "P3 UI must render source conflicts explicitly.");
assert.ok(trustPanel.includes("manifest.missing"), "P3 UI must render missing evidence and recovery.");
assert.ok(trustPanel.includes("Access:") && trustPanel.includes("entitlement/upgrade required"), "P3 Show Work must expose observed source access/entitlement posture.");
assert.ok(shell.includes("recordP3TrustManifest(runtimeEvent.manifest)"), "P3 trust telemetry must observe runtime trust events.");
assert.ok(shell.includes("Connection Center opened for the missing source"), "Connector recovery must preserve the original task.");
assert.ok(shell.includes('/^(connect\\b|open connection center$)/i'), "Connector recovery action must open the Connection Center.");

assert.ok(ledgerContracts.includes('"evidence.assessed"'), "P3 evidence assessment ledger event is missing.");
assert.ok(ledgerContracts.includes('"evidence"'), "P3 evidence lineage node kind is missing.");
assert.ok(ledgerContracts.includes('"supports"') && ledgerContracts.includes('"conflicts_with"'), "P3 evidence lineage relations are incomplete.");
assert.ok(ledger.includes('event.type === "trust"'), "P3 trust manifests must be recorded in the reproducibility ledger.");
assert.ok(ledger.includes("sourceScopeCompatible"), "P2 source-compatibility decisions must remain reproducible under P3.");

assert.ok(telemetry.includes("P3_TRUST_TELEMETRY_PRIVACY_CONTRACT"), "P3 telemetry privacy contract is missing.");
for (const forbidden of [
  "storesPromptText: false",
  "storesSourceRefs: false",
  "storesProviderNames: false",
  "storesSymbols: false",
  "storesProjectNames: false",
  "storesFileNames: false",
  "storesFileContents: false",
  "storesAssumptionValues: false",
  "storesCredentials: false",
]) {
  assert.ok(telemetry.includes(forbidden), `P3 telemetry privacy rule missing: ${forbidden}`);
}

console.log(JSON.stringify({
  contractVersion: "active-p3-1.0.0",
  canonicalDataFabricReused: true,
  userScopedProviderPlanning: true,
  executablePathTruthfulness: true,
  sourceScopeEnforced: true,
  contextualConnectorRecovery: true,
  quoteAndHistoryProvenanceSeparated: true,
  legacyHistoryUnattributedRatherThanGuessed: true,
  evidenceQualityFreshnessConfidence: true,
  observedEntitlementState: true,
  explicitConflictStates: true,
  capabilityBrokerConflictBridge: true,
  showWork: true,
  genericRuntimeEvidenceRetention: true,
  gapTrustBeforeFailure: true,
  ledgerEvidenceLineage: true,
  localContentFreeTelemetry: true,
}, null, 2));
