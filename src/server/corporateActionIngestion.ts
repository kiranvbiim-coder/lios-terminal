import { parseExDate, parseAdjustmentFactor } from "./bseCorporateActions";
import { createCorporateAction } from "./corporateActionStore";
import { normalizedCorporateActionSchema, type ExternalInstrumentReference, type NormalizedCorporateAction } from "@shared/corporateActionAdapter";

export interface BseCorporateActionRow {
  Ex_date: string;
  Purpose: string;
}

function parseBseRatio(purpose: string): { ratioNumerator: number; ratioDenominator: number; actionType: "split" | "reverse_split" | "bonus_issue" } | null {
  const bonus = purpose.match(/Bonus\s+issue\s+(\d+)\s*:\s*(\d+)/i);
  if (bonus) {
    const newShares = Number(bonus[1]) + Number(bonus[2]);
    const oldShares = Number(bonus[2]);
    return { ratioNumerator: newShares, ratioDenominator: oldShares, actionType: "bonus_issue" };
  }
  const split = purpose.match(/Stock\s+Split\s+From\s+Rs\.?\s*(\d+(?:\.\d+)?)\/?-?\s+to\s+Rs\.?\s*(\d+(?:\.\d+)?)\/?-?/i);
  if (split) {
    const oldFaceValue = Number(split[1]);
    const newFaceValue = Number(split[2]);
    return { ratioNumerator: oldFaceValue / newFaceValue, ratioDenominator: 1, actionType: oldFaceValue < newFaceValue ? "reverse_split" : "split" };
  }
  return null;
}

/** Normalizes one verified BSE row into the shared provider-neutral event
 * contract. Unsupported provider text returns null, never a fabricated
 * dividend/rights/merger event. */
export function normalizeBseCorporateAction(scripCode: string, row: BseCorporateActionRow): NormalizedCorporateAction | null {
  if (!row || typeof row.Ex_date !== "string" || typeof row.Purpose !== "string") return null;
  const exDate = parseExDate(row.Ex_date);
  const ratio = parseBseRatio(row.Purpose);
  const priceAdjustmentFactor = parseAdjustmentFactor(row.Purpose);
  if (!exDate || !ratio || priceAdjustmentFactor === null) return null;

  const parsed = normalizedCorporateActionSchema.safeParse({
    actionType: ratio.actionType,
    effectiveDate: exDate,
    source: "bse_india",
    providerEventId: `bse:${scripCode}:${exDate}:${row.Purpose}`,
    terms: { purpose: row.Purpose, priceAdjustmentFactor },
    legs: [{
      instrument: { kind: "security", source: "bse_india", externalId: scripCode },
      role: "subject",
      ratioNumerator: ratio.ratioNumerator,
      ratioDenominator: ratio.ratioDenominator,
    }],
  });
  return parsed.success ? parsed.data : null;
}

type CreatedCorporateAction = Awaited<ReturnType<typeof createCorporateAction>>;
export type ResolveExternalInstrument = (reference: ExternalInstrumentReference) => Promise<{ securityId?: number; listingId?: number } | null>;

function hasResolvedTarget(reference: ExternalInstrumentReference, target: { securityId?: number; listingId?: number } | null): boolean {
  if (!target) return false;
  if (reference.kind === "security") return Number.isInteger(target.securityId) && target.securityId! > 0 && target.listingId === undefined;
  return Number.isInteger(target.listingId) && target.listingId! > 0 && target.securityId === undefined;
}

export type PersistNormalizedCorporateActionResult =
  | { status: "created"; action: CreatedCorporateAction["action"]; legs: CreatedCorporateAction["legs"] }
  | { status: "unresolved"; externalIds: string[] };

/** Resolves external provider instrument references before persistence. No
 * partial event is written when any leg cannot be resolved. */
export async function persistNormalizedCorporateAction(
  event: NormalizedCorporateAction,
  resolve: ResolveExternalInstrument,
): Promise<PersistNormalizedCorporateActionResult> {
  const resolved = await Promise.all(event.legs.map(async (leg) => ({ leg, target: await resolve(leg.instrument) })));
  const unresolved = resolved.filter((item) => !hasResolvedTarget(item.leg.instrument, item.target)).map((item) => item.leg.instrument.externalId);
  if (unresolved.length) return { status: "unresolved", externalIds: [...new Set(unresolved)] };

  const persisted = await createCorporateAction({
    actionType: event.actionType,
    announcementDate: event.announcementDate,
    exDate: event.exDate,
    recordDate: event.recordDate,
    payableDate: event.payableDate,
    effectiveDate: event.effectiveDate,
    source: event.source,
    providerEventId: event.providerEventId,
    sourceUrl: event.sourceUrl,
    terms: event.terms,
    legs: resolved.map(({ leg, target }) => ({ ...target!, role: leg.role, ratioNumerator: leg.ratioNumerator, ratioDenominator: leg.ratioDenominator, cashAmount: leg.cashAmount, cashCurrency: leg.cashCurrency, newSymbol: leg.newSymbol, newExchangeMic: leg.newExchangeMic })),
  });
  return { status: "created", action: persisted.action, legs: persisted.legs };
}
