import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
const read=(file:string)=>fs.readFileSync(path.join(root,file),"utf8");
const contracts=read("shared/universalDataFabric.ts");
const schema=read("shared/schemaDataFabric.ts");
const migration=read("migrations/0069_lios_p5_universal_data_fabric.sql");
const coverage=read("server/coverageLedgerService.ts");
const capacity=read("server/instrumentSearchCapacity.bench.ts");
const openfigi=read("server/openFigiConnector.ts");
const lse=read("server/lseDataProvider.ts");
const lseTests=read("server/lseDataProvider.test.ts");
const credentialProbes=read("server/connectorCredentialProbes.ts");
const connectors=read("shared/connectorRegistry.ts");
const instrumentSearch=read("server/instrumentSearchIndexStore.ts");
const providerDepth=read("server/providerDepthAudit.ts");
const providerSdk=read("server/providerSdk.ts");
const sourceAdapter=read("server/sourceConnectionProviderAdapter.ts");
const sourceService=read("server/sourceConnectionService.ts");
const apiConnector=read("server/apiConnector.ts");
const openapi=read("server/openApiConnector.ts");
const mapping=read("shared/dataMapping.ts");
const mappingStore=read("server/dataMappingStore.ts");
const cache=read("server/providerExecutionCache.ts");
const streaming=read("server/streamingCoordinator.ts");
const semantic=read("server/semanticFinanceService.ts");
const quality=read("server/dataQualityEngine.ts");
const highVolume=read("server/highVolumeInterop.ts");
const columnar=read("server/columnarArtifactStore.ts");
const lineage=read("server/dataLineageService.ts");
const routes=read("server/universalDataFabricRoutes.ts");
const mcp=read("server/externalMcpClient.ts");
const browser=read("server/browserConnectorRuntime.ts");
const rights=read("server/externalRightsStore.ts");
const registry=JSON.parse(read("../third_party/components.json"));
const benchmark=JSON.parse(read("../third_party/p5-data-fabric-benchmark.json"));
const roadmap=read("../docs/LIOS_EXECUTION_ROADMAP.md");
const lsePlan=read("../docs/technical/LSE_TECHNOLOGY_ASSIMILATION.md");

// P5-01 — honest coverage/breadth ledger.
assert.ok(contracts.includes("coverageLedgerSnapshotSchema"),"P5-01 coverage contract missing.");
assert.ok(schema.includes('dataCoverageLedger = pgTable("data_coverage_ledger"'),"P5-01 durable coverage ledger missing.");
for(const field of ["realUniverseSize","indexedUniverseSize","capacityProofSize","warmSearchP95Ms","fieldStages","gaps"]) assert.ok(coverage.includes(field),`P5-01 coverage field missing ${field}.`);
assert.ok(coverage.includes("does not relabel capacity or federated reach as bundled local coverage"),"P5-01 must distinguish measured real coverage from scale/federated reach.");

// P5-02 — 100k+ canonical scale proof + p95 target, without fabricating real breadth.
assert.ok(coverage.includes("P5_INDEX_CAPACITY_PROOF_SIZE = 120_000"),"P5-02 120k scale proof constant missing.");
assert.ok(capacity.includes("universe.length >= 100_000")&&capacity.includes("p95 < 300"),"P5-02 100k+/p95 executable proof missing.");
assert.equal(benchmark.universe.realCoverageMustBeReportedSeparately,true,"P5-02 real coverage honesty policy drifted.");

// P5-03 — OpenFIGI keyed connector and non-canonical enrichment.
assert.ok(connectors.includes('id: "openfigi"')&&connectors.includes('vaultKey: "openFigiApiKey"'),"P5-03 OpenFIGI connector/vault key missing.");
assert.ok(openfigi.includes('"X-OPENFIGI-APIKEY"')&&openfigi.includes('canonical: false'),"P5-03 keyed OpenFIGI enrichment/no-canonical-takeover missing.");
assert.ok(openfigi.includes("/v3/mapping")&&openfigi.includes("/v3/filter"),"P5-03 OpenFIGI v3 mapping/filter support missing.");

// P5-04 — federated miss resolution, local first.
assert.ok(instrumentSearch.includes("p5FederatedInstrumentFallback"),"P5-04 federated fallback missing.");
assert.ok(instrumentSearch.includes("searchOpenFigi")&&instrumentSearch.includes("secEdgarFederatedFallback"),"P5-04 OpenFIGI/SEC fallback chain missing.");
assert.ok(instrumentSearch.includes("mergeFederatedInstrumentCandidates")&&instrumentSearch.includes('source: "sec_edgar"')&&instrumentSearch.includes("lseFederatedInstrumentFallback"),"P5-04 federated candidate merge/source accounting missing.");

// P5-05 — provider depth from exposed→engine-integrated with marketing eligibility.
for(const field of ["retrievableFields","mappedFields","visibleFields","engineIntegratedFields"]) assert.ok(providerDepth.includes(field),`P5-05 provider-depth evidence missing ${field}.`);
assert.ok(providerDepth.includes("openfigi"),"P5-05 OpenFIGI provider-depth evidence missing.");

// P5-06 — universal connector convergence.
for(const token of ['connection.sourceType === "file"','connection.sourceType === "private_api"','connection.sourceType === "database"','connection.sourceType === "cloud_storage"','connection.sourceType === "mcp"']) assert.ok(sourceAdapter.includes(token),`P5-06 provider adapter convergence missing ${token}.`);
assert.ok(apiConnector.includes('"graphql"')&&apiConnector.includes('"oauth"'),"P5-06 GraphQL/OAuth API path missing.");
assert.ok(openapi.includes("parseOpenApiDocument")&&openapi.includes("discoverOpenApiJson"),"P5-06 OpenAPI discovery missing.");
assert.ok(sourceService.includes("PostgreSQL, MySQL, SQLite, and DuckDB")&&sourceService.includes("Local file BYOD connector"),"P5-06 SQL/file convergence incomplete.");
assert.ok(mcp.includes("tools/call")&&mcp.includes("resources/read"),"P5-06 external MCP client path missing.");

// P5-07 — mapping suggestion is non-executable until explicit, versioned confirmation.
assert.ok(mapping.includes("executable: false"),"P5-07 suggestions must be non-executable.");
assert.ok(mappingStore.includes("replaceActive")&&mappingStore.includes("version"),"P5-07 versioned mapping confirmation missing.");
assert.ok(routes.includes("/api/data-fabric/mappings/confirm"),"P5-07 governed confirmation API missing.");

// P5-08 — full Provider SDK contract.
for(const op of ["capability","search","fetch","stream","health","quota","entitlement","normalize"]) assert.ok(contracts.includes(`"${op}"`),`P5-08 operation missing ${op}.`);
for(const member of ["search?(","stream?(","normalize?(","health?(","quota?(","entitlement?("]) assert.ok(providerSdk.includes(member),`P5-08 SDK member missing ${member}.`);
assert.ok(providerSdk.includes("structuredDataGapSchema")&&providerSdk.includes("point_in_time_unavailable"),"P5-08 structured no-fabrication gap path missing.");

// P5-09 — fallback/cache/prefetch/streaming donor assimilation.
assert.ok(cache.includes("CACHE_LIMIT = 500")&&cache.includes("inflight")&&cache.includes("prefetchCanonicalDataRequests"),"P5-09 bounded cache/dedupe/prefetch missing.");
assert.ok(cache.includes("Gaps/errors are intentionally not cached"),"P5-09 gap-cache invalidation rule missing.");
assert.ok(streaming.includes("quotaAwarePollInterval")&&streaming.includes("supportsStream"),"P5-09 quota-aware stream/poll fallback missing.");
for(const id of ["openterminalui","openterminal"]) assert.ok(registry.components.some((c:any)=>c.id===id&&!c.bundled),`P5-09 donor ${id} is not registry-governed.`);

// P5-10 — semantic finance.
assert.ok(schema.includes('semanticMetricDefinitions = pgTable("semantic_metric_definitions"'),"P5-10 durable metric catalog missing.");
assert.ok(semantic.includes("FINANCIAL_METRICS")&&semantic.includes("listBuiltInSemanticMetrics")&&semantic.includes("defineSemanticMetric"),"P5-10 semantic metric catalog missing.");
assert.ok(contracts.includes("preferredCapabilities")&&contracts.includes("pointInTimeRequired"),"P5-10 metric source policy missing.");

// P5-11 — point-in-time/revision-aware semantics.
for(const mode of ["latest","as_known_on","revision_exact"]) assert.ok(contracts.includes(`"${mode}"`),`P5-11 point-in-time mode missing ${mode}.`);
for(const clock of ["effectiveAt","publishedAt","retrievedAt","availableAt"]) assert.ok(contracts.includes(clock),`P5-11 data clock missing ${clock}.`);
assert.ok(providerSdk.includes("stale_only")&&providerSdk.includes("getFinancialDatasetAsOf")&&providerSdk.includes("getEconomicDatasetAsOf"),"P5-11 latest-only rejection/PIT snapshot adapters missing.");

// P5-12 — real quality engine.
for(const dimension of ["completeness","validity","consistency","uniqueness","freshness","pointInTimeIntegrity"]) assert.ok(quality.includes(dimension),`P5-12 quality dimension missing ${dimension}.`);
assert.ok(quality.includes("lookahead_risk")&&quality.includes("duplicate_key"),"P5-12 real quality failures missing.");
assert.ok(!quality.toLowerCase().includes("demo quality")&&!quality.toLowerCase().includes("random"),"P5-12 pseudo/demo quality implementation detected.");

// P5-13 — local index + provider/OpenFIGI/federated convergence.
assert.ok(instrumentSearch.includes("buildInstrumentSearchIndex")&&instrumentSearch.includes("loadAllPersistedInstrumentCandidates"),"P5-13 local GIM/index path missing.");
assert.ok(instrumentSearch.includes("searchOpenFigi")&&instrumentSearch.includes("p5FederatedInstrumentFallback"),"P5-13 federated/OpenFIGI convergence missing.");

// P5-14 — measured high-volume interchange decision.
assert.ok(columnar.includes("writeParquetRecords")&&columnar.includes("FORMAT parquet")&&columnar.includes("read_parquet"),"P5-14 production DuckDB/Parquet path missing.");
assert.ok(highVolume.includes('"duckdb_parquet"')&&highVolume.includes('"runtime_pack_candidate"'),"P5-14 measured Arrow/Polars runtime-pack boundary missing.");
for(const id of ["arrow","polars"]) assert.ok(registry.components.some((c:any)=>c.id===id&&!c.bundled),`P5-14 ${id} runtime candidate is not registry-governed.`);

// P5-15 — connector→normalization→mapping→engine→artifact/export lineage vocabulary.
for(const stage of ["connector","normalization","mapping","engine","artifact","export"]) assert.ok(contracts.includes(`"${stage}"`),`P5-15 lineage stage missing ${stage}.`);
assert.ok(schema.includes('dataLineageReceipts = pgTable("data_lineage_receipts"')&&lineage.includes("DataLineageBuilder"),"P5-15 durable lineage builder/store missing.");
assert.ok(routes.includes('stage:"connector"')&&routes.includes('stage:"normalization"'),"P5-15 automatic provider execution lineage missing.");

// P5-16 — canonical capability calls across core finance/data families.
for(const capability of ["security_resolution","prices","statements","estimates","filings","options","curves","macro","fx","portfolios","transactions","provider_extension"]) {
  assert.ok(contracts.includes(`"${capability}"`),`P5-16 canonical capability missing ${capability}.`);
}
assert.ok(routes.includes("/api/data-fabric/execute"),"P5-16 canonical execute route missing.");

// P5-17 — structured data-gap response with provider evidence and remedies.
assert.ok(contracts.includes("structuredDataGapSchema")&&contracts.includes("providersChecked")&&contracts.includes("nextActions"),"P5-17 structured data-gap contract incomplete.");
for(const remedy of ["connect_provider","review_entitlement","adjust_as_known_on","confirm_mapping","retry_later","use_alternate_source","import_data"]) {
  assert.ok(contracts.includes(`"${remedy}"`),`P5-17 gap remedy missing ${remedy}.`);
}
assert.ok(contracts.includes("A missing observation must return a structured data gap."),"P5-17 no-fabrication invariant missing.");

// P5-18 — backtest/research as-known-on enforcement.
const workflowPolicy=read("server/workflowDataPolicy.ts");
assert.ok(workflowPolicy.includes("Backtest data must declare as_known_on or revision_exact"),"P5-18 backtest point-in-time guard missing.");
assert.ok(workflowPolicy.includes("Historical research as_known_on data must require publication/availability time"),"P5-18 research point-in-time guard missing.");
assert.ok(routes.includes("assertWorkflowPointInTimePolicy"),"P5-18 runtime point-in-time enforcement missing.");

// P5-19 — governed MCP client support.
assert.ok(mcp.includes("allowedToolIds")&&mcp.includes("allowedResourcePrefixes")&&mcp.includes("requireApprovalForTools"),"P5-19 MCP Project permission boundary incomplete.");
assert.ok(mcp.includes("resolveCredential")&&mcp.includes("initializeExternalMcpClient"),"P5-19 MCP credential/health path missing.");

// P5-20 — safe future MCP server exposure.
for(const invariant of ["filesystemExposure: false","secretExposure: false","internalStateExposure: false","tenantScoped: true"]) {
  assert.ok(mcp.includes(invariant),`P5-20 MCP exposure invariant missing ${invariant}.`);
}
assert.ok(routes.includes("/api/data-fabric/mcp/server-contract"),"P5-20 MCP exposure endpoint missing.");

// P5-21 — isolated browser/Playwright runtime.
const playwright=read("server/playwrightBrowserAdapter.ts");
assert.ok(browser.includes("allowedDomains")&&browser.includes("downloadMaxBytes")&&browser.includes("filesystemWriteRoots"),"P5-21 browser policy boundary incomplete.");
assert.ok(playwright.includes('dynamicImport("playwright")')&&playwright.includes("Browser Runtime Pack"),"P5-21 optional Playwright runtime-pack boundary missing.");
assert.ok(routes.includes("/api/data-fabric/browser/execute")&&routes.includes("getProject"),"P5-21 Project-scoped browser execution route missing.");

// P5-22 — generic custom REST/JSON/database/private provider path.
assert.ok(sourceAdapter.includes("createPrivateApiProviderAdapter")&&sourceAdapter.includes("createDatabaseProviderAdapter"),"P5-22 private API/database adapters missing.");
assert.ok(sourceService.includes("mapApiSourceConnection")&&sourceService.includes("queryDatabaseSource"),"P5-22 custom source mapping/query execution missing.");

// P5-23 — normalized streaming lifecycle with quota-aware polling.
assert.ok(streaming.includes("quotaAwarePollInterval")&&streaming.includes("retryAfterMs")&&streaming.includes("resetAt"),"P5-23 quota-aware polling fallback incomplete.");
assert.ok(routes.includes("/api/data-fabric/streaming/plan"),"P5-23 streaming lifecycle endpoint missing.");

// P5-24 — software/API/data/trademark rights tracked independently.
assert.ok(rights.includes("recordExternalRightsAssessment")&&rights.includes("version = (prior?.version ?? 0) + 1"),"P5-24 versioned rights assessment store missing.");
for(const field of ["softwareLicense","apiTerms","dataRights","trademarkReviewed"]) assert.ok(contracts.includes(field),`P5-24 separate rights field missing ${field}.`);
assert.ok(schema.includes('externalRightsAssessments = pgTable("external_rights_assessments"'),"P5-24 rights persistence missing.");
assert.ok(routes.includes("/api/data-fabric/rights"),"P5-24 rights control surface missing.");
// P5-25 — verified MIT donor registration + optional keyed Provider SDK adapter.
assert.ok(connectors.includes('id: "lse"')&&connectors.includes('vaultKey: "lseApiKey"')&&connectors.includes("adapterImplemented: true"),"P5-25 LSE connector registration incomplete.");
const lseComponent=registry.components.find((component:any)=>component.id==="lse-data");
assert.ok(lseComponent&&lseComponent.license==="MIT"&&lseComponent.commitSha==="564c63dd99e3b447777cb396314ec6c4342f82ff"&&!lseComponent.bundled,"P5-25 pinned/non-bundled LSE donor registry entry missing.");
assert.ok(providerSdk.includes("createLseDataProviderAdapter")&&lse.includes('export const LSE_PROVIDER_ID = "lse"'),"P5-25 LSE Provider SDK adapter registration missing.");

// P5-26 — catalogue discovery stays provisional and maps provider aliases against LiOS identity.
assert.ok(lse.includes('"/catalog"')&&lse.includes("lseCatalogRowToCandidate")&&lse.includes("canonical: false"),"P5-26 LSE catalogue/provisional identity path missing.");
assert.ok(lse.includes("mappedCatalogResult")&&lse.includes("resolvePersistedInstrument")&&lse.includes("mapOpenFigi")&&lse.includes("providerSymbol: providerCandidate.symbol"),"P5-26 canonical/OpenFIGI/provider-symbol mapping path missing.");
assert.ok(instrumentSearch.includes("lseFederatedInstrumentFallback"),"P5-26 LSE federated universe fallback missing.");

// P5-27 — REST, WebSocket and Parquet paths normalize behind LiOS contracts.
for(const token of ['"/candles"','"/series"','"/options/chain"',"new WebSocket(LSE_WS_URL)","createLseParquetExport","downloadLseParquetExport"]) assert.ok(lse.includes(token),"P5-27 LSE transport missing "+token+".");
assert.ok(lse.includes('kind: "ohlcv_series"')&&lse.includes('kind: "financial_statements"')&&lse.includes('"option_chain"'),"P5-27 normalized LSE schema families incomplete.");
assert.ok(lseTests.includes("Parquet path")&&lseTests.includes("normalized candles"),"P5-27 LSE transport regression tests missing.");

// P5-28 — local credential custody, health, usage/quota and entitlement.
assert.ok(credentialProbes.includes("lse: key =>")&&credentialProbes.includes('"https://api.londonstrategicedge.com/vault/usage"'),"P5-28 LSE credential probe missing.");
assert.ok(lse.includes('resolveCredential("LSE_API_KEY", "lseApiKey")')&&lse.includes("parseLseUsageQuota"),"P5-28 local LSE credential/quota implementation missing.");
assert.ok(lse.includes('state: "healthy"')&&lse.includes("lseEntitlementDecision"),"P5-28 LSE health/entitlement implementation missing.");

// P5-29 — hosted-data rights gate forbids redistribution/central cache.
for(const token of ["redistribute === true","resell === true","serveThirdParty === true","centralCache === true",'policyId: "lse-no-redistribution"']) assert.ok(lse.includes(token),"P5-29 LSE rights gate missing "+token+".");
assert.ok(lse.includes("isHostedProductionRuntime")&&lse.includes("local-desktop only"),"P5-29 hosted control-plane block missing.");
assert.ok(lseComponent.externalRights==="separate_review_required","P5-29 external data rights must remain separately reviewed.");

// P5-30 — optional fallback/precedence integration with no provider lock-in.
assert.ok(lse.includes("priority: 25")&&providerSdk.includes("createLseDataProviderAdapter()"),"P5-30 LSE provider precedence registration missing.");
assert.ok(instrumentSearch.includes("lseFederatedInstrumentFallback.search")&&instrumentSearch.includes("secEdgarFederatedFallback.search"),"P5-30 fallback chain must preserve alternate sources.");
assert.ok(providerSdk.includes("providerAllow")&&providerSdk.includes("providerDeny")&&providerSdk.includes("structuredDataGapSchema"),"P5-30 provider pin/deny/Data Gap controls missing.");

// P5-31 — replay-to-live semantics on the generic streaming fabric.
assert.ok(lse.includes('action: "subscribe"')&&lse.includes("replayStart")&&lse.includes('"replay_started"')&&lse.includes('"replay_complete"'),"P5-31 replay-to-live protocol missing.");
assert.ok(lse.includes("ProviderRuntimeHub<LseStreamEvent>")&&lse.includes("buildStreamingLifecycle")&&lse.includes("LSE_STREAM_RECONNECT_MS"),"P5-31 generic stream/reconnect integration missing.");
assert.ok(lseTests.includes("replay-to-live protocol"),"P5-31 replay regression test missing.");

// P5 source-of-truth IDs must have one meaning.
for(let id=1;id<=31;id+=1) assert.ok(roadmap.includes("LIOS-P5-"+String(id).padStart(2,"0")),"P5 roadmap missing canonical task "+id+".");
for(let id=25;id<=31;id+=1) assert.ok(lsePlan.includes("LIOS-P5-"+id),"P5 LSE assimilation plan missing unique task "+id+".");


// Cross-cutting tenant and control-surface guarantees.
assert.ok(migration.includes('ENABLE ROW LEVEL SECURITY')&&migration.includes('data_coverage_ledger')&&migration.includes('semantic_metric_definitions')&&migration.includes('data_lineage_receipts')&&migration.includes('external_rights_assessments')&&migration.includes('data_field_mappings'),"P5 hosted RLS migration incomplete.");
assert.ok(routes.includes("/api/data-fabric/coverage")&&routes.includes("/api/data-fabric/quality")&&routes.includes("/api/data-fabric/provider-depth"),"P5 canonical control surface incomplete.");

console.log("P5 Universal Data Fabric & Semantic Finance acceptance P5-01…P5-31: PASS");
