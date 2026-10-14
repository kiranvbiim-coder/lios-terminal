import { z } from "zod";

const isoDate = z.string().date();
const isoTime = z.string().datetime();
const finiteNullable = z.number().finite().nullable();

export const estimateObservationSchema = z.object({
  symbol: z.string().min(1), metric: z.enum(["eps", "revenue", "ebitda", "ebit", "fcf", "price_target", "other"]),
  fiscalPeriod: z.string().min(1), periodEnd: isoDate.nullable(), contributor: z.string().min(1),
  value: z.number().finite(), low: finiteNullable.default(null), high: finiteNullable.default(null),
  currency: z.string().min(1).nullable(), unit: z.string().min(1), publishedAt: isoTime,
  availableAt: isoTime, sourceUrl: z.string().url().nullable().default(null),
});
export const estimateActualSchema = z.object({
  metric: estimateObservationSchema.shape.metric, fiscalPeriod: z.string().min(1), periodEnd: isoDate.nullable(),
  value: z.number().finite(), reportedAt: isoTime, availableAt: isoTime,
});
export const estimatesPayloadSchema = z.object({
  symbol: z.string().min(1), observations: z.array(estimateObservationSchema).min(1),
  actuals: z.array(estimateActualSchema).default([]),
});

export const optionContractSchema = z.object({
  contractSymbol: z.string().min(1), underlying: z.string().min(1), type: z.enum(["call", "put"]),
  strike: z.number().finite().nonnegative(), expiry: isoDate, quoteAt: isoTime,
  bid: finiteNullable.default(null), ask: finiteNullable.default(null), last: finiteNullable.default(null),
  volume: finiteNullable.default(null), openInterest: finiteNullable.default(null), underlyingPrice: finiteNullable.default(null),
  impliedVolatility: finiteNullable.default(null), delta: finiteNullable.default(null), gamma: finiteNullable.default(null),
  theta: finiteNullable.default(null), vega: finiteNullable.default(null), rho: finiteNullable.default(null),
  multiplier: z.number().finite().positive().default(100), currency: z.string().min(1).default("USD"),
});
export const optionsPayloadSchema = z.object({ underlying: z.string().min(1), contracts: z.array(optionContractSchema).min(1) });

export const commodityCurvePointSchema = z.object({
  contract: z.string().min(1), deliveryStart: isoDate.nullable(), expiry: isoDate,
  observationAt: isoTime, price: z.number().finite(), settlementType: z.enum(["close", "settlement", "mid", "last"]),
  unit: z.string().min(1), currency: z.string().min(1), exchange: z.string().min(1),
  openInterest: finiteNullable.default(null), volume: finiteNullable.default(null),
});
export const commodityCurvePayloadSchema = z.object({ commodity: z.string().min(1), points: z.array(commodityCurvePointSchema).min(1) });

export const portfolioHoldingSchema = z.object({
  symbol: z.string().min(1), quantity: z.number().finite(), costBasis: finiteNullable.default(null),
  marketPrice: finiteNullable.default(null), marketValue: finiteNullable.default(null), currency: z.string().min(1),
  taxLotId: z.string().min(1).nullable().default(null), acquiredAt: isoDate.nullable().default(null),
});
export const portfolioPayloadSchema = z.object({
  portfolioId: z.string().min(1), name: z.string().min(1), asOf: isoTime, baseCurrency: z.string().min(1),
  benchmark: z.string().min(1).nullable().default(null), cash: z.number().finite(), holdings: z.array(portfolioHoldingSchema),
  mandate: z.record(z.unknown()).default({}),
});

export const privateSeriesObservationSchema = z.object({ observationAt: isoTime, value: z.number().finite(), availableAt: isoTime });
export const privateSeriesPayloadSchema = z.object({
  seriesId: z.string().min(1), name: z.string().min(1), unit: z.string().min(1), frequency: z.string().min(1),
  observations: z.array(privateSeriesObservationSchema).min(1), dimensions: z.record(z.string()).default({}),
});

export const alternativePayloadSchemas = {
  estimates: estimatesPayloadSchema,
  options_chain: optionsPayloadSchema,
  commodity_curve: commodityCurvePayloadSchema,
  portfolio_holdings: portfolioPayloadSchema,
  private_series: privateSeriesPayloadSchema,
} as const;
export type AlternativeDataClass = keyof typeof alternativePayloadSchemas;
export type AlternativePayload = z.infer<(typeof alternativePayloadSchemas)[AlternativeDataClass]>;

export const alternativeSnapshotInputSchema = z.discriminatedUnion("dataClass", [
  z.object({ dataClass: z.literal("estimates"), payload: estimatesPayloadSchema }),
  z.object({ dataClass: z.literal("options_chain"), payload: optionsPayloadSchema }),
  z.object({ dataClass: z.literal("commodity_curve"), payload: commodityCurvePayloadSchema }),
  z.object({ dataClass: z.literal("portfolio_holdings"), payload: portfolioPayloadSchema }),
  z.object({ dataClass: z.literal("private_series"), payload: privateSeriesPayloadSchema }),
]).and(z.object({
  entityKey: z.string().min(1).max(160), source: z.string().min(1), provider: z.string().min(1),
  frequency: z.string().min(1), timezone: z.string().min(1).default("UTC"), currency: z.string().nullable().default(null),
  effectiveAt: isoTime.nullable(), publishedAt: isoTime.nullable(), retrievedAt: isoTime,
  availableAt: isoTime, organizationId: z.number().int().positive().nullable().default(null),
  lineage: z.record(z.unknown()).default({}),
}));
export type AlternativeSnapshotInput = z.infer<typeof alternativeSnapshotInputSchema>;
