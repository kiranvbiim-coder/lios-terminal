import type { QuantModelRegistryEntry } from "@shared/quantModelRegistry";
import { QUANT_MODEL_REGISTRY as BASE_QUANT_MODEL_REGISTRY } from "./quantModelRegistryBase";
import { ADVANCED_QUANT_REGISTRY } from "./advancedQuantRegistry";
import { ADVANCED_QUANT_DEPTH2_REGISTRY } from "./advancedQuantRegistryDepth2";

export {
  KNOWN_STOCHASTIC_OR_SYNTHETIC_SOURCES,
  QUANT_ANALYTICAL_SURFACES,
  QUANT_DATA_PROVIDER_SOURCES,
} from "./quantModelRegistryBase";

export const QUANT_MODEL_REGISTRY: QuantModelRegistryEntry[] = [
  ...BASE_QUANT_MODEL_REGISTRY,
  ...ADVANCED_QUANT_REGISTRY,
  ...ADVANCED_QUANT_DEPTH2_REGISTRY,
  {
    id: "typescript.decision-analysis", label: "Original Decision Tournament And Thesis Stress", category: "decision_intelligence",
    program: "financial_modelling", engine: "typescript", status: "implemented", validationLevel: "benchmark_required",
    determinism: "deterministic", dataMode: "user_supplied", version: "1.0.0", apiEndpoint: "/api/decision-analysis",
    surfaces: ["Decision Engine"], components: ["runModelTournament", "stressThesis", "findDecisionBoundary"],
    sourceFiles: ["server/decisionEngine.ts", "server/decisionRoutes.ts"], references: [],
    limitations: ["Manual decision inputs and ordinal quality scores are not verified source quality or approval authority."],
    nextValidation: "Independent scenario, confidence and boundary qualification; no terminal retention promotes numerical assurance.",
  },
  {
    id: "typescript.decision-reverse-dcf", label: "Original Decision Reverse DCF", category: "valuation",
    program: "financial_modelling", engine: "typescript", status: "implemented", validationLevel: "benchmark_required",
    determinism: "deterministic", dataMode: "user_supplied", version: "1.0.0", apiEndpoint: "/api/decision-analysis/reverse-dcf",
    surfaces: ["Decision Engine"], components: ["calculateReverseDcf"], sourceFiles: ["server/decisionEngine.ts", "server/decisionRoutes.ts"], references: [],
    limitations: ["Manual FCFF-growth solve is distinct from the advanced operating-model revenue-growth solver."],
    nextValidation: "Independent valuation reconciliation across boundary and growth/discount conventions.",
  },
  {
    id: "factor-risk-model",
    label: "Provider-backed factor risk model",
    category: "risk",
    program: "shared_foundation",
    engine: "typescript",
    status: "validated",
    validationLevel: "known_answer",
    determinism: "provider_dependent",
    // The inputs are captured from providers; factor exposures, returns,
    // covariance and attribution are deterministic derived-from-provider data.
    dataMode: "live_provider",
    version: "1.0.0",
    apiEndpoint: "/api/factor-risk/snapshots",
    surfaces: ["Advanced Risk", "Quant Workbench"],
    components: ["buildFactorExposures", "estimateFactorReturns", "calculateFactorAttribution"],
    sourceFiles: ["server/factorRiskModel.ts", "server/factorRiskRoutes.ts", "shared/factorExposureModel.ts", "shared/factorReturnEstimation.ts", "shared/factorAttribution.ts"],
    references: [
      { label: "Fama-French, 1993", url: "https://doi.org/10.1016/0304-405X(93)90023-5" },
    ],
    limitations: [
      "Known-answer coverage exercises the pure exposure and factor-return foundations; provider integration remains provider-dependent.",
      "Current/as-of fundamentals are applied as static exposures across historical periods because point-in-time fundamentals are not available from all providers.",
      "The benchmark must have usable provider history (default ^GSPC is accepted only when its capture succeeds); no synthetic equal-weight benchmark is constructed.",
      "History is bounded by the requested provider window and overlapping monthly observations; missing or insufficient security history is explicitly excluded.",
      "Outputs derived from provider observations are marked derived and retain source metadata; they must not be represented as live observations.",
    ],
    nextValidation: "Add provider-fixture replay and benchmark/history coverage tests for each configured market-data provider.",
  },
];

export const QUANT_COMPUTE_ENDPOINTS = QUANT_MODEL_REGISTRY
  .filter((entry) => entry.engine === "python_sidecar")
  .flatMap((entry) => entry.apiEndpoint ? [entry.apiEndpoint] : []);

export function summarizeQuantRegistry(entries: QuantModelRegistryEntry[] = QUANT_MODEL_REGISTRY) {
  const countBy = (key: "status" | "validationLevel" | "category" | "program") => entries.reduce<Record<string, number>>((acc, entry) => {
    acc[entry[key]] = (acc[entry[key]] ?? 0) + 1;
    return acc;
  }, {});
  return {
    total: entries.length,
    byStatus: countBy("status"),
    byValidation: countBy("validationLevel"),
    byCategory: countBy("category"),
    byProgram: countBy("program"),
    limitationsOpen: entries.filter((entry) => entry.limitations.length > 0).length,
  };
}
