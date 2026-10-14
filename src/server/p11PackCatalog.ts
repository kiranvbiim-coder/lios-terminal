import { engineCapabilitySchema, type PackCapabilityAvailability } from "@shared/engineFabricContracts";

export const P11_PACK_IDS = [
  "lios.finance",
  "lios.portfolio",
  "lios.pricing-risk",
  "lios.quant-forecast",
  "lios.strategy-backtest",
  "lios.research-documents",
  "lios.data-lab",
  "lios.market-data",
  "lios.broker-execution",
  "lios.reporting-modeling",
  "lios.local-ai",
] as const;

export type P11PackId = typeof P11_PACK_IDS[number];

export interface P11PackDefinition {
  id: P11PackId;
  displayName: string;
  description: string;
  runtimeKinds: Array<"python" | "node" | "native" | "jvm" | "dotnet" | "wasm">;
  managedPackIds: string[];
  capabilities: string[];
  proofCapability: string | null;
  proofImplementation: string | null;
  defaultInstalled: boolean;
  availability: PackCapabilityAvailability[];
}

function capability(value: string): string {
  return engineCapabilitySchema.parse(value);
}

function local(capabilityId: string, extra: Partial<PackCapabilityAvailability> = {}): PackCapabilityAvailability {
  return {
    capability: capability(capabilityId),
    offline: "full",
    requiresUserData: false,
    requiresProvider: false,
    requiresModelDownload: false,
    requiresEntitlement: false,
    ...extra,
    executionStatus: extra.executionStatus ?? "available",
  };
}

function deferred(capabilityId: string, extra: Partial<PackCapabilityAvailability> = {}): PackCapabilityAvailability {
  return local(capabilityId, { ...extra, executionStatus: "deferred" });
}

function policyBlocked(capabilityId: string, extra: Partial<PackCapabilityAvailability> = {}): PackCapabilityAvailability {
  return local(capabilityId, { ...extra, executionStatus: "policy_blocked" });
}

export const P11_PACK_CATALOG: readonly P11PackDefinition[] = Object.freeze([
  {
    id: "lios.finance",
    displayName: "Core Finance",
    description: "Deterministic valuation, statistics and finance calculations behind LiOS-owned contracts.",
    runtimeKinds: ["python", "node"],
    managedPackIds: ["core"],
    capabilities: [
      capability("finance.valuation.reverse_dcf"),
      capability("finance.valuation.residual_income"),
      capability("finance.econometrics.statistics"),
    ],
    proofCapability: capability("finance.valuation.reverse_dcf"),
    proofImplementation: "advancedQuantExecution:valuation/reverse-dcf",
    defaultInstalled: true,
    availability: [
      local("finance.valuation.reverse_dcf", { requiresUserData: true }),
      local("finance.valuation.residual_income", { requiresUserData: true }),
      local("finance.econometrics.statistics", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.portfolio",
    displayName: "Portfolio",
    description: "Portfolio construction, risk allocation and optimization.",
    runtimeKinds: ["python", "node"],
    managedPackIds: ["core", "optimization"],
    capabilities: [
      capability("portfolio.optimize.hrp"),
      capability("portfolio.optimize.black_litterman"),
      capability("portfolio.risk.contribution"),
    ],
    proofCapability: capability("portfolio.optimize.hrp"),
    proofImplementation: "advancedQuantExecution:portfolio/hrp",
    defaultInstalled: false,
    availability: [
      local("portfolio.optimize.hrp", { requiresUserData: true }),
      local("portfolio.optimize.black_litterman", { requiresUserData: true }),
      local("portfolio.risk.contribution", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.pricing-risk",
    displayName: "Pricing & Risk",
    description: "Fixed income, derivatives, curves, Greeks and institutional risk calculations.",
    runtimeKinds: ["python", "native", "jvm"],
    managedPackIds: ["fixed-income"],
    capabilities: [
      capability("pricing.derivatives.black_scholes"),
      capability("pricing.fixed_income.curve"),
      capability("risk.portfolio.tail"),
    ],
    proofCapability: capability("pricing.derivatives.black_scholes"),
    proofImplementation: "advancedQuantExecution:derivatives/black-scholes-greeks",
    defaultInstalled: false,
    availability: [
      local("pricing.derivatives.black_scholes", { requiresUserData: true }),
      local("pricing.fixed_income.curve", { requiresUserData: true }),
      local("risk.portfolio.tail", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.quant-forecast",
    displayName: "Quant & Forecast",
    description: "Forecasting, econometrics, machine learning and factor research.",
    runtimeKinds: ["python"],
    managedPackIds: ["forecasting", "econometrics", "ml", "optimization"],
    capabilities: [
      capability("forecast.model.tournament"),
      capability("quant.econometrics.event_study"),
      capability("quant.ml.local"),
    ],
    proofCapability: capability("forecast.model.tournament"),
    proofImplementation: "advancedQuantExecution:forecasting/model-tournament",
    defaultInstalled: false,
    availability: [
      local("forecast.model.tournament", { requiresUserData: true }),
      local("quant.econometrics.event_study", { requiresUserData: true }),
      local("quant.ml.local", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.strategy-backtest",
    displayName: "Strategy & Backtest",
    description: "Governed strategy execution and point-in-time backtesting.",
    runtimeKinds: ["node", "python", "dotnet"],
    managedPackIds: ["core", "optimization"],
    capabilities: [
      capability("backtest.strategy.standard"),
      capability("strategy.research.validate"),
    ],
    proofCapability: capability("backtest.strategy.standard"),
    proofImplementation: "p6BacktestEngine:runP6Backtest",
    defaultInstalled: false,
    availability: [
      local("backtest.strategy.standard", { requiresUserData: true }),
      local("strategy.research.validate", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.research-documents",
    displayName: "Research & Documents",
    description: "Project intelligence, SEC research, XBRL and local document intelligence.",
    runtimeKinds: ["node", "python"],
    managedPackIds: ["research-sec", "research-docs"],
    capabilities: [
      capability("research.project.search"),
      capability("research.project.runtime"),
      capability("documents.local.parse"),
    ],
    proofCapability: capability("research.project.search"),
    proofImplementation: "p7ProjectIntelligence:searchProjectDocuments",
    defaultInstalled: false,
    availability: [
      local("research.project.search", { requiresUserData: true }),
      local("research.project.runtime"),
      local("documents.local.parse", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.data-lab",
    displayName: "Data Lab",
    description: "Local high-volume analytical data handling and columnar interchange.",
    runtimeKinds: ["node", "python"],
    managedPackIds: ["core", "econometrics", "forecasting", "optimization", "ml"],
    capabilities: [
      capability("data.local.duckdb"),
      capability("data.columnar.parquet"),
      capability("data.columnar.arrow"),
    ],
    proofCapability: capability("data.columnar.parquet"),
    proofImplementation: "columnarArtifactStore:createColumnarArtifact",
    defaultInstalled: false,
    availability: [
      local("data.local.duckdb", { requiresUserData: true }),
      local("data.columnar.parquet", { requiresUserData: true }),
      deferred("data.columnar.arrow", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.market-data",
    displayName: "Market Data",
    description: "Provider-neutral governed market-data connector boundary.",
    runtimeKinds: ["node", "python"],
    managedPackIds: [],
    capabilities: [
      capability("provider.market.catalog"),
      capability("provider.market.history"),
      capability("provider.market.stream"),
    ],
    proofCapability: capability("provider.market.catalog"),
    proofImplementation: "marketData:PROFILE_CATALOG/listStoredSymbols",
    defaultInstalled: false,
    availability: [
      local("provider.market.catalog", { offline: "local_data_only", requiresProvider: false, requiresEntitlement: true }),
      local("provider.market.history", { offline: "network_required", requiresProvider: true, requiresEntitlement: true }),
      deferred("provider.market.stream", { offline: "network_required", requiresProvider: true, requiresEntitlement: true }),
    ],
  },
  {
    id: "lios.broker-execution",
    displayName: "Broker & Execution",
    description: "Governed broker connector boundary; order writes remain disabled unless separately approved.",
    runtimeKinds: ["node", "python", "dotnet"],
    managedPackIds: [],
    capabilities: [
      capability("broker.execution.inspect"),
      capability("broker.execution.order"),
    ],
    proofCapability: null,
    proofImplementation: null,
    defaultInstalled: false,
    availability: [
      deferred("broker.execution.inspect", { offline: "network_required", requiresProvider: true, requiresEntitlement: true }),
      policyBlocked("broker.execution.order", { offline: "network_required", requiresProvider: true, requiresEntitlement: true }),
    ],
  },
  {
    id: "lios.reporting-modeling",
    displayName: "Reporting & Modeling",
    description: "Model/report artifact and export capability convergence.",
    runtimeKinds: ["node", "python"],
    managedPackIds: [],
    capabilities: [
      capability("reporting.export.xlsx"),
      capability("reporting.export.docx"),
      capability("reporting.export.pptx"),
      capability("modeling.artifact.inspect"),
    ],
    proofCapability: capability("modeling.artifact.inspect"),
    proofImplementation: "artifactStore:getArtifactVersion",
    defaultInstalled: false,
    availability: [
      deferred("reporting.export.xlsx", { requiresUserData: true }),
      deferred("reporting.export.docx", { requiresUserData: true }),
      deferred("reporting.export.pptx", { requiresUserData: true }),
      local("modeling.artifact.inspect", { requiresUserData: true }),
    ],
  },
  {
    id: "lios.local-ai",
    displayName: "Local AI",
    description: "Provider-neutral BYO local AI discovery and invocation; model weights are never silently downloaded.",
    runtimeKinds: ["node", "native"],
    managedPackIds: [],
    capabilities: [
      capability("local-ai.provider.inspect"),
      capability("local-ai.provider.invoke"),
    ],
    proofCapability: capability("local-ai.provider.inspect"),
    proofImplementation: "byoaiRouter:getAvailableProviders",
    defaultInstalled: false,
    availability: [
      local("local-ai.provider.inspect"),
      local("local-ai.provider.invoke", { requiresProvider: true, requiresModelDownload: true }),
    ],
  },
]);

export function p11PackById(id: P11PackId): P11PackDefinition {
  const pack = P11_PACK_CATALOG.find((item) => item.id === id);
  if (!pack) throw new Error(`Unknown P11 pack: ${id}`);
  return pack;
}

export function p11PackForCapability(capabilityId: string): P11PackDefinition | null {
  const parsed = engineCapabilitySchema.parse(capabilityId);
  return P11_PACK_CATALOG.find((pack) => pack.capabilities.includes(parsed)) ?? null;
}

export function validateP11PackCatalog(): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const capabilities = new Set<string>();
  for (const pack of P11_PACK_CATALOG) {
    if (ids.has(pack.id)) errors.push(`Duplicate P11 pack id: ${pack.id}`);
    ids.add(pack.id);
    if (pack.proofCapability && !pack.capabilities.includes(pack.proofCapability)) errors.push(`P11 pack ${pack.id} proof capability is not registered.`);
    if ((pack.proofCapability === null) !== (pack.proofImplementation === null)) errors.push(`P11 pack ${pack.id} must declare both proof fields or neither.`);
    if (pack.proofCapability && pack.availability.find((item) => item.capability === pack.proofCapability)?.executionStatus !== "available") {
      errors.push(`P11 pack ${pack.id} proof capability must have an executable implementation.`);
    }
    for (const item of pack.capabilities) {
      if (capabilities.has(item)) errors.push(`P11 capability ${item} is owned by multiple packs.`);
      capabilities.add(item);
    }
  }
  if (ids.size !== P11_PACK_IDS.length) errors.push("P11 pack catalog does not contain every canonical pack.");
  const defaults = P11_PACK_CATALOG.filter((pack) => pack.defaultInstalled);
  if (defaults.length !== 1 || defaults[0]?.id !== "lios.finance") errors.push("Only Core Finance may be default-installed in P11.");
  return errors;
}
