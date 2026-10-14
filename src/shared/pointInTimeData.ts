import { z } from "zod";
import { CANONICAL_KEYS } from "./financialFields";

export const statementTypeSchema = z.enum(["income", "balance", "cashflow"]);

const isoCurrencySchema = z.string().regex(/^[A-Z]{3}$/, "currency must be an ISO 4217 code");

const canonicalStatementRecordSchema = (statementType: keyof typeof CANONICAL_KEYS) => z.record(z.number().finite()).superRefine((record, context) => {
  for (const key of Object.keys(record)) {
    if (!CANONICAL_KEYS[statementType].has(key)) {
      context.addIssue({ code: "custom", path: [key], message: `unknown ${statementType} field; use a canonical financial key` });
    }
  }
});

export const canonicalFinancialPeriodSchema = z.object({
  fiscalYear: z.string().min(1),
  period: z.string().min(1),
  periodEnd: z.string().date(),
  filingDate: z.string().date().nullable(),
  availableAt: z.string().datetime(),
  currency: isoCurrencySchema,
  income: canonicalStatementRecordSchema("income"),
  balance: canonicalStatementRecordSchema("balance"),
  cashflow: canonicalStatementRecordSchema("cashflow"),
  segments: z.record(z.number().finite()).default({}),
  geographies: z.record(z.number().finite()).default({}),
  sources: z.array(z.object({ statementType: statementTypeSchema, provider: z.string().min(1) })),
});

export const datasetQualitySchema = z.object({
  score: z.number().min(0).max(1),
  statementCoverage: z.object({ income: z.number().int().nonnegative(), balance: z.number().int().nonnegative(), cashflow: z.number().int().nonnegative() }),
  criticalFieldsPresent: z.number().int().nonnegative(),
  criticalFieldsExpected: z.number().int().positive(),
  missingCriticalFields: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const financialDatasetPayloadSchema = z.object({
  symbol: z.string().min(1),
  periods: z.array(canonicalFinancialPeriodSchema).min(1),
});

export const pointInTimeDatasetSnapshotSchema = z.object({
  id: z.string().uuid(),
  datasetKey: z.string().min(1),
  entityKey: z.string().min(1),
  dataClass: z.string().min(1),
  schemaVersion: z.string().min(1),
  source: z.string().min(1),
  provider: z.string().min(1),
  frequency: z.string().min(1),
  currency: z.string().nullable(),
  timezone: z.string().min(1),
  observationStart: z.string().date().nullable(),
  observationEnd: z.string().date().nullable(),
  effectiveAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(),
  availableAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  parentSnapshotId: z.string().uuid().nullable(),
  entitlementPolicyId: z.string().nullable().optional().transform((value) => value ?? null),
  quality: datasetQualitySchema,
  lineage: z.record(z.unknown()),
  payload: financialDatasetPayloadSchema,
  createdByUserId: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
});

export type CanonicalFinancialPeriod = z.infer<typeof canonicalFinancialPeriodSchema>;
export type DatasetQuality = z.infer<typeof datasetQualitySchema>;
export type FinancialDatasetPayload = z.infer<typeof financialDatasetPayloadSchema>;
export type PointInTimeDatasetSnapshot = z.infer<typeof pointInTimeDatasetSnapshotSchema>;

export type FinancialFieldRevision = {
  fiscalYear: string;
  period: string;
  statementType: "income" | "balance" | "cashflow";
  field: string;
  before: number | null;
  after: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  material: boolean;
};

export type FinancialDatasetRevisionReport = {
  snapshotId: string;
  parentSnapshotId: string | null;
  status: "initial" | "unchanged" | "revised";
  changedFields: number;
  materialChanges: number;
  addedPeriods: string[];
  removedPeriods: string[];
  revisions: FinancialFieldRevision[];
};

export const corporateActionSchema = z.object({
  type: z.enum(["cash_dividend", "stock_split", "bonus_issue"]),
  effectiveDate: z.string().date(),
  declarationDate: z.string().date().nullable(),
  recordDate: z.string().date().nullable(),
  paymentDate: z.string().date().nullable(),
  cashAmount: z.number().finite().nonnegative().nullable(),
  currency: z.string().min(1).nullable(),
  splitFrom: z.number().positive().nullable(),
  splitTo: z.number().positive().nullable(),
  adjustmentFactor: z.number().positive().nullable(),
  source: z.string().min(1),
});

export const canonicalMarketBarSchema = z.object({
  date: z.string().date(),
  open: z.number().finite().nonnegative(),
  high: z.number().finite().nonnegative(),
  low: z.number().finite().nonnegative(),
  close: z.number().finite().nonnegative(),
  volume: z.number().finite().nonnegative(),
  priceReturn: z.number().finite().nullable(),
  logReturn: z.number().finite().nullable(),
  totalReturn: z.number().finite().nullable(),
});

export const marketDatasetQualitySchema = z.object({
  score: z.number().min(0).max(1),
  barCount: z.number().int().nonnegative(),
  actionCount: z.number().int().nonnegative(),
  duplicateDates: z.number().int().nonnegative(),
  invalidBars: z.number().int().nonnegative(),
  missingSessions: z.number().int().nonnegative(),
  returnCoverage: z.number().min(0).max(1),
  warnings: z.array(z.string()),
});

export const marketDatasetPayloadSchema = z.object({
  symbol: z.string().min(1),
  assetClass: z.enum(["equity", "etf", "index", "commodity", "crypto", "fx", "unknown"]).optional(),
  baseCurrency: z.string().min(3).max(8).nullable().optional(),
  quoteCurrency: z.string().min(3).max(8).nullable().optional(),
  interval: z.literal("1d"),
  calendar: z.string().min(1),
  timezone: z.string().min(1),
  currency: z.string().min(1),
  priceBasis: z.enum(["raw", "vendor_adjusted", "unknown"]),
  bars: z.array(canonicalMarketBarSchema).min(1),
  corporateActions: z.array(corporateActionSchema),
});

export const pointInTimeMarketSnapshotSchema = z.object({
  id: z.string().uuid(), datasetKey: z.string().min(1), entityKey: z.string().min(1),
  dataClass: z.literal("market_series"), schemaVersion: z.string().min(1), source: z.string().min(1),
  provider: z.string().min(1), frequency: z.literal("daily"), currency: z.string().min(1),
  timezone: z.string().min(1), observationStart: z.string().date(), observationEnd: z.string().date(),
  effectiveAt: z.string().datetime(), publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(), availableAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), parentSnapshotId: z.string().uuid().nullable(),
  quality: marketDatasetQualitySchema, lineage: z.record(z.unknown()), payload: marketDatasetPayloadSchema,
  createdByUserId: z.number().int().positive().nullable(), createdAt: z.string().datetime(),
});

export type CorporateAction = z.infer<typeof corporateActionSchema>;
export type CanonicalMarketBar = z.infer<typeof canonicalMarketBarSchema>;
export type MarketDatasetQuality = z.infer<typeof marketDatasetQualitySchema>;
export type MarketDatasetPayload = z.infer<typeof marketDatasetPayloadSchema>;
export type PointInTimeMarketSnapshot = z.infer<typeof pointInTimeMarketSnapshotSchema>;

export type MarketSeriesRevision = {
  date: string;
  field: "open" | "high" | "low" | "close" | "volume";
  before: number | null;
  after: number | null;
  absoluteChange: number | null;
  percentChange: number | null;
  material: boolean;
};

export type MarketDatasetRevisionReport = {
  snapshotId: string;
  parentSnapshotId: string | null;
  status: "initial" | "unchanged" | "revised";
  changedObservations: number;
  materialChanges: number;
  addedDates: string[];
  removedDates: string[];
  actionChanges: number;
  revisions: MarketSeriesRevision[];
};

export const vintageObservationSchema = z.object({
  date: z.string().date(), value: z.number().finite(), realtimeStart: z.string().date().nullable(),
  realtimeEnd: z.string().date().nullable(), availableAt: z.string().datetime(),
});

export const scalarSeriesPayloadSchema = z.object({
  seriesId: z.string().min(1), name: z.string().min(1), unit: z.string(), category: z.string(),
  provider: z.string().min(1), frequency: z.string().min(1), observations: z.array(vintageObservationSchema).min(1),
});

export const yieldCurvePointSchema = z.object({
  label: z.string().min(1), seriesId: z.string().min(1), maturityYears: z.number().positive(),
  yield: z.number().finite().nullable(), observationDate: z.string().date().nullable(),
  realtimeStart: z.string().date().nullable(),
});

export const yieldCurvePayloadSchema = z.object({
  curveId: z.literal("UST_NOMINAL"), currency: z.literal("USD"), unit: z.literal("percent"),
  curveDate: z.string().date(), provider: z.literal("fred"), points: z.array(yieldCurvePointSchema).length(11),
});

export const economicDatasetQualitySchema = z.object({
  score: z.number().min(0).max(1), observationCount: z.number().int().nonnegative(),
  validObservationCount: z.number().int().nonnegative(), missingValues: z.number().int().nonnegative(),
  vintageCoverage: z.number().min(0).max(1), warnings: z.array(z.string()),
});

const economicSnapshotBaseSchema = z.object({
  id: z.string().uuid(), datasetKey: z.string().min(1), entityKey: z.string().min(1),
  schemaVersion: z.string().min(1), source: z.string().min(1), provider: z.string().min(1),
  frequency: z.string().min(1), currency: z.string().nullable(), timezone: z.string().min(1),
  observationStart: z.string().date(), observationEnd: z.string().date(), effectiveAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(), retrievedAt: z.string().datetime(), availableAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), parentSnapshotId: z.string().uuid().nullable(),
  entitlementPolicyId: z.string().nullable().optional().transform((value) => value ?? null),
  quality: economicDatasetQualitySchema, lineage: z.record(z.unknown()), createdByUserId: z.number().int().positive().nullable(),
  createdAt: z.string().datetime(),
});

export const pointInTimeScalarSeriesSnapshotSchema = economicSnapshotBaseSchema.extend({
  dataClass: z.literal("economic_series"), payload: scalarSeriesPayloadSchema,
});

export const pointInTimeYieldCurveSnapshotSchema = economicSnapshotBaseSchema.extend({
  dataClass: z.literal("yield_curve"), payload: yieldCurvePayloadSchema,
});

export type VintageObservation = z.infer<typeof vintageObservationSchema>;
export type ScalarSeriesPayload = z.infer<typeof scalarSeriesPayloadSchema>;
export type YieldCurvePayload = z.infer<typeof yieldCurvePayloadSchema>;
export type EconomicDatasetQuality = z.infer<typeof economicDatasetQualitySchema>;
export type PointInTimeScalarSeriesSnapshot = z.infer<typeof pointInTimeScalarSeriesSnapshotSchema>;
export type PointInTimeYieldCurveSnapshot = z.infer<typeof pointInTimeYieldCurveSnapshotSchema>;

// Canonical, point-in-time record of what capabilityBroker.ts's
// financial_statements resolution concluded on a given retrieval: which
// provider was authoritative, which providers actually answered, and
// which fields those providers disagreed on. Complements (does not
// replace) the single-winner "financial_statements" dataClass above --
// that one is what the terminal displays; this one is what the
// Data Conflict Detector reads, and both dedup/revision-chain through the
// same content-hash + parentSnapshotId mechanism.
export const financialStatementsConflictValueSchema = z.object({
  providerId: z.string().min(1),
  value: z.unknown(),
});

export const financialStatementsConflictSchema = z.object({
  key: z.string(),
  field: z.string().min(1),
  values: z.array(financialStatementsConflictValueSchema).min(2),
  material: z.boolean().optional(),
});

export const financialStatementsConflictPayloadSchema = z.object({
  symbol: z.string().min(1),
  reportType: z.string().min(1),
  period: z.string().min(1),
  authoritativeProviderId: z.string().min(1).nullable(),
  // Added after this dataClass first shipped -- a row persisted before
  // this field existed has no key here at all (not even `null`), so this
  // must tolerate `undefined`, not just `null`, to stay readable.
  authoritativeReason: z.string().nullable().optional().transform((value) => value ?? null),
  observationProviderIds: z.array(z.string().min(1)),
  attemptedProviders: z.array(z.string().min(1)),
  failedProviders: z.array(z.string().min(1)),
  conflicts: z.array(financialStatementsConflictSchema),
});

export const financialStatementsConflictQualitySchema = z.object({
  score: z.number().min(0).max(1),
  providersAttempted: z.number().int().nonnegative(),
  providersAnswered: z.number().int().nonnegative(),
  providersFailed: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  warnings: z.array(z.string()),
});

export const pointInTimeFinancialStatementsConflictSnapshotSchema = z.object({
  id: z.string().uuid(), datasetKey: z.string().min(1), entityKey: z.string().min(1),
  dataClass: z.literal("financial_statements_conflicts"), schemaVersion: z.string().min(1), source: z.string().min(1),
  provider: z.string().min(1), frequency: z.string().min(1), currency: z.string().nullable(), timezone: z.string().min(1),
  observationStart: z.string().nullable(), observationEnd: z.string().nullable(),
  effectiveAt: z.string().datetime().nullable(), publishedAt: z.string().datetime().nullable(),
  retrievedAt: z.string().datetime(), availableAt: z.string().datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), parentSnapshotId: z.string().uuid().nullable(),
  quality: financialStatementsConflictQualitySchema, lineage: z.record(z.unknown()), payload: financialStatementsConflictPayloadSchema,
  createdByUserId: z.number().int().positive().nullable(), createdAt: z.string().datetime(),
});

export type FinancialStatementsConflictPayload = z.infer<typeof financialStatementsConflictPayloadSchema>;
export type FinancialStatementsConflictQuality = z.infer<typeof financialStatementsConflictQualitySchema>;
export type PointInTimeFinancialStatementsConflictSnapshot = z.infer<typeof pointInTimeFinancialStatementsConflictSnapshotSchema>;
