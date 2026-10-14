import { z } from "zod";

export const corporateActionExternalInstrumentSchema = z.object({
  kind: z.enum(["security", "listing"]),
  source: z.string().trim().min(1),
  externalId: z.string().trim().min(1),
});

export const normalizedCorporateActionLegSchema = z.object({
  instrument: corporateActionExternalInstrumentSchema,
  role: z.enum(["subject", "acquirer", "target", "successor", "replacement", "spinoff"]),
  ratioNumerator: z.number().finite().positive().optional(),
  ratioDenominator: z.number().finite().positive().optional(),
  cashAmount: z.number().finite().nonnegative().optional(),
  cashCurrency: z.string().trim().min(3).max(3).optional(),
  newSymbol: z.string().trim().min(1).optional(),
  newExchangeMic: z.string().trim().min(4).optional(),
}).superRefine((leg, context) => {
  const hasNumerator = leg.ratioNumerator !== undefined;
  const hasDenominator = leg.ratioDenominator !== undefined;
  if (hasNumerator !== hasDenominator) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["ratioDenominator"], message: "ratioNumerator and ratioDenominator must be supplied together" });
  }
});

export const normalizedCorporateActionSchema = z.object({
  actionType: z.enum([
    "dividend", "special_dividend", "split", "reverse_split", "rights_issue", "bonus_issue",
    "merger", "acquisition", "spin_off", "ticker_change", "exchange_migration", "delisting",
    "relisting", "security_replacement",
  ]),
  issuerExternalId: z.string().trim().min(1).optional(),
  announcementDate: z.string().date().optional(),
  exDate: z.string().date().optional(),
  recordDate: z.string().date().optional(),
  payableDate: z.string().date().optional(),
  effectiveDate: z.string().date().optional(),
  source: z.string().trim().min(1),
  providerEventId: z.string().trim().min(1),
  sourceUrl: z.string().url().optional(),
  terms: z.record(z.string(), z.unknown()).default({}),
  legs: z.array(normalizedCorporateActionLegSchema).min(1),
});

export type ExternalInstrumentReference = z.infer<typeof corporateActionExternalInstrumentSchema>;
export type NormalizedCorporateActionLeg = z.infer<typeof normalizedCorporateActionLegSchema>;
export type NormalizedCorporateAction = z.infer<typeof normalizedCorporateActionSchema>;

export interface CorporateActionAdapter<TRaw> {
  provider: string;
  normalize(raw: TRaw): NormalizedCorporateAction | null;
}
