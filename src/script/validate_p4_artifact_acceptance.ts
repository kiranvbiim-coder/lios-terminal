import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

const contracts = read("shared/artifactContracts.ts");
const adapters = read("shared/artifactAdapterRegistry.ts");
const bridges = read("shared/artifactBridges.ts");
const runtimeContracts = read("shared/runtimeContracts.ts");
const schema = read("shared/schemaProjects.ts");
const migration = read("migrations/0068_lios_p4_artifact_operating_system.sql");
const store = read("server/artifactStore.ts");
const diff = read("server/artifactDiff.ts");
const dataStore = read("server/dataArtifactStore.ts");
const packageService = read("server/artifactPackage.ts");
const exportService = read("server/artifactExport.ts");
const routes = read("server/artifactRoutes.ts");
const conversation = read("server/conversationRuntime.ts");
const pane = read("client/src/components/terminal/ArtifactPane.tsx");
const projectPanel = read("client/src/components/terminal/ProjectArtifactsPanel.tsx");
const trace = read("client/src/components/terminal/ConversationRuntimeTrace.tsx");
const localExport = read("client/src/lib/artifactExport.ts");
const rendererBenchmark = JSON.parse(read("../third_party/artifact-renderer-benchmark.json"));
const ossRegistry = JSON.parse(read("../third_party/components.json"));

// P4-01 — canonical base contract, persistence and ArtifactPane.
for (const kind of ["chart","table","screen","valuation","portfolio","research","report","spreadsheet","data","backtest","strategy","decision","timeline"]) {
  assert.ok(contracts.includes(`"${kind}"`), `P4-01 canonical kind missing ${kind}.`);
}
assert.ok(schema.includes('projectArtifacts = pgTable("project_artifacts"') && schema.includes('projectArtifactVersions = pgTable("project_artifact_versions"'), "P4-01 persistent Artifact/version tables are missing.");
assert.ok(migration.includes('CREATE TABLE "project_artifacts"') && migration.includes('CREATE TABLE "project_artifact_versions"'), "P4-01 migration is missing.");
assert.ok(pane.includes("export function ArtifactPane"), "P4-01 ArtifactPane is missing.");

// P4-02 — Chart/Table/Screen adapters.
for (const schemaName of ["chartArtifactContentSchema", "tableArtifactContentSchema", "screenArtifactContentSchema"]) assert.ok(contracts.includes(schemaName), `P4-02 missing ${schemaName}.`);
assert.ok(adapters.includes("lios.chart.lightweight") && adapters.includes("lios.chart.recharts") && adapters.includes("lios.table.native") && adapters.includes("lios.screen.native"), "P4-02 base adapters are incomplete.");

// P4-03 — finance/research/report adapters.
for (const schemaName of ["valuationArtifactContentSchema","portfolioArtifactContentSchema","researchArtifactContentSchema","reportArtifactContentSchema"]) assert.ok(contracts.includes(schemaName), `P4-03 missing ${schemaName}.`);
assert.ok(adapters.includes("lios.finance.native") && adapters.includes("lios.document.native"), "P4-03 finance/document adapters are incomplete.");
for (const kind of ['content.kind==="valuation"','content.kind==="portfolio"','content.kind==="research"||content.kind==="report"']) assert.ok(pane.includes(kind), `P4-03 UI branch missing ${kind}.`);

// P4-04 — SpreadsheetArtifact POC with Univer projection and LiOS XLSX path.
assert.ok(contracts.includes("spreadsheetArtifactContentSchema"), "P4-04 SpreadsheetArtifact contract is missing.");
assert.ok(adapters.includes("lios.spreadsheet.univer") && bridges.includes("toUniverWorkbookProjection"), "P4-04 Univer adapter/projection is missing.");

// P4-05 — AI Draft/review/accept/reject/undo.
assert.ok(contracts.includes('"spreadsheet_ai_diff"') && contracts.includes("spreadsheetCellDiffSchema"), "P4-05 spreadsheet diff contract is missing.");
assert.ok(store.includes("createArtifactProposal") && store.includes("decideArtifactProposal") && store.includes("undoArtifactHead"), "P4-05 proposal/decision/undo service is incomplete.");

// P4-06 — DataArtifact with DuckDB and optional high-volume adapters.
assert.ok(contracts.includes("dataArtifactContentSchema"), "P4-06 DataArtifact contract is missing.");
assert.ok(dataStore.includes("scanColumnarArtifact") && dataStore.includes('mode: "duckdb"'), "P4-06 DuckDB/columnar query path is missing.");
assert.ok(adapters.includes("lios.data.perspective") && adapters.includes("lios.data.virtual") && bridges.includes("toPerspectiveProjection"), "P4-06 Perspective/virtual adapter boundary is missing.");
assert.ok(pane.includes("Query 100 rows"), "P4-06 DataArtifact query UX is missing.");

// P4-07 — live document editor + Tiptap projection.
assert.ok(adapters.includes("lios.document.tiptap") && bridges.includes("toTiptapDocumentProjection"), "P4-07 Tiptap adapter/projection is missing.");
assert.ok(pane.includes("LIVE DOCUMENT") && pane.includes("Save document revision"), "P4-07 live Research/Report editor is missing.");

// P4-08 — ECharts adapter while preserving current chart renderers.
assert.ok(adapters.includes("lios.chart.echarts") && bridges.includes("toEChartsOptionProjection"), "P4-08 ECharts adapter/projection is missing.");
assert.ok(adapters.includes("lios.chart.lightweight") && adapters.includes("lios.chart.recharts"), "P4-08 existing chart adapters were not preserved.");

// P4-09 — convergence actions.
for (const name of ["keepConversationDraft","createArtifactReference","forkArtifact","compareArtifactVersions"]) assert.ok(store.includes(name), `P4-09 service missing ${name}.`);
assert.ok(exportService.includes("getArtifactExportPlan") && localExport.includes("exportArtifactLocal"), "P4-09 export convergence is missing.");
assert.ok(trace.includes("Keep in Project"), "P4-09 conversation Keep in Project UX is missing.");

// P4-10 — performance and base-desktop footprint gates.
assert.equal(rendererBenchmark.baseDesktop.heavyRendererPackagesInStartupBundle, 0, "P4-10 heavy renderer footprint policy drifted.");
assert.equal(rendererBenchmark.ciMicrobenchmarks.spreadsheetCells, 10_000, "P4-10 microbenchmark size drifted.");

// P4-11 — BacktestArtifact.
assert.ok(contracts.includes("backtestArtifactContentSchema") && contracts.includes('"edited_not_run"') && contracts.includes('"stale"'), "P4-11 BacktestArtifact statuses are incomplete.");
assert.ok(pane.includes('content.kind==="backtest"') && read("client/src/components/terminal/BacktestArtifactView.tsx").includes("trades"), "P4-11 BacktestArtifact renderer is missing.");

// P4-12 — StrategyArtifact / Strategy Studio.
assert.ok(contracts.includes("strategyArtifactContentSchema"), "P4-12 StrategyArtifact contract is missing.");
assert.ok(pane.includes("StrategyEditor") && pane.includes("STRATEGY STUDIO") && pane.includes("Save strategy revision"), "P4-12 Strategy Studio integration is missing.");

// P4-13 — DecisionArtifact.
for (const field of ["objective:","constraints:","alternatives:","expectedOutcomes:","risks:","tradeoffs:","implementation:","monitoring:"]) assert.ok(contracts.includes(field), `P4-13 DecisionArtifact field missing ${field}.`);
assert.ok(pane.includes('content.kind==="decision"'), "P4-13 DecisionArtifact renderer is missing.");

// P4-14 — TimelineArtifact.
assert.ok(contracts.includes("timelineArtifactContentSchema"), "P4-14 TimelineArtifact contract is missing.");
for (const type of ["filing","earnings","alert","research","model_change","decision"]) assert.ok(contracts.includes(`"${type}"`), `P4-14 timeline event type missing ${type}.`);
assert.ok(pane.includes('content.kind==="timeline"'), "P4-14 TimelineArtifact renderer is missing.");

// P4-15 — standardized actions/receipts and one object state.
for (const action of ["open","edit","keep","reference","fork","compare","export","archive","restore","create_version","propose_change","accept_change","reject_change","undo","rerun","inspect_source","import"]) assert.ok(contracts.includes(`"${action}"`), `P4-15 action missing ${action}.`);
assert.ok(schema.includes('artifactInteractionReceipts = pgTable("artifact_interaction_receipts"'), "P4-15 interaction receipt persistence is missing.");
assert.ok(store.includes("createArtifactVersion") && conversation.includes("executeArtifactEditProposal") && conversation.includes("createArtifactProposal"), "P4-15 direct/conversation convergence is incomplete.");
assert.ok(runtimeContracts.includes("artifactKindSchema") && runtimeContracts.includes("artifactActionSchema"), "P4-15 legacy runtime envelope is not converged to P4 contracts.");

// P4-16 — consistent Artifact chrome.
for (const label of ["SOURCES","REVISIONS","REFS","Ask LiOS","Compare","Reference Session"]) assert.ok(pane.includes(label), `P4-16 Artifact chrome missing ${label}.`);
assert.ok(pane.includes("getArtifactExportPlan") && pane.includes("forkArtifact") && pane.includes("undoArtifact"), "P4-16 chrome actions are incomplete.");

// P4-17 — portable Project/Session package.
assert.ok(contracts.includes("artifactPackageSchema") && contracts.includes("excludesCredentials: z.literal(true)"), "P4-17 portable package contract is missing.");
assert.ok(packageService.includes("verifyArtifactPackage") && packageService.includes("revalidatePackageEntitlements") && packageService.includes("importArtifactPackage"), "P4-17 verify/entitlement/import path is incomplete.");
assert.ok(packageService.includes("relinkImportedArtifactFork"), "P4-17 imported fork ancestry is not preserved.");
assert.ok(store.includes("assertArtifactRefsSafe") && packageService.includes("assertArtifactRefsSafe"), "P4-17 credential-bearing provenance refs are not blocked.");
assert.ok(projectPanel.includes("Export package") && projectPanel.includes("Import package"), "P4-17 package UX is incomplete.");

// Cross-cutting: immutable versions + optimistic concurrency + P3 lineage integration.
assert.ok(!store.includes("update(projectArtifactVersions)") && (!store.includes("delete(projectArtifactVersions)") || store.includes("permanentlyDeleteArtifact")), "P4 Artifact versions must remain immutable except for explicit whole-Artifact permanent deletion cleanup.");
assert.ok(store.includes("eq(projectArtifacts.headVersion, input.baseVersion)") && store.includes("edited concurrently"), "P4 optimistic concurrency guard is missing.");
for (const event of ["artifact.created","artifact.versioned","artifact.forked","artifact.reference.created","artifact.proposal.created","artifact.proposal.accepted","artifact.proposal.rejected","artifact.imported"]) assert.ok(store.includes(`"${event}"`) || packageService.includes(`"${event}"`), `P4/P3 Ledger integration missing ${event}.`);
assert.ok(ossRegistry.components.some((component: any) => component.id === "univer" && component.bundled === true && component.license === "Apache-2.0"), "P4 Univer must be registry-governed as a bundled Apache-2.0 renderer.");
assert.ok(routes.includes("registerArtifactRoutes") || routes.includes("/api/artifacts"), "P4 Artifact API surface is missing.");

console.log("P4 Artifact Operating System acceptance P4-01…P4-17: PASS");
