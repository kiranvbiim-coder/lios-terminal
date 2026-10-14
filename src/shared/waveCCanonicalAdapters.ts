/**
 * Wave C canonical-data adapters.
 *
 * The existing product still accepts a few symbol-shaped legacy payloads.  A
 * Wave C adapter makes that boundary explicit: it normalizes field names,
 * preserves the caller's source/provenance, and marks unresolved rows as
 * partial instead of manufacturing a LiOS identity from a ticker or name.
 */
import { z } from "zod";
import { getCanonicalField } from "./dataFieldDictionary";

export const WAVE_C_ADAPTER_FAMILIES = [
  "portfolio",
  "valuation",
  "fixed_income",
  "derivatives",
  "macro",
] as const;
export type WaveCCanonicalFamily = (typeof WAVE_C_ADAPTER_FAMILIES)[number];

const canonicalIdSchema = z.string().trim().regex(
  /^lios:(?:entity|security|listing|instrument):[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
  "canonical IDs must be durable lios:<kind>:<persisted-id> references",
);

export const canonicalIdentitySchema = z.object({
  entityId: canonicalIdSchema.nullable().optional(),
  securityId: canonicalIdSchema.nullable().optional(),
  listingId: canonicalIdSchema.nullable().optional(),
  instrumentId: canonicalIdSchema.nullable().optional(),
}).strict();
export type CanonicalIdentity = z.infer<typeof canonicalIdentitySchema>;

const provenanceSchema = z.object({
  source: z.string().trim().min(1).max(160),
  provider: z.string().trim().min(1).max(160).nullable().optional(),
  snapshotId: z.string().uuid().nullable().optional(),
  availableAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict();
export type CanonicalProvenance = z.infer<typeof provenanceSchema>;

const commonInput = z.object({
  identity: canonicalIdentitySchema.optional(),
  provenance: provenanceSchema.optional(),
}).strict();

export const portfolioPositionInputSchema = commonInput.extend({
  symbol: z.string().trim().min(1).max(80),
  shares: z.number().finite().positive(),
  avgCost: z.number().finite().nonnegative().optional(),
  weight: z.number().finite().nonnegative().optional(),
  assetClass: z.string().trim().min(1).max(80).optional(),
  sector: z.string().trim().min(1).max(120).optional(),
}).strict();

export const valuationContextInputSchema = commonInput.extend({
  symbol: z.string().trim().min(1).max(80),
  datasetSnapshotId: z.string().uuid(),
  assumptions: z.record(z.string(), z.number().finite()).optional(),
}).strict();

export const fixedIncomeInputSchema = commonInput.extend({
  issuer: z.string().trim().min(1).max(240),
  coupon: z.number().finite(),
  maturity: z.string().date(),
  faceValue: z.number().finite().positive(),
  price: z.number().finite().nonnegative().optional(),
  yieldToMaturity: z.number().finite().optional(),
  dayCount: z.string().trim().min(1).max(40).optional(),
  frequency: z.number().int().positive().max(52).optional(),
  rating: z.string().trim().min(1).max(20).optional(),
  seniority: z.string().trim().min(1).max(60).optional(),
}).strict();

export const derivativeInputSchema = commonInput.extend({
  underlying: z.string().trim().min(1).max(80),
  instrumentType: z.enum(["option", "future", "swap"]),
  expiry: z.string().date(),
  strike: z.number().finite().nonnegative().optional(),
  optionType: z.enum(["call", "put"]).optional(),
  impliedVolatility: z.number().finite().nonnegative().optional(),
  spotPrice: z.number().finite().nonnegative().optional(),
  riskFreeRate: z.number().finite().optional(),
  dividendYield: z.number().finite().optional(),
}).strict();

export const macroObservationInputSchema = commonInput.extend({
  country: z.string().trim().min(2).max(3).transform((value) => value.toUpperCase()),
  indicator: z.string().trim().min(1).max(120),
  value: z.number().finite(),
  date: z.string().date(),
  frequency: z.string().trim().min(1).max(40).optional(),
  unit: z.string().trim().min(1).max(80).optional(),
  source: z.string().trim().min(1).max(160).optional(),
  vintage: z.string().date().optional(),
}).strict();

export type PortfolioPositionInput = z.infer<typeof portfolioPositionInputSchema>;
export type ValuationContextInput = z.infer<typeof valuationContextInputSchema>;
export type FixedIncomeInput = z.infer<typeof fixedIncomeInputSchema>;
export type DerivativeInput = z.infer<typeof derivativeInputSchema>;
export type MacroObservationInput = z.infer<typeof macroObservationInputSchema>;

export interface CanonicalAdapterResult<T extends Record<string, unknown>> {
  family: WaveCCanonicalFamily;
  canonical: boolean;
  identity: CanonicalIdentity;
  fields: string[];
  record: T;
  provenance: CanonicalProvenance;
  warnings: string[];
}

function identityFrom(input: { identity?: CanonicalIdentity }): CanonicalIdentity {
  return input.identity ?? {};
}

function hasDurableIdentity(identity: CanonicalIdentity): boolean {
  return Boolean(identity.entityId || identity.securityId || identity.listingId || identity.instrumentId);
}

function provenanceFrom(input: { provenance?: CanonicalProvenance }, family: string): CanonicalProvenance {
  return input.provenance ?? { source: `wave-c:${family}:legacy-adapter`, provider: null, snapshotId: null, availableAt: null };
}

function canonicalFields(family: WaveCCanonicalFamily, record: Record<string, unknown>): string[] {
  const contractFamily = family === "valuation" ? "financial_statements" : family;
  return Object.keys(record)
    .map((field) => `${contractFamily}.${field}`)
    .filter((fieldId) => Boolean(getCanonicalField(fieldId)));
}

function finish<T extends Record<string, unknown>>(
  family: WaveCCanonicalFamily,
  input: { identity?: CanonicalIdentity; provenance?: CanonicalProvenance },
  record: T,
): CanonicalAdapterResult<T> {
  const identity = identityFrom(input);
  const canonical = hasDurableIdentity(identity);
  const warnings = canonical
    ? []
    : ["No durable LiOS identity was supplied; the legacy reference is preserved and no canonical ID was invented."];
  return { family, canonical, identity, fields: canonicalFields(family, record), record, provenance: provenanceFrom(input, family), warnings };
}

export function adaptPortfolioPosition(input: PortfolioPositionInput): CanonicalAdapterResult<Record<string, unknown>> {
  const { identity, provenance, ...record } = portfolioPositionInputSchema.parse(input);
  const normalized = {
    symbol: record.symbol.toUpperCase(),
    shares: record.shares,
    ...(record.avgCost !== undefined ? { costBasis: record.avgCost } : {}),
    ...(record.weight !== undefined ? { weight: record.weight } : {}),
    ...(record.assetClass !== undefined ? { assetClass: record.assetClass } : {}),
    ...(record.sector !== undefined ? { sector: record.sector } : {}),
  };
  return finish("portfolio", { identity, provenance }, normalized);
}

export function adaptValuationContext(input: ValuationContextInput): CanonicalAdapterResult<Record<string, unknown>> {
  const { identity, provenance, ...record } = valuationContextInputSchema.parse(input);
  return finish("valuation", { identity, provenance }, { ...record, symbol: record.symbol.toUpperCase() });
}

export function adaptFixedIncomeInstrument(input: FixedIncomeInput): CanonicalAdapterResult<Record<string, unknown>> {
  const { identity, provenance, ...record } = fixedIncomeInputSchema.parse(input);
  return finish("fixed_income", { identity, provenance }, record);
}

export function adaptDerivativeInstrument(input: DerivativeInput): CanonicalAdapterResult<Record<string, unknown>> {
  const { identity, provenance, ...record } = derivativeInputSchema.parse(input);
  return finish("derivatives", { identity, provenance }, { ...record, underlying: record.underlying.toUpperCase() });
}

export function adaptMacroObservation(input: MacroObservationInput): CanonicalAdapterResult<Record<string, unknown>> {
  const { identity, provenance, ...record } = macroObservationInputSchema.parse(input);
  return finish("macro", { identity, provenance }, record);
}

export const waveCCanonicalAdapterSchemas = {
  portfolio: portfolioPositionInputSchema,
  valuation: valuationContextInputSchema,
  fixed_income: fixedIncomeInputSchema,
  derivatives: derivativeInputSchema,
  macro: macroObservationInputSchema,
} as const;

export function adaptWaveCCanonicalRecord(
  family: WaveCCanonicalFamily,
  input: unknown,
): CanonicalAdapterResult<Record<string, unknown>> {
  switch (family) {
    case "portfolio": return adaptPortfolioPosition(portfolioPositionInputSchema.parse(input));
    case "valuation": return adaptValuationContext(valuationContextInputSchema.parse(input));
    case "fixed_income": return adaptFixedIncomeInstrument(fixedIncomeInputSchema.parse(input));
    case "derivatives": return adaptDerivativeInstrument(derivativeInputSchema.parse(input));
    case "macro": return adaptMacroObservation(macroObservationInputSchema.parse(input));
  }
}
