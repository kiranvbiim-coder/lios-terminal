import { z } from "zod";
import { portfolioArtifactContentSchema } from "./artifactContracts";
import { portfolioPayloadSchema } from "./pointInTimeAlternativeData";

export type PortfolioMaterialityPayload = z.infer<typeof portfolioPayloadSchema>;

export const p9PortfolioMaterialityActionSchema = z.object({
  kind: z.literal("portfolio_materiality"),
  acceptedArtifact: z.object({
    artifactId: z.string().regex(/^artifact:[0-9a-f-]{36}$/i),
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  weightChangePercentagePoints: z.number().finite().positive().max(100),
  concentrationPercent: z.number().finite().positive().max(100),
  rearmBufferPercentagePoints: z.number().finite().positive().max(100),
  maximumAgeMinutes: z.number().int().min(1).max(10_080),
}).strict();
export type P9PortfolioMaterialityAction = z.infer<typeof p9PortfolioMaterialityActionSchema>;

export function validatePortfolioMaterialityThresholds(action: P9PortfolioMaterialityAction): void {
  if (action.rearmBufferPercentagePoints >= Math.min(action.weightChangePercentagePoints, action.concentrationPercent)) {
    throw new Error("Re-arm buffer must be smaller than both materiality thresholds.");
  }
}

/** Summary owns metadata; only the Artifact's canonical holdings array supplies positions. */
export function portfolioMaterialityPayload(content: unknown) {
  const artifact = portfolioArtifactContentSchema.parse(content);
  const payload = portfolioPayloadSchema.parse({ ...artifact.summary, holdings: artifact.holdings });
  if (payload.holdings.length === 0) throw new Error("Portfolio monitoring requires explicit holdings.");
  if (payload.baseCurrency !== payload.baseCurrency.trim().toUpperCase()) throw new Error("Portfolio base currency must be normalized uppercase.");
  for (const holding of payload.holdings) {
    if (holding.marketValue === null) throw new Error("Every holding requires an explicit finite marketValue; prices and FX are never invented.");
    if (holding.currency !== payload.baseCurrency) throw new Error("Portfolio monitoring requires one common currency; no FX conversion is performed.");
    if (holding.symbol !== holding.symbol.trim() || !holding.symbol.trim()) throw new Error("Portfolio symbols must be nonempty and trimmed.");
  }
  return { artifact, payload };
}

const positionSchema = z.object({ symbol: z.string(), grossMarketValue: z.number().finite().nonnegative(), weightPercent: z.number().finite().min(0).max(100) }).strict();
const stateSchema = z.object({ symbol: z.string(), concentration: z.enum(["active", "breached", "acknowledged"]), weightChange: z.enum(["active", "breached", "acknowledged"]) }).strict();
export const p9PortfolioMaterialityOutputSchema = z.object({
  kind: z.literal("portfolio_materiality"),
  actionHash: z.string(),
  mode: z.literal("read_only"),
  units: z.literal("percent_of_gross_securities_exposure_cash_excluded"),
  acceptedArtifact: p9PortfolioMaterialityActionSchema.shape.acceptedArtifact,
  currentArtifact: p9PortfolioMaterialityActionSchema.shape.acceptedArtifact,
  portfolioId: z.string(),
  asOf: z.string().datetime(),
  baseCurrency: z.string(),
  cashExcluded: z.number().finite(),
  grossExposure: z.number().finite().positive(),
  positions: z.array(positionSchema),
  states: z.array(stateSchema),
  transitions: z.array(z.object({ symbol: z.string(), metric: z.enum(["concentration", "weight_change"]), transition: z.enum(["breached", "recovered"]), currentPercent: z.number().finite(), baselinePercent: z.number().finite(), threshold: z.number().finite() }).strict()),
  maximumWeightChangePercentagePoints: z.number().finite().nonnegative(),
  maximumConcentrationPercent: z.number().finite().min(0).max(100),
  baselineEstablished: z.boolean(),
}).strict();
export type P9PortfolioMaterialityOutput = z.infer<typeof p9PortfolioMaterialityOutputSchema>;
