import { p6RuntimeCandidateSchema, type P6RuntimeCandidate } from "@shared/p6FinanceContracts";

export const P6_RUNTIME_CANDIDATES: readonly P6RuntimeCandidate[] = [
  p6RuntimeCandidateSchema.parse({
    id: "lios.backtest.core-v1",
    role: "standard_backtest",
    lifecycle: "builtin",
    bundled: true,
    license: "LiOS",
    upstreamCommit: null,
    active: true,
    notes: [
      "Canonical standard BacktestEngine for V1.",
      "Signal on bar t executes no earlier than bar t+1.",
      "Supports fees, slippage, liquidity participation, point-in-time checks, parameter sweeps, walk-forward evaluation and seeded Monte Carlo.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "backtest-kit",
    role: "standard_backtest",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "MIT",
    upstreamCommit: "599d990204cd7bfb44ba61c973cc3f742ea43861",
    active: false,
    notes: [
      "Benchmarked/donor reference behind the LiOS BacktestEngine boundary.",
      "Not allowed to own Project, Session, Artifact or credential state.",
      "Broker/live execution modules are outside P6.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "quantconnect-lean",
    role: "advanced_backtest",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "Apache-2.0",
    upstreamCommit: "985ef30ad3ac774218c5ac516b4cb0aa2655730f",
    active: false,
    notes: [
      "Optional Advanced Quant Runtime Pack only.",
      "Must normalize into the same BacktestEngine/Artifact contracts before activation.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "lse-terminal-backtest",
    role: "indicator_reference",
    lifecycle: "research_only",
    bundled: false,
    license: "MIT",
    upstreamCommit: "62c48a5ce6de37a1c115d6270dfd0eee75166d8b",
    active: false,
    notes: [
      "Used as a verified MIT donor and numerical parity reference.",
      "No LSE hosted-data right is inferred from the code license.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "brue-language",
    role: "strategy_runtime",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "MIT",
    upstreamCommit: "a846522fe8af0e11ee7739ef8b6b8a4c0f7922cb",
    active: false,
    notes: [
      "Parser/runtime/conformance donor behind LiOS strategy contracts.",
      "Standalone Brue Connect remains unverified and is not a dependency.",
      "Live broker execution is outside P6.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "skfolio",
    role: "portfolio_optimizer",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "BSD-3-Clause",
    upstreamCommit: "eb73a4cfe3136d5615a6047060705695d4462588",
    active: false,
    notes: [
      "Optional optimizer/model-evaluation runtime when it closes a measured gap beyond existing SciPy engines.",
      "Existing deterministic portfolio optimizer remains available without this pack.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "cvxpy",
    role: "portfolio_optimizer",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "Apache-2.0",
    upstreamCommit: "01992f50f3023d1325bda8aff560de2c5f2ca138",
    active: false,
    notes: [
      "Optional constrained-optimization runtime; solver licenses remain separately reviewed.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "edgartools",
    role: "filing_parser",
    lifecycle: "managed_bundled",
    bundled: true,
    license: "MIT",
    upstreamCommit: "4e817de7bf3efae44024e168754e8f5d53b1a227",
    active: true,
    notes: [
      "Pinned in the managed Python sidecar for SEC full-text/typed filing support.",
      "SEC fair-access policy remains authoritative.",
    ],
  }),
  p6RuntimeCandidateSchema.parse({
    id: "arelle",
    role: "xbrl_validator",
    lifecycle: "qualified_optional",
    bundled: false,
    license: "Apache-2.0",
    upstreamCommit: "24b6f2c1da5b7b94a267c96c06a5db49f01305e5",
    active: false,
    notes: [
      "Optional taxonomy-aware XBRL validation pack; subcomponent notices must be reviewed before bundling.",
    ],
  }),
];

export function p6RuntimeCandidate(id: string): P6RuntimeCandidate | null {
  return P6_RUNTIME_CANDIDATES.find((candidate) => candidate.id === id) ?? null;
}

export function activeP6RuntimeCandidates(): P6RuntimeCandidate[] {
  return P6_RUNTIME_CANDIDATES.filter((candidate) => candidate.active);
}

export function assertNoOptionalRuntimeLockIn(): void {
  const standard = P6_RUNTIME_CANDIDATES.filter((candidate) => candidate.role === "standard_backtest" && candidate.active);
  if (!standard.some((candidate) => candidate.id === "lios.backtest.core-v1" && candidate.lifecycle === "builtin")) {
    throw new Error("P6 must retain a built-in deterministic backtest path.");
  }
  if (P6_RUNTIME_CANDIDATES.some((candidate) =>
    (candidate.lifecycle === "qualified_optional" || candidate.lifecycle === "research_only") && candidate.bundled
  )) {
    throw new Error("Optional P6 donor runtimes must not silently become mandatory base dependencies.");
  }
}
