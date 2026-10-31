import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { readQualificationWorkflow } from "./source_distribution";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import {
  P11_CONFORMANCE_CASES,
  P11_PERFORMANCE_BUDGETS,
  readP11CandidateInventory,
  validateP11CandidateInventory,
} from "../server/p11Governance";
import { P11_PACK_CATALOG, validateP11PackCatalog } from "../server/p11PackCatalog";
import { executeP11Capability, registerP11ProofPacks } from "../server/p11ProofPacks";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.resolve(root, file), "utf8");
const roadmap = read("../docs/LIOS_EXECUTION_ROADMAP.md");
const packageJson = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
const candidates = readP11CandidateInventory(path.resolve(root, "../third_party/p11-candidates.json"));
const hardeningWorkflow = readQualificationWorkflow(path.resolve(root, ".."), "lios-hardening.yml");
const platformWorkflow = readQualificationWorkflow(path.resolve(root, ".."), "p11-cross-platform.yml");
const macReleaseWorkflow = readQualificationWorkflow(path.resolve(root, ".."), "production-release-readiness.yml");
const windowsReleaseWorkflow = readQualificationWorkflow(path.resolve(root, ".."), "windows-release.yml");

assert.deepEqual(validateP11PackCatalog(), [], "P11 pack catalog has invalid ownership or proof state.");
assert.deepEqual(validateP11CandidateInventory(candidates), [], "P11 candidate inventory contains unresolved governance state.");
assert.equal(P11_PACK_CATALOG.length, 11, "P11 must retain exactly the 11 canonical hidden pack families.");
const availability = P11_PACK_CATALOG.flatMap((pack) => pack.availability);
assert.equal(availability.filter((item) => item.executionStatus === "available").length, 24,
  "P11 V1 must have 24 executable capabilities.");
assert.equal(availability.filter((item) => item.executionStatus === "deferred").length, 6,
  "P11 V1 must keep exactly six explicit deferrals rather than fake adapters.");
assert.equal(availability.filter((item) => item.executionStatus === "policy_blocked").length, 1,
  "P11 V1 must retain the broker-order policy block.");
assert.equal(availability.filter((item) => item.executionStatus === "planned").length, 0,
  "P11 V1 must not leave ambiguous planned catalog entries.");
assert.equal(candidates.candidates.filter((candidate) => candidate.bundled === true).length, 0,
  "P11 inventory is a governed candidate list; it must not imply bundled donor engines without verified pack artifacts.");
assert.ok(P11_CONFORMANCE_CASES.length >= 4, "P11 financial known-answer/conformance corpus is missing.");
assert.ok(P11_PERFORMANCE_BUDGETS.sidecarHandshakeMs > 0, "P11 performance budgets are missing.");

for (let task = 1; task <= 45; task += 1) {
  const taskId = `LIOS-P11-${String(task).padStart(2, "0")}`;
  assert.equal(roadmap.split("\n").filter((line) => line.startsWith(`| ${taskId} |`)).length, 1,
    `Roadmap must contain exactly one canonical row for ${taskId}.`);
}

for (const candidate of candidates.candidates) {
  if (/GPL|AGPL|Commons Clause/i.test(candidate.license)) {
    assert.ok(["reference", "reject"].includes(candidate.decision),
      `Restricted candidate ${candidate.id} must not become a normal proprietary pack dependency.`);
  }
  if (candidate.bundled) assert.ok(candidate.observedCommit, `Bundled candidate ${candidate.id} must pin an exact upstream commit.`);
}

function acceptanceBacktestRequest() {
  const bars = Array.from({ length: 30 }, (_, index) => {
    const at = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
    const price = 100 + index;
    return {
      at,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price + 0.5,
      volume: 1_000,
      availableAt: at,
    };
  });
  return {
    schemaVersion: "1" as const,
    strategy: {
      schemaVersion: "1" as const,
      id: "acceptance-buy-hold",
      name: "Acceptance buy and hold",
      kind: "buy_and_hold" as const,
      parameters: {},
      sourceLanguage: "rules" as const,
      source: "buy and hold",
    },
    instrumentRef: "AAPL",
    bars,
    benchmarkBars: null,
    assumptions: {
      startingCapital: 100_000,
      feesBps: 0,
      slippageBps: 0,
      riskFreeRateAnnual: 0,
      execution: "next_bar_open" as const,
      maxParticipationRate: null,
      pointInTimeRequired: true,
      seed: 7,
    },
    sourceRefs: ["acceptance:aapl"],
  };
}

const runtime = new RuntimeRegistry();
registerP11ProofPacks(runtime, {
  advancedQuantEngine: async (routePath, body) => ({ routePath, body, acceptanceProof: true }),
  createColumnarArtifact: async (datasetSnapshotId, actor) => ({
    created: true,
    artifact: { id: "acceptance-artifact", datasetSnapshotId, actor },
  }),
  scanColumnarArtifact: async (artifactId, input, actor) => ({
    artifact: { id: artifactId },
    metric: input.metric ?? "close",
    summary: { row_count: 3 },
    sample: [],
    actor,
  }),
  artifactInspector: async (_actor, artifactId, version) => ({
    artifactId,
    projectId: 1,
    kind: "valuation",
    title: "Acceptance valuation",
    status: "active",
    origin: "engine",
    headVersion: 2,
    version: version ?? 2,
    contentHash: "d".repeat(64),
    sourceRefs: ["filing:acceptance"],
    executionReceiptIds: ["receipt:acceptance"],
    assumptionRefs: ["assumption:acceptance"],
    contentKind: "valuation",
  }),
  documentParser: async (inputPath) => ({
    parser: "docling",
    parserVersion: "acceptance",
    upstreamCommit: "a".repeat(40),
    markdown: "# Acceptance document",
    sourcePath: inputPath,
    sourceBytes: 42,
    warnings: [],
  }),
  marketCatalogProvider: ({ query, limit }) => ({
    query: query ?? null,
    limit,
    resultCount: 1,
    entries: [{ symbol: "AAPL", locallyStored: true }],
    connectedConnectorIds: ["acceptance"],
    catalogOwner: "LiOS Market Data",
  }),
  marketHistoryProvider: async () => ({
    bars: [{ date: "2026-09-26", open: 100, high: 102, low: 99, close: 101, volume: 1_000 }],
    provenance: {
      sourceRefs: ["provider:acceptance"],
      providerIds: ["acceptance"],
      providerLabels: ["Acceptance"],
      status: {
        provider: "Acceptance",
        freshness: "daily",
        asOf: "2026-09-26T23:59:59.999Z",
        delayLabel: "Acceptance history",
        isFallback: false,
      },
      observedAt: "2026-09-27T00:00:00.000Z",
      notes: [],
    },
  }),
  localAiInvoker: async (request) => ({
    provider: request.provider,
    model: request.model ?? "acceptance-local-model",
    text: "Local acceptance response.",
    attribution: {
      id: "00000000-0000-4000-8000-000000009912",
      provider: request.provider,
      model: request.model ?? "acceptance-local-model",
      promptHash: "a".repeat(64),
      outputHash: "b".repeat(64),
      toolsCalled: [],
      dataAccessed: [],
      timestamp: "2026-09-27T00:00:00.000Z",
    },
  }),
});
const routes = runtime.listCapabilityRoutes();
const routableCatalog = P11_PACK_CATALOG.flatMap((pack) => pack.availability
  .filter((item) => item.executionStatus !== "planned" && item.executionStatus !== "deferred")
  .map((item) => item.capability)).sort();
assert.deepEqual(routes.map((route) => route.capability).sort(), routableCatalog,
  "Runtime routes must match only catalogued executable or policy-blocked capabilities.");
for (const pack of P11_PACK_CATALOG) {
  const descriptor = runtime.list().find((item) => item.id === `p11:${pack.id}`);
  assert.deepEqual((descriptor?.capabilities ?? []).sort(), pack.availability
    .filter((item) => item.executionStatus !== "planned" && item.executionStatus !== "deferred")
    .map((item) => item.capability).sort(), `P11 ${pack.id} descriptor exposes an unimplemented capability.`);
}

const executionContext: RuntimeExecutionContext = {
  requestId: "00000000-0000-4000-8000-000000000111",
  userId: 1,
  organizationId: 1,
  projectId: 1,
  sessionId: "p11-acceptance",
  conversationId: "p11-acceptance",
  activeObjectId: null,
  dataClassification: "private",
  approvedActions: [],
};
const liveProof = await executeP11Capability(runtime, "finance.valuation.reverse_dcf", { source: [1, 2, 3] }, executionContext);
assert.equal(liveProof.capability, "finance.valuation.reverse_dcf");
assert.equal((liveProof.output as { acceptanceProof?: boolean }).acceptanceProof, true,
  "A live LiOS calculation capability must execute through the registered adapter.");
const researchDocument = {
  schemaVersion: "1" as const,
  id: "p11-acceptance-doc",
  projectId: 1,
  sourceType: "research_evidence" as const,
  sourceRef: "evidence:p11-acceptance",
  title: "P11 research acceptance evidence",
  body: "Deterministic Project research search is executable through the common P11 capability router.",
  contentHash: "b".repeat(64),
};
const researchSearch = await executeP11Capability(
  runtime,
  "research.project.search",
  { documents: [researchDocument], query: "research search", limit: 10 },
  executionContext,
);
assert.equal((researchSearch.output as { projectId: number }).projectId, 1);
assert.equal((researchSearch.output as { resultCount: number }).resultCount, 1,
  "Research & Documents proof capability must execute a real Project search.");
const researchRuntime = await executeP11Capability(runtime, "research.project.runtime", {}, executionContext);
assert.equal((researchRuntime.output as { projectScoped: boolean }).projectScoped, true);
assert.equal(Object.hasOwn(researchRuntime.output as object, "donorAdaptations"), false,
  "Hidden donor adaptation metadata must not escape the P11 pack boundary.");
const strategyValidation = await executeP11Capability(runtime, "strategy.research.validate", {
  request: acceptanceBacktestRequest(),
  monteCarlo: { paths: 20, seed: 7 },
}, executionContext);
assert.equal((strategyValidation.output as { pointInTimeVerified: boolean }).pointInTimeVerified, true,
  "Strategy validation must execute the existing point-in-time backtest authority.");

const documentParse = await executeP11Capability(runtime, "documents.local.parse", { path: "/tmp/acceptance.pdf" }, executionContext);
assert.equal((documentParse.output as { parser: string }).parser, "docling",
  "Local document parsing must execute through the existing document-intelligence authority.");

const marketCatalog = await executeP11Capability(runtime, "provider.market.catalog", { query: "apple", limit: 10 }, executionContext);
assert.equal((marketCatalog.output as { resultCount: number }).resultCount, 1,
  "Market catalog must execute through the LiOS market-data authority.");

const marketHistory = await executeP11Capability(runtime, "provider.market.history", { symbol: "AAPL", range: "1M" }, executionContext);
assert.equal((marketHistory.output as { bars: unknown[] }).bars.length, 1,
  "Market history must execute through the LiOS market-data authority.");

const localAiInvocation = await executeP11Capability(runtime, "local-ai.provider.invoke", {
  provider: "lm_studio",
  model: "acceptance-local-model",
  messages: [{ role: "user", content: "Local acceptance." }],
}, { ...executionContext, approvedActions: ["local-ai.provider.invoke"] });
assert.equal(localAiInvocation.deterministic, false);
assert.equal((localAiInvocation.output as { provider: string }).provider, "lm_studio",
  "Local AI invocation must execute only through an existing local BYOAI provider.");

const parquetProof = await executeP11Capability(runtime, "data.columnar.parquet", { datasetSnapshotId: "snapshot-acceptance" }, executionContext);
assert.equal((parquetProof.output as { created?: boolean }).created, true,
  "P11 Data Lab must materialize a governed Parquet artifact through the registered adapter.");
const duckdbProof = await executeP11Capability(runtime, "data.local.duckdb", { artifactId: "acceptance-artifact", metric: "close", limit: 10 }, executionContext);
assert.equal((duckdbProof.output as { metric?: string }).metric, "close",
  "P11 Data Lab must scan a governed columnar artifact through the registered DuckDB adapter.");
const artifactInspection = await executeP11Capability(
  runtime,
  "modeling.artifact.inspect",
  { artifactId: "artifact-acceptance", version: 2 },
  executionContext,
);
assert.equal((artifactInspection.output as { projectId: number }).projectId, 1);
assert.equal((artifactInspection.output as { contentHash: string }).contentHash, "d".repeat(64),
  "Reporting & Modeling proof capability must inspect a real governed Artifact contract.");
assert.equal(artifactInspection.receiptRef, "d".repeat(64),
  "Artifact inspection must return the immutable Artifact version hash as its receipt reference.");
for (const exportCapability of ["reporting.export.xlsx", "reporting.export.docx", "reporting.export.pptx"]) {
  await assert.rejects(() => executeP11Capability(runtime, exportCapability, {}, executionContext),
    /not registered|unknown capability/i, "Server-side Office export capabilities must remain explicitly deferred until a server byte-generation authority exists.");
}
await assert.rejects(() => executeP11Capability(runtime, "data.columnar.arrow", {}, executionContext),
  /not registered|unknown capability/i, "Deliberately deferred capabilities must fail closed rather than return metadata placeholders.");
await assert.rejects(() => executeP11Capability(runtime, "broker.execution.order", {}, executionContext),
  /disabled/i, "Broker order writes must remain explicitly denied.");

assert.ok(packageJson.scripts?.["test:p11"], "P11 behavioral test script is missing.");
assert.ok(packageJson.scripts?.["acceptance:p11"], "P11 acceptance script is missing.");
assert.ok(packageJson.scripts?.["acceptance:p11:platform"], "P11 platform lifecycle acceptance script is missing.");
assert.ok(packageJson.scripts?.["test:trust"]?.includes("npm run test:p11"), "P11 is missing from the trust chain.");
assert.ok(hardeningWorkflow.includes("npm run acceptance:p11"), "P11 is missing from the normal quality gate.");
assert.ok(platformWorkflow.includes("macos-15") && platformWorkflow.includes("windows-latest")
  && platformWorkflow.includes("acceptance:p11:platform"), "P11 clean-runner lifecycle coverage is missing.");
assert.ok(macReleaseWorkflow.includes("acceptance:p11:platform"), "P11 platform lifecycle is missing from the macOS release gate.");
assert.ok(windowsReleaseWorkflow.includes("acceptance:p11:platform"), "P11 platform lifecycle is missing from the Windows release gate.");
assert.ok(roadmap.includes("P11 V1 source gate:"), "P11 source gate status is missing from the canonical roadmap.");
assert.ok(
  roadmap.includes("P11 source completion does **not** certify clean-machine runtime-pack installation"),
  "P11 roadmap must preserve the distinction between source completion and packaged release evidence.",
);
assert.ok(!roadmap.includes("### P11 — Voice and multimodal"), "Voice must remain P12, not P11.");

console.log(`P11 Hidden Engine Pack / OSS Engine Fabric acceptance: PASS (${routes.length} truthful routes; 45 roadmap IDs; live execution verified)`);
