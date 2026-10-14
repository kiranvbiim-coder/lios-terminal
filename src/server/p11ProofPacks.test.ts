import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import type { RuntimeExecutionContext } from "@shared/runtimeContracts";
import { executeP11Capability, registerP11ProofPacks } from "./p11ProofPacks";
import { P11_PACK_CATALOG, validateP11PackCatalog } from "./p11PackCatalog";

function pointInTimeBacktestRequest() {
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
      id: "buy-hold",
      name: "Buy and hold",
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
    sourceRefs: ["fixture:aapl"],
  };
}

const context: RuntimeExecutionContext = {
  requestId: "00000000-0000-4000-8000-000000001111",
  userId: 1,
  organizationId: 1,
  projectId: 1,
  sessionId: "base",
  conversationId: "chat",
  activeObjectId: null,
  dataClassification: "private",
  approvedActions: [],
};

function registry(): RuntimeRegistry {
  const registry = new RuntimeRegistry();
  registerP11ProofPacks(registry, {
    advancedQuantEngine: async (routePath, body) => ({ routePath, body, deterministicProof: true }),
    pythonEngine: async (routePath, body) => ({ routePath, body, deterministicProof: true }),
    createColumnarArtifact: async (datasetSnapshotId, actor) => ({
      created: true,
      artifact: { id: "artifact-1", datasetSnapshotId, actor },
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
      projectId: artifactId === "artifact-other-project" ? 2 : 1,
      kind: "valuation",
      title: "Valuation Artifact",
      status: "active",
      origin: "engine",
      headVersion: 2,
      version: version ?? 2,
      contentHash: "c".repeat(64),
      sourceRefs: ["filing:aapl-10k"],
      executionReceiptIds: ["receipt:test"],
      assumptionRefs: ["assumption:test"],
      contentKind: "valuation",
    }),
    documentParser: async (inputPath) => ({
      parser: "docling",
      parserVersion: "test",
      upstreamCommit: "a".repeat(40),
      markdown: "# Parsed\nEvidence",
      sourcePath: inputPath,
      sourceBytes: 12,
      warnings: [],
    }),
    marketCatalogProvider: ({ query, limit }) => ({
      query: query ?? null,
      limit,
      resultCount: 1,
      entries: [{ symbol: "AAPL", locallyStored: true }],
      connectedConnectorIds: ["fixture"],
      catalogOwner: "LiOS Market Data",
    }),
    marketHistoryProvider: async (symbol) => ({
      bars: [{
        date: "2026-09-26",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 1_000,
      }],
      provenance: {
        sourceRefs: ["provider:fixture"],
        providerIds: ["fixture"],
        providerLabels: ["Fixture"],
        status: {
          provider: "Fixture",
          freshness: "daily",
          asOf: "2026-09-26T23:59:59.999Z",
          delayLabel: "fixture",
          isFallback: false,
        },
        observedAt: "2026-09-27T00:00:00.000Z",
        notes: [],
      },
    }),
    localAiInvoker: async (request) => ({
      provider: request.provider,
      model: request.model ?? "local-model",
      text: "Local model response.",
      attribution: {
        id: "00000000-0000-4000-8000-000000009911",
        provider: request.provider,
        model: request.model ?? "local-model",
        promptHash: "a".repeat(64),
        outputHash: "b".repeat(64),
        toolsCalled: [],
        dataAccessed: [],
        timestamp: "2026-09-27T00:00:00.000Z",
      },
    }),
  });
  return registry;
}

test("P11 pack catalog covers all canonical pack families without overlapping capability ownership", () => {
  assert.deepEqual(validateP11PackCatalog(), []);
  assert.equal(P11_PACK_CATALOG.length, 11);
  assert.equal(P11_PACK_CATALOG.filter((pack) => pack.defaultInstalled).length, 1);
  const availability = P11_PACK_CATALOG.flatMap((pack) => pack.availability);
  assert.equal(availability.filter((item) => item.executionStatus === "available").length, 24);
  assert.equal(availability.filter((item) => item.executionStatus === "deferred").length, 6);
  assert.equal(availability.filter((item) => item.executionStatus === "policy_blocked").length, 1);
  assert.equal(availability.filter((item) => item.executionStatus === "planned").length, 0);
});

test("P11 Finance, Portfolio, Pricing/Risk and Quant packs route end-to-end through existing LiOS engines", async () => {
  const runtime = registry();
  for (const capability of [
    "finance.valuation.reverse_dcf",
    "portfolio.optimize.hrp",
    "pricing.derivatives.black_scholes",
    "forecast.model.tournament",
  ]) {
    const result = await executeP11Capability(runtime, capability, { source: [1, 2, 3] }, context);
    assert.equal(result.capability, capability);
    assert.equal(result.deterministic, true);
    assert.equal((result.output as { deterministicProof?: boolean }).deterministicProof, true);
    assert.ok(result.receiptRef);
  }
});

test("P11 statistics, portfolio risk contribution and local ML are real executable routes", async () => {
  const runtime = registry();

  const statistics = await executeP11Capability(
    runtime,
    "finance.econometrics.statistics",
    { data: [1, 2, 3, 4, 5] },
    context,
  );
  assert.equal((statistics.output as { routePath: string }).routePath, "/stats/descriptive-diagnostics");

  const risk = await executeP11Capability(
    runtime,
    "portfolio.risk.contribution",
    { assets: ["A", "B"], covariance: [[1, 0], [0, 1]], riskBudgets: [0.5, 0.5] },
    context,
  );
  assert.equal((risk.output as { routePath: string }).routePath, "/advanced/portfolio/risk-budget");

  const ml = await executeP11Capability(
    runtime,
    "quant.ml.local",
    { operation: "classification", X: [[0], [1]], y: [0, 1], seed: 7 },
    context,
  );
  assert.equal((ml.output as { routePath: string }).routePath, "/ml/classification");
  await assert.rejects(
    () => executeP11Capability(runtime, "quant.ml.local", { operation: "unknown" }, context),
    /Unsupported P11 local ML operation/,
  );
});

test("P11 Research & Documents routes real Project search and governed runtime capabilities", async () => {
  const runtime = registry();
  const document = {
    schemaVersion: "1" as const,
    id: "p7doc:test-research",
    projectId: 1,
    sourceType: "research_evidence" as const,
    sourceRef: "evidence:pricing-power",
    title: "Pricing power evidence",
    body: "Gross margin expansion and price increases support the pricing power thesis.",
    contentHash: "a".repeat(64),
  };

  const search = await executeP11Capability(
    runtime,
    "research.project.search",
    { documents: [document], query: "pricing power", limit: 10 },
    context,
  );
  const searchOutput = search.output as { projectId: number; resultCount: number; hits: Array<{ sourceRef: string }> };
  assert.equal(searchOutput.projectId, 1);
  assert.equal(searchOutput.resultCount, 1);
  assert.equal(searchOutput.hits[0]?.sourceRef, "evidence:pricing-power");
  assert.equal(search.deterministic, true);

  const runtimeContract = await executeP11Capability(runtime, "research.project.runtime", {}, context);
  const runtimeOutput = runtimeContract.output as { projectId: number; projectScoped: boolean; canonicalStateOwner: string; unrestrictedFilesystem: boolean; directSecretExposure: boolean };
  assert.equal(runtimeOutput.projectId, 1);
  assert.equal(runtimeOutput.projectScoped, true);
  assert.equal(runtimeOutput.canonicalStateOwner, "LiOS Project/Artifact/Ledger");
  assert.equal(runtimeOutput.unrestrictedFilesystem, false);
  assert.equal(runtimeOutput.directSecretExposure, false);
  assert.equal(Object.hasOwn(runtimeContract.output as object, "donorAdaptations"), false);

  await assert.rejects(
    () => executeP11Capability(
      runtime,
      "research.project.search",
      { documents: [{ ...document, projectId: 2 }], request: { query: "pricing power" } },
      context,
    ),
    /outside the active Project/,
  );

});

test("P11 Data Lab materializes Parquet and scans governed columnar artifacts through DuckDB", async () => {
  const runtime = registry();

  const parquet = await executeP11Capability(
    runtime,
    "data.columnar.parquet",
    { datasetSnapshotId: "snapshot-1" },
    context,
  );
  assert.equal((parquet.output as { created: boolean }).created, true);
  assert.equal((parquet.output as { artifact: { datasetSnapshotId: string } }).artifact.datasetSnapshotId, "snapshot-1");

  const scan = await executeP11Capability(
    runtime,
    "data.local.duckdb",
    { artifactId: "artifact-1", metric: "close", dateFrom: "2026-01-01", dateTo: "2026-09-24", limit: 25 },
    context,
  );
  assert.equal((scan.output as { metric: string }).metric, "close");
  assert.equal((scan.output as { actor: { userId: number } }).actor.userId, context.userId);

  await assert.rejects(
    () => executeP11Capability(runtime, "data.local.duckdb", { artifactId: "artifact-1", dateFrom: "2026-09-24", dateTo: "2026-01-01" }, context),
    /dateTo must be on or after dateFrom/,
  );
  await assert.rejects(
    () => executeP11Capability(runtime, "data.columnar.arrow", {}, context),
    /not registered|unknown capability/i,
  );
});

test("P11 strategy validation, local documents, market data and Local AI execute through existing LiOS authorities", async () => {
  const runtime = registry();

  const strategy = await executeP11Capability(runtime, "strategy.research.validate", {
    request: pointInTimeBacktestRequest(),
    monteCarlo: { paths: 20, seed: 7 },
  }, context);
  const strategyOutput = strategy.output as { pointInTimeVerified: boolean; methods: string[]; validation: { monteCarlo: unknown } };
  assert.equal(strategyOutput.pointInTimeVerified, true);
  assert.deepEqual(strategyOutput.methods, ["monteCarlo"]);
  assert.ok(strategyOutput.validation.monteCarlo);

  const parsed = await executeP11Capability(runtime, "documents.local.parse", { path: "/tmp/research.pdf" }, context);
  assert.equal((parsed.output as { parser: string }).parser, "docling");

  const catalog = await executeP11Capability(runtime, "provider.market.catalog", { query: "apple", limit: 10 }, context);
  assert.equal((catalog.output as { resultCount: number }).resultCount, 1);

  const history = await executeP11Capability(runtime, "provider.market.history", { symbol: "aapl", range: "1M" }, context);
  assert.equal((history.output as { bars: unknown[] }).bars.length, 1);
  assert.equal(history.receiptRef, "provider:fixture");

  const localAi = await executeP11Capability(runtime, "local-ai.provider.invoke", {
    provider: "lm_studio",
    model: "fixture-local-model",
    messages: [{ role: "user", content: "Summarize locally." }],
  }, { ...context, approvedActions: ["local-ai.provider.invoke"] });
  assert.equal(localAi.deterministic, false);
  assert.equal((localAi.output as { provider: string }).provider, "lm_studio");
  assert.equal(localAi.receiptRef, "00000000-0000-4000-8000-000000009911");

  await assert.rejects(
    () => executeP11Capability(runtime, "local-ai.provider.invoke", {
      provider: "openai",
      messages: [{ role: "user", content: "Do not send this remotely." }],
    }, context),
    /refuses non-local providers/,
  );
});

test("P11 artifact inspection is Project-scoped while server Office exports are explicitly deferred; Local AI discovery is live", async () => {
  const runtime = registry();

  const inspected = await executeP11Capability(
    runtime,
    "modeling.artifact.inspect",
    { artifactId: "artifact-valuation", version: 2 },
    context,
  );
  const output = inspected.output as { artifactId: string; projectId: number; version: number; contentHash: string; sourceRefs: string[] };
  assert.equal(output.artifactId, "artifact-valuation");
  assert.equal(output.projectId, 1);
  assert.equal(output.version, 2);
  assert.equal(output.contentHash, "c".repeat(64));
  assert.deepEqual(output.sourceRefs, ["filing:aapl-10k"]);
  assert.equal(inspected.receiptRef, "c".repeat(64));

  await assert.rejects(
    () => executeP11Capability(runtime, "modeling.artifact.inspect", { artifactId: "artifact-other-project" }, context),
    /outside the active Project/,
  );
  await assert.rejects(
    () => executeP11Capability(runtime, "modeling.artifact.inspect", { artifactId: "artifact-valuation", version: 0 }, context),
    /positive integer/,
  );
  for (const exportCapability of ["reporting.export.xlsx", "reporting.export.docx", "reporting.export.pptx"]) {
    await assert.rejects(
      () => executeP11Capability(runtime, exportCapability, {}, context),
      /not registered|unknown capability/i,
    );
  }

  const localAi = await executeP11Capability(runtime, "local-ai.provider.inspect", {}, context);
  assert.equal((localAi.output as { byoai: boolean }).byoai, true);
  assert.equal((localAi.output as { modelWeightsBundled: boolean }).modelWeightsBundled, false);
});

test("P11 broker pack exposes the connector boundary but live order execution remains fail-closed", async () => {
  const runtime = registry();
  await assert.rejects(() => executeP11Capability(runtime, "broker.execution.inspect", {}, context), /not registered|unknown capability/i);
  await assert.rejects(
    () => executeP11Capability(runtime, "broker.execution.order", {}, context),
    /disabled/i,
  );
});

test("P11 RuntimeRegistry owns all capability routes and hidden donor names do not appear in component names", () => {
  const runtime = registry();
  const routable = P11_PACK_CATALOG.flatMap((pack) => pack.availability
    .filter((item) => item.executionStatus !== "planned" && item.executionStatus !== "deferred")
    .map((item) => item.capability)).sort();
  assert.deepEqual(runtime.listCapabilityRoutes().map((route) => route.capability).sort(), routable);
  for (const pack of P11_PACK_CATALOG) {
    const active = runtime.list().find((item) => item.id === `p11:${pack.id}`)?.capabilities ?? [];
    assert.deepEqual(active.sort(), pack.availability.filter((item) => item.executionStatus !== "planned" && item.executionStatus !== "deferred").map((item) => item.capability).sort());
  }
  for (const descriptor of runtime.list()) {
    assert.doesNotMatch(descriptor.name, /\b(?:skfolio|riskfolio|quantlib|edgartools?|docling|qlib|strata|ore)\b/i);
  }
});
