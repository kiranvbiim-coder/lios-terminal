import fs from "node:fs";
import path from "node:path";
import {
  compareEngineScalars,
  engineIntegrationDecisionSchema,
  type EngineValidationPolicy,
} from "@shared/engineFabricContracts";
import { P11_PACK_CATALOG, type P11PackId } from "./p11PackCatalog";
import { MANAGED_RUNTIME_MANIFEST } from "./runtimeManifest";

export interface P11CandidateRecord {
  id: string;
  repository?: string;
  observedCommit?: string;
  license: string;
  decision: string;
  pack: string;
  launch?: boolean;
  bundled?: boolean;
  roles?: string[];
  notes?: string;
}

export interface P11CandidateInventory {
  schemaVersion: string;
  policy: { decisions?: string[]; noAdaptLater?: boolean };
  candidates: P11CandidateRecord[];
}

export const P11_PERFORMANCE_BUDGETS = Object.freeze({
  baseInstallerIncrementMb: 5,
  packMetadataColdStartMs: 250,
  inProcessRouteWarmMs: 25,
  sidecarHandshakeMs: 2_000,
  sidecarIdleMemoryMb: 512,
  dataPlaneControlMessageBytes: 1024 * 1024,
  maxConcurrentHeavyPacks: 2,
});

export function validateP11CandidateInventory(inventory: P11CandidateInventory): string[] {
  const errors: string[] = [];
  if (inventory.schemaVersion !== "1") errors.push("P11 candidate inventory schemaVersion must be 1.");
  if (!inventory.policy?.noAdaptLater) errors.push("P11 inventory must explicitly prohibit adapt-later.");
  const seen = new Set<string>();
  for (const candidate of inventory.candidates ?? []) {
    if (seen.has(candidate.id)) errors.push(`Duplicate P11 candidate id: ${candidate.id}`);
    seen.add(candidate.id);
    const decision = engineIntegrationDecisionSchema.safeParse(candidate.decision);
    if (!decision.success) errors.push(`Candidate ${candidate.id} has an invalid integration decision.`);
    if (candidate.decision === "adapt" || candidate.decision === "adapt_later") errors.push(`Candidate ${candidate.id} is unresolved.`);
    if (!candidate.license?.trim()) errors.push(`Candidate ${candidate.id} has no license decision.`);
    if (!candidate.pack?.trim()) errors.push(`Candidate ${candidate.id} has no pack mapping.`);
    if (candidate.bundled && !candidate.observedCommit) errors.push(`Bundled candidate ${candidate.id} has no exact upstream commit.`);
    if (candidate.launch && (candidate.decision === "reference" || candidate.decision === "reject")) {
      errors.push(`Launch candidate ${candidate.id} cannot be reference/reject.`);
    }
  }
  return errors;
}

export function generateP11CycloneDxSbom(packId: string, candidates: P11CandidateRecord[]) {
  const components = candidates
    .filter((candidate) => candidate.pack === packId && candidate.decision !== "reference" && candidate.decision !== "reject")
    .map((candidate) => ({
      type: "library",
      name: candidate.id,
      version: candidate.observedCommit ?? "release-pin-required",
      licenses: [{ license: { name: candidate.license } }],
      purl: candidate.repository ? `pkg:github/${candidate.repository}@${candidate.observedCommit ?? "unreleased"}` : undefined,
      properties: [
        { name: "lios:integration-decision", value: candidate.decision },
        { name: "lios:launch", value: String(candidate.launch === true) },
      ],
    }));
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    serialNumber: "urn:uuid:00000000-0000-4000-8000-000000000011",
    version: 1,
    metadata: { component: { type: "application", name: packId } },
    components,
  };
}

export function generateP11ThirdPartyNotices(packId: string, candidates: P11CandidateRecord[]): string {
  const rows = candidates
    .filter((candidate) => candidate.pack === packId && candidate.decision !== "reference" && candidate.decision !== "reject")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((candidate) => [
      candidate.id,
      candidate.repository ? `Repository: ${candidate.repository}` : "Repository: n/a",
      `License: ${candidate.license}`,
      `Integration: ${candidate.decision}`,
      candidate.observedCommit ? `Pinned commit: ${candidate.observedCommit}` : "Pinned commit: required before bundling",
    ].join("\n"));
  return rows.join("\n\n");
}

export interface P11UpstreamPromotionEvidence {
  exactPin: boolean;
  licenseReviewed: boolean;
  dependencyDiffReviewed: boolean;
  securityScanPassed: boolean;
  upstreamTestsPassed: boolean;
  liosConformancePassed: boolean;
  benchmarkPassed: boolean;
  sbomGenerated: boolean;
  noticesGenerated: boolean;
  signedCandidateBuilt: boolean;
}

export function evaluateP11UpstreamPromotion(evidence: P11UpstreamPromotionEvidence): {
  approved: boolean;
  missing: Array<keyof P11UpstreamPromotionEvidence>;
} {
  const missing = (Object.keys(evidence) as Array<keyof P11UpstreamPromotionEvidence>)
    .filter((key) => evidence[key] !== true);
  return { approved: missing.length === 0, missing };
}

export function pythonPackEnvironmentPlan(input: {
  rootDir: string;
  packId: P11PackId;
  packVersion: string;
  pythonVersion: string;
  uvAvailable: boolean;
  requirementsFile: string;
}): {
  environmentDir: string;
  create: { command: string; args: string[] };
  install: { command: string; args: string[] };
  isolated: true;
} {
  const environmentDir = path.join(input.rootDir, input.packId, input.packVersion, "python");
  if (input.uvAvailable) {
    return {
      environmentDir,
      create: { command: "uv", args: ["venv", "--python", input.pythonVersion, environmentDir] },
      install: { command: "uv", args: ["pip", "sync", "--python", path.join(environmentDir, process.platform === "win32" ? "Scripts/python.exe" : "bin/python3"), input.requirementsFile] },
      isolated: true,
    };
  }
  const python = process.platform === "win32" ? "python" : "python3";
  return {
    environmentDir,
    create: { command: python, args: ["-m", "venv", environmentDir] },
    install: { command: path.join(environmentDir, process.platform === "win32" ? "Scripts/pip.exe" : "bin/pip"), args: ["install", "--requirement", input.requirementsFile] },
    isolated: true,
  };
}

export class P11ResourceGate {
  private active = 0;

  constructor(private readonly limits: {
    maxConcurrency: number;
    maxDatasetMb: number;
    maxTimeoutSec: number;
  }) {}

  snapshot() {
    return { active: this.active, ...this.limits };
  }

  async run<T>(input: {
    datasetBytes: number;
    timeoutSec?: number;
    execute: () => Promise<T>;
  }): Promise<T> {
    if (input.datasetBytes > this.limits.maxDatasetMb * 1024 * 1024) {
      throw new Error("P11 pack dataset exceeds its declared resource budget.");
    }
    if (this.active >= this.limits.maxConcurrency) {
      throw new Error("P11 pack concurrency budget is exhausted.");
    }
    const timeoutSec = Math.min(input.timeoutSec ?? this.limits.maxTimeoutSec, this.limits.maxTimeoutSec);
    this.active += 1;
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        input.execute(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error("P11 pack execution exceeded its timeout budget.")), timeoutSec * 1000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      this.active -= 1;
    }
  }
}

export function publicP11CapabilityLabel(capability: string): string {
  const labels: Record<string, string> = {
    "finance.valuation.reverse_dcf": "Reverse Valuation",
    "portfolio.optimize.hrp": "Advanced Portfolio Optimization",
    "pricing.derivatives.black_scholes": "Option Analytics",
    "forecast.model.tournament": "Forecast Model Selection",
    "backtest.strategy.standard": "Strategy Backtest",
    "strategy.research.validate": "Strategy Robustness Validation",
    "research.project.runtime": "Project Research Intelligence",
    "documents.local.parse": "Local Document Intelligence",
    "data.columnar.parquet": "High-Volume Data Analysis",
    "provider.market.catalog": "Connected Market Data",
    "provider.market.history": "Historical Market Data",
    "broker.execution.inspect": "Broker Connection",
    "modeling.artifact.inspect": "Financial Modeling",
    "local-ai.provider.inspect": "Local AI",
    "local-ai.provider.invoke": "Local AI Completion",
  };
  return labels[capability] ?? capability.split(".").slice(1).join(" ").replaceAll("_", " ");
}

export function assertP11CapabilityEntitlement(input: {
  requiredEntitlement: string | null;
  grantedEntitlements: readonly string[];
}): void {
  if (!input.requiredEntitlement) return;
  if (!input.grantedEntitlements.includes(input.requiredEntitlement)) {
    throw new Error("LiOS capability entitlement is not granted.");
  }
}

export function expandP11ManagedPackIds(packIds: readonly P11PackId[]): string[] {
  const selected = new Set(packIds);
  selected.add("lios.finance");
  const result = new Set<string>(["core"]);
  for (const pack of P11_PACK_CATALOG) {
    if (!selected.has(pack.id)) continue;
    for (const managed of pack.managedPackIds) result.add(managed);
  }
  const allowed = new Set(MANAGED_RUNTIME_MANIFEST.packs.map((pack) => pack.id));
  for (const id of result) {
    if (!allowed.has(id)) throw new Error(`P11 pack bridge references unknown managed runtime pack ${id}.`);
  }
  return [...result];
}

export const P11_CONFORMANCE_CASES = Object.freeze([
  {
    id: "black-scholes-atm-call",
    capability: "pricing.derivatives.black_scholes",
    expected: { field: "price", value: 10.450583572185565 },
    policy: { absoluteTolerance: 1e-8, relativeTolerance: 1e-8 },
    conventions: "S=100,K=100,r=5%,sigma=20%,T=1,no-dividend",
  },
  {
    id: "bond-duration-invariant",
    capability: "pricing.fixed_income.curve",
    expected: { field: "durationPositive", value: 1 },
    policy: { absoluteTolerance: 0, relativeTolerance: 0 },
    conventions: "Positive-cashflow fixed-rate bond under positive discount factors.",
  },
  {
    id: "portfolio-weight-invariant",
    capability: "portfolio.optimize.hrp",
    expected: { field: "weightSum", value: 1 },
    policy: { absoluteTolerance: 1e-8, relativeTolerance: 1e-8 },
    conventions: "Long-only normalized portfolio weights.",
  },
  {
    id: "backtest-lookahead-invariant",
    capability: "backtest.strategy.standard",
    expected: { field: "lookAheadViolations", value: 0 },
    policy: { absoluteTolerance: 0, relativeTolerance: 0 },
    conventions: "Signal on bar t executes no earlier than bar t+1.",
  },
]);

export function validateP11ConformanceScalar(
  actual: number,
  expected: number,
  policy: Partial<EngineValidationPolicy> = {},
) {
  return compareEngineScalars(actual, expected, policy);
}

export function readP11CandidateInventory(filePath: string): P11CandidateInventory {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as P11CandidateInventory;
}

export function evaluateP11Performance(input: {
  baseInstallerIncrementMb: number;
  packMetadataColdStartMs: number;
  inProcessRouteWarmMs: number;
  sidecarHandshakeMs: number;
  sidecarIdleMemoryMb: number;
}): string[] {
  const errors: string[] = [];
  if (input.baseInstallerIncrementMb > P11_PERFORMANCE_BUDGETS.baseInstallerIncrementMb) errors.push("P11 base installer increment exceeds budget.");
  if (input.packMetadataColdStartMs > P11_PERFORMANCE_BUDGETS.packMetadataColdStartMs) errors.push("P11 pack metadata cold start exceeds budget.");
  if (input.inProcessRouteWarmMs > P11_PERFORMANCE_BUDGETS.inProcessRouteWarmMs) errors.push("P11 warm routing exceeds budget.");
  if (input.sidecarHandshakeMs > P11_PERFORMANCE_BUDGETS.sidecarHandshakeMs) errors.push("P11 sidecar handshake exceeds budget.");
  if (input.sidecarIdleMemoryMb > P11_PERFORMANCE_BUDGETS.sidecarIdleMemoryMb) errors.push("P11 sidecar idle memory exceeds budget.");
  return errors;
}
