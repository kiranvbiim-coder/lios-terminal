import {
  calculateFactorAttribution,
  validateFactorAttributionInput,
  type FactorAttributionInput,
  type FactorAttributionResult,
  type FactorDefinition,
  type FactorProvenance,
  type FactorScenario,
  type SecurityFactorExposure,
} from "@shared/factorAttribution";

export type FactorPortfolioSourceClassification = "MANUAL" | "PRIVATE";

type RawFactorPortfolioDocument = {
  sourceClassification?: unknown;
  factors?: unknown;
  factorReturns?: unknown;
  factorReturnProvenance?: unknown;
  factorCovariance?: unknown;
  factorCovarianceProvenance?: unknown;
  securities?: unknown;
  specificVariances?: unknown;
  specificVarianceProvenance?: unknown;
  portfolioWeights?: unknown;
  portfolioWeightsProvenance?: unknown;
  benchmarkWeights?: unknown;
  benchmarkWeightsProvenance?: unknown;
  scenario?: unknown;
  brinson?: unknown;
};

export type FactorPortfolioBasket = {
  assets: readonly string[];
  weights: readonly number[];
  asOf: string;
};

export type FactorPortfolioReceipt = {
  status: "READY" | "BLOCKED";
  sourceClassification: FactorPortfolioSourceClassification | "UNKNOWN";
  source: string;
  asOf: string;
  units: string;
  errors: readonly string[];
};

export type FactorPortfolioAdapterResult = {
  input: FactorAttributionInput | null;
  receipt: FactorPortfolioReceipt;
};

export type FactorPortfolioRunResult = {
  attribution: FactorAttributionResult;
  receipt: FactorPortfolioReceipt;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function provenance(value: unknown, path: string, errors: string[]): FactorProvenance | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} is required and must declare source, asOf and units`);
    return undefined;
  }
  const result = value as unknown as FactorProvenance;
  if (!nonEmpty(result.source) || !nonEmpty(result.asOf) || !nonEmpty(result.units)) errors.push(`${path} must declare source, asOf and units`);
  return result;
}

function parseWeights(value: unknown, ids: readonly string[], path: string, errors: string[]): Record<string, number> | undefined {
  if (Array.isArray(value)) {
    if (value.length !== ids.length || value.some((item) => !finite(item))) {
      errors.push(`${path} array must contain one finite value per security`);
      return undefined;
    }
    return Object.fromEntries(ids.map((id, index) => [id, value[index]]));
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} is required as a security-keyed object or ordered array`);
    return undefined;
  }
  return value as Record<string, number>;
}

function parseDocument(text: string, errors: string[]): RawFactorPortfolioDocument | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      errors.push("factor attribution import must be a JSON object");
      return undefined;
    }
    return parsed as RawFactorPortfolioDocument;
  } catch (error) {
    errors.push(`invalid JSON: ${error instanceof Error ? error.message : "parse failed"}`);
    return undefined;
  }
}

/**
 * Converts the explicit manual/private import into the shared engine contract.
 * Factor loadings, factor returns, covariance, and specific variances are never
 * inferred from labels or basket history. Basket weights are the sole fallback
 * because they are real optimizer output supplied by the caller.
 */
export function adaptFactorPortfolioJson(text: string, basket?: FactorPortfolioBasket): FactorPortfolioAdapterResult {
  const errors: string[] = [];
  const document = parseDocument(text, errors);
  const sourceClassification = document?.sourceClassification;
  if (sourceClassification !== "MANUAL" && sourceClassification !== "PRIVATE") errors.push("sourceClassification must be MANUAL or PRIVATE");
  if (!document) return { input: null, receipt: { status: "BLOCKED", sourceClassification: "UNKNOWN", source: "", asOf: "", units: "", errors } };

  const factors = Array.isArray(document.factors) ? document.factors as FactorDefinition[] : [];
  const securities = Array.isArray(document.securities) ? document.securities as SecurityFactorExposure[] : [];
  if (factors.length === 0) errors.push("factors must contain at least one explicit factor definition");
  if (securities.length === 0) errors.push("securities must contain at least one explicit factor exposure row");
  const safeRows = factors.every((factor) => factor !== null && typeof factor === "object" && !Array.isArray(factor))
    && securities.every((security) => security !== null && typeof security === "object" && !Array.isArray(security));
  if (!safeRows) errors.push("factors and securities must contain object rows");
  const factorReturnProvenance = document.factorReturnProvenance !== null && typeof document.factorReturnProvenance === "object" && !Array.isArray(document.factorReturnProvenance)
    ? document.factorReturnProvenance as Record<string, FactorProvenance>
    : undefined;
  const factorCovarianceProvenance = provenance(document.factorCovarianceProvenance, "factorCovarianceProvenance", errors);
  const specificVarianceProvenance = provenance(document.specificVarianceProvenance, "specificVarianceProvenance", errors);

  for (const factor of factors) provenance(factor, `factor ${factor?.id ?? "?"}`, errors);
  for (const security of securities) provenance(security, `security ${security?.securityId ?? "?"}`, errors);
  for (const factor of factors) {
    const factorId = factor?.id;
    if (!factorId) continue;
    if (factorReturnProvenance) provenance(factorReturnProvenance[factorId], `factorReturnProvenance ${factorId}`, errors);
    else errors.push(`factorReturnProvenance ${factorId} is required for map-form factor returns`);
  }
  const securityIds = securities.map((security) => security?.securityId ?? "");
  const explicitSpecificVariances = document.specificVariances !== null && typeof document.specificVariances === "object" && !Array.isArray(document.specificVariances)
    ? document.specificVariances as Record<string, number>
    : undefined;
  if (!explicitSpecificVariances) errors.push("specificVariances is required; specific risk cannot be inferred");
  else {
    for (const id of securityIds) if (!Object.prototype.hasOwnProperty.call(explicitSpecificVariances, id)) errors.push(`specificVariances is missing ${id}`);
    for (const [id, value] of Object.entries(explicitSpecificVariances)) if (!securityIds.includes(id)) errors.push(`specificVariances contains unknown security ${id}`);
    if (Object.values(explicitSpecificVariances).some((value) => !finite(value) || value < 0)) errors.push("specificVariances must contain finite non-negative values");
  }

  const portfolioWeights = (document.portfolioWeights === undefined ? undefined : parseWeights(document.portfolioWeights, securityIds, "portfolioWeights", errors))
    ?? (basket && securityIds.length === basket.assets.length && securityIds.every((id, index) => id === basket.assets[index])
      ? Object.fromEntries(securityIds.map((id, index) => [id, basket.weights[index]]))
      : undefined);
  const portfolioWeightsProvenance = document.portfolioWeights === undefined && portfolioWeights && basket
    ? { source: "live-portfolio-optimizer-basket", asOf: basket.asOf, status: "derived" as const, units: "weight" }
    : provenance(document.portfolioWeightsProvenance, "portfolioWeightsProvenance", errors);
  if (!portfolioWeights) errors.push("portfolioWeights are required, or securities must exactly match the live basket for weight reuse");

  const benchmarkWeights = document.benchmarkWeights === undefined ? undefined : parseWeights(document.benchmarkWeights, securityIds, "benchmarkWeights", errors);
  const benchmarkWeightsProvenance = benchmarkWeights ? provenance(document.benchmarkWeightsProvenance, "benchmarkWeightsProvenance", errors) : undefined;
  const factorReturns = document.factorReturns as FactorAttributionInput["factorReturns"];
  if (factorReturns === undefined || factorReturns === null || (typeof factorReturns !== "object")) errors.push("factorReturns are required and must be explicit");
  if (!Array.isArray(document.factorCovariance)) errors.push("factorCovariance is required and must be an explicit matrix");

  const input: FactorAttributionInput = {
    factors,
    factorReturns,
    factorReturnProvenance,
    factorCovariance: (document.factorCovariance ?? []) as number[][],
    factorCovarianceProvenance,
    securities,
    portfolioWeights: portfolioWeights ?? {},
    portfolioWeightsProvenance,
    specificVariances: explicitSpecificVariances,
    specificVarianceProvenance,
    benchmarkWeights,
    benchmarkWeightsProvenance,
    scenario: document.scenario as FactorScenario | undefined,
    brinson: document.brinson as FactorAttributionInput["brinson"],
  };
  if (safeRows && Array.isArray(document.factorCovariance) && document.factorCovariance.every((row) => Array.isArray(row))) {
    const validation = validateFactorAttributionInput(input);
    errors.push(...validation.errors);
  }
  const source = factorCovarianceProvenance?.source ?? factors[0]?.source ?? "";
  const asOf = factorCovarianceProvenance?.asOf ?? factors.map((factor) => factor?.asOf).filter(Boolean).sort().at(-1) ?? "";
  const units = factorCovarianceProvenance?.units ?? factors[0]?.units ?? "";
  const receipt: FactorPortfolioReceipt = { status: errors.length === 0 ? "READY" : "BLOCKED", sourceClassification: sourceClassification === "MANUAL" || sourceClassification === "PRIVATE" ? sourceClassification : "UNKNOWN", source, asOf, units, errors };
  return { input: errors.length === 0 ? input : null, receipt };
}

export function runFactorPortfolioJson(text: string, basket?: FactorPortfolioBasket): FactorPortfolioRunResult | FactorPortfolioAdapterResult {
  const adapted = adaptFactorPortfolioJson(text, basket);
  if (!adapted.input) return adapted;
  return { attribution: calculateFactorAttribution(adapted.input), receipt: adapted.receipt };
}
