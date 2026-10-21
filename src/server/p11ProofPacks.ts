import { z } from "zod";
import {
  canonicalEngineResultSchema,
  engineCapabilitySchema,
  type CanonicalEngineResult,
} from "@shared/engineFabricContracts";
import {
  LIOS_RUNTIME_CONTRACT_VERSION,
  runtimeComponentDescriptorSchema,
  type RuntimeAdapter,
  type RuntimeExecutionContext,
} from "@shared/runtimeContracts";
import { RuntimeRegistry } from "@shared/runtimeRegistry";
import { p7ProjectDocumentSchema, type P7ProjectDocument } from "@shared/p7ResearchContracts";
import {
  executeAdvancedQuant,
  type AdvancedQuantEngineCall,
  type AdvancedQuantPath,
} from "./advancedQuantExecution";
import { runP6Backtest, runP6MonteCarlo, runP6ParameterSweep, runP6WalkForward } from "./p6BacktestEngine";
import { p6BacktestRequestSchema } from "@shared/p6FinanceContracts";
import { createColumnarArtifact, scanColumnarArtifact, type ColumnarArtifactActor } from "./columnarArtifactStore";
import { searchProjectDocuments } from "./p7ProjectIntelligence";
import { p7AgentRuntimeContract } from "./p7ResearchTools";
import { getAvailableProviders, getProviderConfig, normalizeProviderId } from "./byoaiRouter";
import { invokeAIProvider, type AICompletionResult } from "./byoaiTransport";
import { parseLocalDocumentWithDocling, type P7DocumentParseResult } from "./p7DocumentIntelligence";
import { PROFILE_CATALOG, getOHLCVWithProvenance, type OHLCVWithProvenance } from "./marketData";
import { connectedMarketDataConnectorIds } from "./marketDataConnectors";
import { listStoredSymbols } from "./marketHistoryStore";
import { getArtifact, getArtifactVersion, type ArtifactReadContext } from "./artifactStore";
import { P11_PACK_CATALOG, type P11PackDefinition } from "./p11PackCatalog";
import { callPythonService } from "./pythonService";

export interface P11ExecutableAdapter extends RuntimeAdapter {
  executeP11: (
    capability: string,
    input: unknown,
    context: RuntimeExecutionContext,
  ) => Promise<CanonicalEngineResult>;
}

type P11ColumnarMaterializer = (datasetSnapshotId: string, actor: ColumnarArtifactActor) => Promise<unknown>;
type P11ColumnarScanner = (
  artifactId: string,
  input: { metric?: string; dateFrom?: string; dateTo?: string; limit?: number },
  actor: ColumnarArtifactActor,
) => Promise<unknown | null>;

export interface P11ArtifactInspection {
  artifactId: string;
  projectId: number | null;
  kind: string;
  title: string;
  status: string;
  origin: string;
  headVersion: number;
  version: number;
  contentHash: string;
  sourceRefs: string[];
  executionReceiptIds: string[];
  assumptionRefs: string[];
  contentKind: string | null;
}

type P11ArtifactInspector = (
  actor: ArtifactReadContext,
  artifactId: string,
  version?: number,
) => Promise<P11ArtifactInspection>;

type P11DocumentParser = (inputPath: string) => Promise<P7DocumentParseResult>;
type P11MarketHistoryProvider = (
  symbol: string,
  range?: string,
  interval?: "5m" | "15m" | "1h" | "1d",
  allowKeyedFallback?: boolean,
) => Promise<OHLCVWithProvenance>;
type P11MarketCatalogProvider = (input: {
  query?: string;
  limit: number;
}) => Promise<unknown> | unknown;
type P11LocalAiInvoker = typeof invokeAIProvider;

export interface P11ProofAdapterOptions {
  advancedQuantEngine?: AdvancedQuantEngineCall;
  pythonEngine?: AdvancedQuantEngineCall;
  createColumnarArtifact?: P11ColumnarMaterializer;
  scanColumnarArtifact?: P11ColumnarScanner;
  artifactInspector?: P11ArtifactInspector;
  documentParser?: P11DocumentParser;
  marketHistoryProvider?: P11MarketHistoryProvider;
  marketCatalogProvider?: P11MarketCatalogProvider;
  localAiInvoker?: P11LocalAiInvoker;
}

const advancedPathByCapability: Record<string, AdvancedQuantPath> = {
  "finance.valuation.reverse_dcf": "valuation/reverse-dcf",
  "finance.valuation.residual_income": "valuation/residual-income",
  "portfolio.optimize.hrp": "portfolio/hrp",
  "portfolio.optimize.black_litterman": "portfolio/black-litterman",
  "portfolio.risk.contribution": "portfolio/risk-budget",
  "pricing.derivatives.black_scholes": "derivatives/black-scholes-greeks",
  "pricing.fixed_income.curve": "fixed-income/bootstrap-par-curve",
  "risk.portfolio.tail": "risk/tail-report",
  "forecast.model.tournament": "forecasting/model-tournament",
  "quant.econometrics.event_study": "econometrics/event-study",
};


const strategyResearchValidationInputSchema = z.object({
  request: p6BacktestRequestSchema,
  walkForward: z.object({
    trainBars: z.number().int().min(2),
    testBars: z.number().int().min(2),
  }).strict().optional(),
  parameterSweep: z.object({
    parameter: z.string().trim().min(1).max(120),
    values: z.array(z.number().finite()).min(1).max(500),
  }).strict().optional(),
  monteCarlo: z.object({
    paths: z.number().int().min(10).max(10_000).default(500),
    seed: z.number().int().default(20260922),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.walkForward && !value.parameterSweep && !value.monteCarlo) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "strategy.research.validate requires walkForward, parameterSweep or monteCarlo validation settings.",
    });
  }
});

const localDocumentParseInputSchema = z.object({
  path: z.string().trim().min(1).max(4_000),
}).strict();

const marketCatalogInputSchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.number().int().min(1).max(500).default(100),
}).strict().default({});

const marketHistoryInputSchema = z.object({
  symbol: z.string().trim().min(1).max(80),
  range: z.string().trim().min(1).max(20).default("1Y"),
  interval: z.enum(["5m", "15m", "1h", "1d"]).default("1d"),
  allowKeyedFallback: z.boolean().default(true),
}).strict();

const localAiInvokeInputSchema = z.object({
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(300).optional(),
  system: z.string().max(50_000).optional(),
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(500_000),
  }).strict()).min(1).max(200),
  maxTokens: z.number().int().min(1).max(32_000).optional(),
}).strict();

const dataLabParquetInputSchema = z.object({
  datasetSnapshotId: z.string().trim().min(1).max(300),
}).strict();

const dataLabDuckDbInputSchema = z.object({
  artifactId: z.string().trim().min(1).max(300),
  metric: z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "dateTo must be on or after dateFrom." });
  }
});

function defaultMarketCatalog(input: { query?: string; limit: number }) {
  const stored = new Set(listStoredSymbols().map((symbol) => symbol.toUpperCase()));
  const query = input.query?.trim().toLowerCase() ?? "";
  const symbols = [...new Set([...Object.keys(PROFILE_CATALOG), ...stored])].sort();
  const entries = symbols
    .map((symbol) => ({ symbol, profile: PROFILE_CATALOG[symbol] ?? null, locallyStored: stored.has(symbol) }))
    .filter(({ symbol, profile }) => {
      if (!query) return true;
      const haystack = [
        symbol,
        profile?.name ?? "",
        profile?.exchange ?? "",
        profile?.sector ?? "",
        profile?.assetClass ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .slice(0, input.limit);
  return {
    resultCount: entries.length,
    entries,
    connectedConnectorIds: connectedMarketDataConnectorIds(),
    catalogOwner: "LiOS Market Data",
  };
}

function requireColumnarActor(context: RuntimeExecutionContext): ColumnarArtifactActor {
  if (context.userId === null) {
    throw new Error("P11 Data Lab requires an authenticated user context.");
  }
  return { userId: context.userId, organizationId: context.organizationId };
}

function parseArtifactInspectInput(input: unknown): { artifactId: string; version?: number } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("P11 modeling.artifact.inspect input must contain an artifactId.");
  }
  const record = input as Record<string, unknown>;
  const artifactId = typeof record.artifactId === "string" ? record.artifactId.trim() : "";
  if (!artifactId || artifactId.length > 300) {
    throw new Error("P11 modeling.artifact.inspect requires a valid artifactId.");
  }
  const version = record.version;
  if (version !== undefined && (!Number.isInteger(version) || Number(version) <= 0)) {
    throw new Error("P11 modeling.artifact.inspect version must be a positive integer.");
  }
  return { artifactId, ...(version === undefined ? {} : { version: Number(version) }) };
}

function requireArtifactContext(context: RuntimeExecutionContext): { actor: ArtifactReadContext; projectId: number } {
  if (context.userId === null) throw new Error("P11 artifact inspection requires an authenticated user context.");
  if (!Number.isInteger(context.projectId) || Number(context.projectId) <= 0) {
    throw new Error("P11 artifact inspection requires an active Project context.");
  }
  return {
    actor: { userId: context.userId, organizationId: context.organizationId },
    projectId: Number(context.projectId),
  };
}

async function inspectArtifact(
  actor: ArtifactReadContext,
  artifactId: string,
  version?: number,
): Promise<P11ArtifactInspection> {
  const [artifact, artifactVersion] = await Promise.all([
    getArtifact(actor, artifactId),
    getArtifactVersion(actor, artifactId, version),
  ]);
  const content = artifactVersion.content as Record<string, unknown>;
  return {
    artifactId: artifact.id,
    projectId: artifact.projectId,
    kind: artifact.kind,
    title: artifact.title,
    status: artifact.status,
    origin: artifact.origin,
    headVersion: artifact.headVersion,
    version: artifactVersion.version,
    contentHash: artifactVersion.contentHash,
    sourceRefs: artifactVersion.sourceRefs,
    executionReceiptIds: artifactVersion.executionReceiptIds,
    assumptionRefs: artifactVersion.assumptionRefs,
    contentKind: typeof content.kind === "string" ? content.kind : null,
  };
}

const localMlRouteByOperation: Record<string, string> = {
  classification: "/ml/classification",
  regression: "/ml/regression",
  clustering: "/ml/clustering",
  anomaly_detection: "/ml/anomaly-detection",
};

function splitOperationInput(input: unknown): { operation: string; parameters: Record<string, unknown> } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("P11 local ML input must be an object with an operation.");
  }
  const { operation, ...parameters } = input as Record<string, unknown>;
  if (typeof operation !== "string" || !operation.trim()) {
    throw new Error("P11 local ML input requires an operation.");
  }
  return { operation: operation.trim(), parameters };
}

function componentKind(pack: P11PackDefinition): "finance_engine" | "backtest_engine" | "tool" {
  if (pack.id === "lios.finance" || pack.id === "lios.portfolio" || pack.id === "lios.pricing-risk" || pack.id === "lios.quant-forecast") return "finance_engine";
  if (pack.id === "lios.strategy-backtest") return "backtest_engine";
  // Pack wrappers are internal capability adapters, not replacements for the
  // specialist Provider/Connector/AI registries. Those registries remain the
  // authority for actual providers, credentials and connector lifecycle.
  return "tool";
}

function executionScopes(pack: P11PackDefinition) {
  if (pack.runtimeKinds.includes("python")) return ["python_sidecar", "node_worker"] as const;
  return ["node_worker"] as const;
}

function result(
  pack: P11PackDefinition,
  capability: string,
  output: unknown,
  deterministic: boolean,
  warnings: string[] = [],
  receiptRef: string | null = null,
): CanonicalEngineResult {
  return canonicalEngineResultSchema.parse({
    schemaVersion: "1",
    capability,
    packId: pack.id,
    componentId: `p11:${pack.id}`,
    engineVersion: "1.0.0",
    deterministic,
    output,
    dataRefs: [],
    semanticConventions: {
      timezone: "UTC",
      currency: null,
      scale: 1,
      frequency: null,
      calendar: null,
      dayCount: null,
      adjustedPrices: null,
      asOf: null,
      asKnownOn: null,
    },
    warnings,
    receiptRef,
  });
}

function requireProjectContext(context: RuntimeExecutionContext): number {
  if (!Number.isInteger(context.projectId) || Number(context.projectId) <= 0) {
    throw new Error("P11 Project-scoped research capability requires an active Project context.");
  }
  return Number(context.projectId);
}

function parseProjectSearchInput(input: unknown, projectId: number): { documents: P7ProjectDocument[]; request: unknown } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("P11 research.project.search input must contain documents and a search request.");
  }
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.documents)) {
    throw new Error("P11 research.project.search requires a documents array.");
  }
  const documents = p7ProjectDocumentSchema.array().max(50_000).parse(record.documents);
  if (documents.some((document) => document.projectId !== projectId)) {
    throw new Error("P11 research.project.search refuses documents outside the active Project.");
  }
  const request = record.request ?? Object.fromEntries(
    Object.entries(record).filter(([key]) => key !== "documents"),
  );
  return { documents, request };
}

async function executePackCapability(
  pack: P11PackDefinition,
  capabilityInput: string,
  input: unknown,
  context: RuntimeExecutionContext,
  options: P11ProofAdapterOptions,
): Promise<CanonicalEngineResult> {
  const capability = engineCapabilitySchema.parse(capabilityInput);
  if (!pack.capabilities.includes(capability)) {
    throw new Error(`Capability ${capability} is not owned by ${pack.id}.`);
  }

  const advancedPath = advancedPathByCapability[capability];
  if (advancedPath) {
    const execution = await executeAdvancedQuant(advancedPath, input, {
      callEngine: options.advancedQuantEngine,
    });
    return result(
      pack,
      capability,
      execution.result,
      true,
      execution.receipt.warnings,
      execution.receipt.runId,
    );
  }

  if (capability === "finance.econometrics.statistics") {
    const callEngine = options.pythonEngine ?? callPythonService;
    const output = await callEngine("/stats/descriptive-diagnostics", input);
    return result(pack, capability, output, true);
  }

  if (capability === "quant.ml.local") {
    const parsed = splitOperationInput(input);
    const routePath = localMlRouteByOperation[parsed.operation];
    if (!routePath) {
      throw new Error("Unsupported P11 local ML operation: " + parsed.operation);
    }
    const callEngine = options.pythonEngine ?? callPythonService;
    const output = await callEngine(routePath, parsed.parameters);
    return result(pack, capability, output, true);
  }

  if (capability === "strategy.research.validate") {
    const parsed = strategyResearchValidationInputSchema.parse(input);
    const base = runP6Backtest(parsed.request);
    const validation: Record<string, unknown> = {};
    if (parsed.walkForward) {
      validation.walkForward = runP6WalkForward({
        request: parsed.request,
        trainBars: parsed.walkForward.trainBars,
        testBars: parsed.walkForward.testBars,
      });
    }
    if (parsed.parameterSweep) {
      validation.parameterSweep = runP6ParameterSweep({
        request: parsed.request,
        parameter: parsed.parameterSweep.parameter,
        values: parsed.parameterSweep.values,
      });
    }
    if (parsed.monteCarlo) {
      validation.monteCarlo = runP6MonteCarlo({
        result: base,
        paths: parsed.monteCarlo.paths,
        seed: parsed.monteCarlo.seed,
      });
    }
    return result(pack, capability, {
      base,
      validation,
      methods: Object.keys(validation),
      pointInTimeVerified: base.pointInTimeVerified,
      reproducibilityHash: base.reproducibilityHash,
    }, true, base.warnings, base.reproducibilityId);
  }

  if (capability === "documents.local.parse") {
    const parsed = localDocumentParseInputSchema.parse(input);
    const parser = options.documentParser ?? parseLocalDocumentWithDocling;
    const output = await parser(parsed.path);
    return result(pack, capability, output, true, output.warnings);
  }

  if (capability === "provider.market.catalog") {
    const parsed = marketCatalogInputSchema.parse(input);
    const catalog = options.marketCatalogProvider ?? defaultMarketCatalog;
    const output = await catalog(parsed);
    return result(pack, capability, output, false);
  }

  if (capability === "provider.market.history") {
    const parsed = marketHistoryInputSchema.parse(input);
    const history = options.marketHistoryProvider ?? getOHLCVWithProvenance;
    const output = await history(parsed.symbol.toUpperCase(), parsed.range, parsed.interval, parsed.allowKeyedFallback);
    return result(
      pack,
      capability,
      output,
      false,
      output.provenance.notes,
      output.provenance.sourceRefs[0] ?? null,
    );
  }

    if (capability === "backtest.strategy.standard") {
    const output = runP6Backtest(input as Parameters<typeof runP6Backtest>[0]);
    return result(pack, capability, output, true, output.warnings, output.reproducibilityId);
  }

  if (capability === "data.columnar.parquet") {
    const parsed = dataLabParquetInputSchema.parse(input);
    const materialize = options.createColumnarArtifact ?? createColumnarArtifact;
    const output = await materialize(parsed.datasetSnapshotId, requireColumnarActor(context));
    return result(pack, capability, output, true);
  }

  if (capability === "data.local.duckdb") {
    const parsed = dataLabDuckDbInputSchema.parse(input);
    const scan = options.scanColumnarArtifact ?? scanColumnarArtifact;
    const output = await scan(
      parsed.artifactId,
      { metric: parsed.metric, dateFrom: parsed.dateFrom, dateTo: parsed.dateTo, limit: parsed.limit },
      requireColumnarActor(context),
    );
    if (!output) throw new Error("P11 Data Lab columnar artifact was not found.");
    return result(pack, capability, output, true);
  }

  if (capability === "research.project.search") {
    const projectId = requireProjectContext(context);
    const parsed = parseProjectSearchInput(input, projectId);
    const hits = searchProjectDocuments(parsed.documents, parsed.request);
    return result(pack, capability, {
      projectId,
      resultCount: hits.length,
      hits,
    }, true);
  }

  if (capability === "research.project.runtime") {
    const projectId = requireProjectContext(context);
    const { donorAdaptations: _hiddenDonorAdaptations, ...runtimeContract } = p7AgentRuntimeContract();
    return result(pack, capability, {
      projectId,
      ...runtimeContract,
    }, true);
  }

  if (capability === "modeling.artifact.inspect") {
    const parsed = parseArtifactInspectInput(input);
    const { actor, projectId } = requireArtifactContext(context);
    const inspector = options.artifactInspector ?? inspectArtifact;
    const output = await inspector(actor, parsed.artifactId, parsed.version);
    if (output.projectId !== projectId) {
      throw new Error("P11 artifact inspection refuses artifacts outside the active Project.");
    }
    return result(pack, capability, output, true, [], output.contentHash);
  }

  if (capability === "broker.execution.order") {
    throw new Error("Live broker order execution is disabled by current LiOS product policy.");
  }

  if (capability === "local-ai.provider.invoke") {
    const parsed = localAiInvokeInputSchema.parse(input);
    const provider = normalizeProviderId(parsed.provider);
    const config = provider ? getProviderConfig(provider) : undefined;
    if (!provider || !config) throw new Error("P11 local AI invocation requires a registered provider.");
    if (!config.isLocal) throw new Error("P11 local AI invocation refuses non-local providers.");
    const invoke = options.localAiInvoker ?? invokeAIProvider;
    const output: AICompletionResult = await invoke({
      provider,
      ...(parsed.model ? { model: parsed.model } : {}),
      ...(parsed.system ? { system: parsed.system } : {}),
      messages: parsed.messages,
      ...(parsed.maxTokens ? { maxTokens: parsed.maxTokens } : {}),
      dataClassification: context.dataClassification === "public" ? "public" : "organization",
      enterpriseApproval: context.approvedActions.includes("local-ai.provider.invoke"),
    });
    return result(pack, capability, output, false, [], output.attribution.id);
  }

  if (capability === "local-ai.provider.inspect") {
    return result(pack, capability, {
      providers: getAvailableProviders(),
      byoai: true,
      modelWeightsBundled: false,
      projectStateOwner: "LiOS",
    }, true);
  }

  throw new Error(`P11 capability ${capability} has no executable adapter.`);
}

export function createP11ProofAdapters(options: P11ProofAdapterOptions = {}): P11ExecutableAdapter[] {
  return P11_PACK_CATALOG.map((pack) => ({
    descriptor: runtimeComponentDescriptorSchema.parse({
      contractVersion: LIOS_RUNTIME_CONTRACT_VERSION,
      id: `p11:${pack.id}`,
      kind: componentKind(pack),
      name: pack.displayName,
      version: "1.0.0",
      lifecycle: pack.defaultInstalled ? "managed" : "optional",
      executionScopes: [...executionScopes(pack)],
      capabilities: pack.availability
        .filter((item) => item.executionStatus !== "planned" && item.executionStatus !== "deferred")
        .map((item) => item.capability),
      permissions: pack.id === "lios.broker-execution" ? ["broker:inspect"] : [],
      runtimePackId: pack.id,
      replaceable: true,
      source: {
        origin: "lios",
        importedPaths: [],
        modified: false,
      },
    }),
    executeP11: (capability, input, context) => {
      const status = pack.availability.find((item) => item.capability === capability)?.executionStatus;
      if (status === "planned") throw new Error(`P11 capability ${capability} is catalogued but not implemented in this build.`);
      if (status === "deferred") throw new Error(`P11 capability ${capability} is deliberately deferred from the V1 executable surface.`);
      return executePackCapability(pack, capability, input, context, options);
    },
  }));
}

export function registerP11ProofPacks(
  registry: RuntimeRegistry,
  options: P11ProofAdapterOptions = {},
): P11ExecutableAdapter[] {
  const adapters = createP11ProofAdapters(options);
  registry.registerMany(adapters);
  for (const adapter of adapters) {
    const pack = P11_PACK_CATALOG.find((item) => `p11:${item.id}` === adapter.descriptor.id)!;
    const componentId = adapter.descriptor.id;
    for (const capability of adapter.descriptor.capabilities) {
      registry.registerCapabilityRoute({
        capability,
        deterministic: !capability.startsWith("provider.") && capability !== "local-ai.provider.invoke",
        primary: { componentId, packId: pack.id },
        validator: null,
        fallback: null,
        entitlement: pack.availability.find((item) => item.capability === capability)?.requiresEntitlement
          ? `capability:${capability}`
          : null,
      });
    }
  }
  return adapters;
}

export async function executeP11Capability(
  registry: RuntimeRegistry,
  capability: string,
  input: unknown,
  context: RuntimeExecutionContext,
): Promise<CanonicalEngineResult> {
  const resolved = registry.resolveCapability(capability);
  const adapter = resolved.primary as P11ExecutableAdapter;
  if (typeof adapter.executeP11 !== "function") {
    throw new Error(`Primary component for ${capability} is not executable through P11.`);
  }
  return adapter.executeP11(capability, input, context);
}
