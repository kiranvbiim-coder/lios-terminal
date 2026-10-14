import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import {
  companyListings,
  corporateActionLegRoleEnum,
  corporateActionTypeEnum,
  corporateActions,
  corporateActionLegs,
} from "@shared/schema";
import { CONTINUITY_ACTION_TYPES, type ContinuityActionType } from "@shared/corporateActionContinuity";
import { getDb } from "./db";

export type CorporateActionType = typeof corporateActionTypeEnum.enumValues[number];
export type CorporateActionLegRole = typeof corporateActionLegRoleEnum.enumValues[number];

export interface CorporateActionLegInput {
  securityId?: number;
  listingId?: number;
  role: CorporateActionLegRole;
  ratioNumerator?: number;
  ratioDenominator?: number;
  cashAmount?: number;
  cashCurrency?: string;
  newSymbol?: string;
  newExchangeMic?: string;
}

export interface CorporateActionInput {
  actionType: CorporateActionType;
  issuerCompanyId?: number | null;
  announcementDate?: string;
  exDate?: string;
  recordDate?: string;
  payableDate?: string;
  effectiveDate?: string;
  source: string;
  providerEventId?: string;
  sourceUrl?: string;
  terms?: Record<string, unknown>;
  legs: CorporateActionLegInput[];
}

/**
 * Inserts one provider-neutral event and its affected instrument legs in
 * one transaction. The database CHECK/FK constraints enforce that every
 * leg points to exactly one security or listing and that ratios/cash are
 * sane; this function keeps the event + legs atomic so consumers never
 * observe a header without its canonical impact rows.
 */
function errorText(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  return `${error instanceof Error ? error.message : String(error)} ${cause instanceof Error ? cause.message : String(cause ?? "")}`;
}
export async function createCorporateAction(input: CorporateActionInput) {
  if (input.legs.length === 0) throw new RangeError("A corporate action requires at least one instrument leg.");
  const numericTerms = [
    ["ratioNumerator", input.legs.flatMap((leg) => leg.ratioNumerator === undefined ? [] : [leg.ratioNumerator])],
    ["ratioDenominator", input.legs.flatMap((leg) => leg.ratioDenominator === undefined ? [] : [leg.ratioDenominator])],
    ["cashAmount", input.legs.flatMap((leg) => leg.cashAmount === undefined ? [] : [leg.cashAmount])],
  ] as const;
  for (const [field, values] of numericTerms) {
    if (values.some((value) => !Number.isFinite(value))) throw new RangeError(`${field} must be finite.`);
  }

  try {
    return await getDb().transaction(async (tx) => {
      const [action] = await tx.insert(corporateActions).values({
        actionType: input.actionType,
        issuerCompanyId: input.issuerCompanyId ?? null,
        announcementDate: input.announcementDate ?? null,
        exDate: input.exDate ?? null,
        recordDate: input.recordDate ?? null,
        payableDate: input.payableDate ?? null,
        effectiveDate: input.effectiveDate ?? null,
        source: input.source,
        providerEventId: input.providerEventId ?? null,
        sourceUrl: input.sourceUrl ?? null,
        terms: input.terms ?? {},
      }).returning();

      const legs = await tx.insert(corporateActionLegs).values(
        input.legs.map((leg) => ({
          actionId: action.id,
          securityId: leg.securityId ?? null,
          listingId: leg.listingId ?? null,
          role: leg.role,
          ratioNumerator: leg.ratioNumerator ?? null,
          ratioDenominator: leg.ratioDenominator ?? null,
          cashAmount: leg.cashAmount ?? null,
          cashCurrency: leg.cashCurrency ?? null,
          newSymbol: leg.newSymbol ?? null,
          newExchangeMic: leg.newExchangeMic ?? null,
        })),
      ).returning();

      return { action, legs };
    });
  } catch (error) {
    const message = errorText(error);
    if (message.includes("corporate_action_provider_event_unique")) {
      throw new Error("Corporate action provider event already exists for this source (unique provider event).");
    }
    if (message.includes("corporate_action_leg_")) {
      throw new Error(`Corporate action leg constraint failed: ${message}`);
    }
    throw error;
  }
}

/** Lists all canonical actions touching one security, with their full leg
 * set, ordered by effective date (then event id) for chart/history,
 * portfolio, backtest, and valuation consumers. */
export async function listCorporateActionsForSecurity(securityId: number) {
  const actionIds = await getDb()
    .select({ actionId: corporateActionLegs.actionId })
    .from(corporateActionLegs)
    .leftJoin(companyListings, eq(companyListings.id, corporateActionLegs.listingId))
    .where(or(eq(corporateActionLegs.securityId, securityId), eq(companyListings.securityId, securityId)));
  if (actionIds.length === 0) return [];

  const rows = await getDb()
    .select({ action: corporateActions, leg: corporateActionLegs })
    .from(corporateActionLegs)
    .innerJoin(corporateActions, eq(corporateActions.id, corporateActionLegs.actionId))
    .where(inArray(corporateActionLegs.actionId, actionIds.map((row) => row.actionId)))
    .orderBy(
      sql`COALESCE(${corporateActions.effectiveDate}, ${corporateActions.exDate}, ${corporateActions.recordDate}, ${corporateActions.announcementDate})`,
      asc(corporateActions.id),
    );
  const grouped = new Map<number, { action: typeof corporateActions.$inferSelect; legs: (typeof corporateActionLegs.$inferSelect)[] }>();
  for (const row of rows) {
    const existing = grouped.get(row.action.id);
    if (existing) existing.legs.push(row.leg);
    else grouped.set(row.action.id, { action: row.action, legs: [row.leg] });
  }
  return [...grouped.values()];
}

/** Lists canonical actions for one BSE numeric scrip when the local master
 * has an unambiguous BSE/XBOM listing. */
export async function listCorporateActionsForBseScrip(scripCode: string) {
  const normalizedCode = scripCode.trim().toUpperCase().replace(/\.BO$/, "");
  const listings = await getDb()
    .select({ id: companyListings.id, securityId: companyListings.securityId })
    .from(companyListings)
    .where(
      and(
        or(
          eq(companyListings.symbol, normalizedCode),
          eq(companyListings.symbol, `${normalizedCode}.BO`),
        ),
        or(
          eq(companyListings.exchange, "BSE"),
          eq(companyListings.exchange, "XBOM"),
          eq(companyListings.mic, "XBOM"),
        ),
      ),
    );
  const securityIds = [...new Set(listings.map((listing) => listing.securityId))];
  if (securityIds.length > 1) throw new Error(`BSE scrip ${normalizedCode} maps to multiple securities.`);
  if (securityIds.length === 0) return [];
  const securityId = securityIds[0];
  const listingIds = new Set(listings.map((listing) => listing.id));
  const actions = await listCorporateActionsForSecurity(securityId);
  return actions.filter(({ action, legs }) => {
    const isAdjustable = action.actionType === "split" ||
      action.actionType === "reverse_split" ||
      action.actionType === "bonus_issue" ||
      action.actionType === "dividend" ||
      action.actionType === "special_dividend";
    if (!isAdjustable) return true;
    const touchesBse = legs.some((leg) =>
      leg.securityId === securityId || (leg.listingId !== null && listingIds.has(leg.listingId)),
    );
    const subjectMatchesBse = legs.some((leg) =>
      leg.role === "subject" &&
      (leg.securityId === securityId || (leg.listingId !== null && listingIds.has(leg.listingId))),
    );
    if (touchesBse && !subjectMatchesBse) {
      throw new Error(`Canonical BSE action ${action.id} has no subject leg for scrip ${normalizedCode}.`);
    }
    return touchesBse;
  });
}

export interface CorporateActionContinuityRecord {
  actionId: number;
  actionType: ContinuityActionType;
  effectiveDate: string;
  sourceSymbol: string;
  targetSymbol: string | null;
  sourceSecurityId: number;
  targetSecurityId: number | null;
  targetListingId: number | null;
}

function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

/** Resolves canonical merger/spinoff/ticker continuity into explicit source
 * and target symbols. Unresolved targets stay visible with targetSymbol null. */
export async function listCorporateActionContinuityForSecurity(
  securityId: number,
  sourceSymbol: string,
): Promise<CorporateActionContinuityRecord[]> {
  if (!Number.isInteger(securityId) || securityId <= 0) throw new RangeError("Continuity securityId must be positive.");
  const normalizedSourceSymbol = sourceSymbol.trim().toUpperCase();
  if (!normalizedSourceSymbol) throw new RangeError("Continuity sourceSymbol is required.");
  const sourceListings = await getDb()
    .select({ id: companyListings.id, symbol: companyListings.symbol })
    .from(companyListings)
    .where(eq(companyListings.securityId, securityId));
  if (!sourceListings.some((listing) => listing.symbol.trim().toUpperCase() === normalizedSourceSymbol)) {
    throw new RangeError(`Continuity sourceSymbol ${normalizedSourceSymbol} is not a listing of security ${securityId}.`);
  }
  const sourceListingIds = new Set(sourceListings
    .filter((listing) => listing.symbol.trim().toUpperCase() === normalizedSourceSymbol)
    .map((listing) => listing.id));
  const actions = await listCorporateActionsForSecurity(securityId);
  const continuityActions = actions.filter(({ action, legs }) => {
    if (!CONTINUITY_ACTION_TYPES.includes(action.actionType as ContinuityActionType)) return false;
    const matchingSubjects = legs.filter((leg) =>
      leg.role === "subject" &&
      (leg.securityId === securityId || (leg.listingId !== null && sourceListingIds.has(leg.listingId))),
    );
    return matchingSubjects.length === 1;
  });
  const targetListingIds = continuityActions.flatMap(({ legs }) =>
    legs.flatMap((leg) => leg.listingId === null ? [] : [leg.listingId]),
  );
  const targetListings = targetListingIds.length === 0
    ? []
    : await getDb()
        .select({ id: companyListings.id, symbol: companyListings.symbol, securityId: companyListings.securityId })
        .from(companyListings)
        .where(inArray(companyListings.id, [...new Set(targetListingIds)]));
  const targetListingById = new Map(targetListings.map((listing) => [listing.id, listing]));

  return continuityActions.flatMap(({ action, legs }) => {
    const effectiveDate = action.effectiveDate ?? action.exDate;
    if (!effectiveDate || !isValidIsoDate(effectiveDate)) {
      throw new RangeError(`Canonical continuity action ${action.id} has an invalid effective date.`);
    }
    const subject = legs.find((leg) =>
      leg.role === "subject" &&
      (leg.securityId === securityId || (leg.listingId !== null && sourceListingIds.has(leg.listingId))),
    );
    const preferredTargetRoles = action.actionType === "acquisition"
      ? ["successor", "replacement"]
      : ["successor", "replacement", "spinoff"];
    const preferredTargetLegs = legs.filter((leg) => preferredTargetRoles.includes(leg.role));
    const targetLegs = preferredTargetLegs.length > 0
      ? preferredTargetLegs
      : action.actionType === "acquisition"
        ? legs.filter((leg) => leg.role === "acquirer")
        : [];
    const fallbackTarget = targetLegs.length === 0 && (action.actionType === "ticker_change" || action.actionType === "exchange_migration")
      ? [subject].filter((leg): leg is NonNullable<typeof subject> => leg !== undefined)
      : targetLegs;
    const termsSymbol = typeof action.terms.newSymbol === "string" ? action.terms.newSymbol : undefined;
    return fallbackTarget.length > 0
      ? fallbackTarget.map((target) => {
          const targetListing = target.listingId === null || target.listingId === undefined ? undefined : targetListingById.get(target.listingId);
          const targetIsSubject = target === subject;
          const resolvedTargetSymbol = target.newSymbol?.trim().toUpperCase() ||
            (!targetIsSubject ? targetListing?.symbol?.trim().toUpperCase() : undefined) ||
            termsSymbol?.trim().toUpperCase() ||
            null;
          return {
            actionId: action.id,
            actionType: action.actionType as ContinuityActionType,
            effectiveDate,
            sourceSymbol: normalizedSourceSymbol,
            targetSymbol: resolvedTargetSymbol === normalizedSourceSymbol ? null : resolvedTargetSymbol,
            sourceSecurityId: securityId,
            targetSecurityId: target.securityId ?? targetListing?.securityId ?? null,
            targetListingId: target.listingId ?? null,
          };
        })
      : [{
          actionId: action.id,
          actionType: action.actionType as ContinuityActionType,
          effectiveDate,
          sourceSymbol: normalizedSourceSymbol,
          targetSymbol: termsSymbol?.trim().toUpperCase() === normalizedSourceSymbol
            ? null
            : termsSymbol?.trim().toUpperCase() || null,
          sourceSecurityId: securityId,
          targetSecurityId: null,
          targetListingId: null,
        }];
  });
}
