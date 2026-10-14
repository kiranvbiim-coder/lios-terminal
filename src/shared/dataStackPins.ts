/**
 * Conflict pins: an explicit, user-set override of which provider answers a
 * data family (optionally narrowed to one symbol, or one symbol+metric).
 *
 * The environmentSetups.dataStackPins field already existed as an untyped
 * `Record<string, unknown>` JSONB column with no reader/writer anywhere in
 * the codebase; this file gives it a real, validated shape and the two
 * modules that need it (shared/schema.ts for the DB column type,
 * server/dataStackService.ts for resolution logic) import from here.
 *
 * A pin and a per-family stack-order override are modeled as the same
 * mechanism at different specificity, not two competing systems: a
 * scope:"family" pin with no symbol/metric *is* "prefer this provider for
 * this whole family", overriding the user's otherwise-global
 * providerStackOrder. Resolution always picks the most specific matching
 * pin -- metric beats symbol beats family beats global -- see
 * dataStackService.ts's findPin/resolveFamilyProviderOrder.
 */
import { z } from "zod";

/**
 * Every data family this resolver currently spans real multi-provider (or
 * multi-source-shape) fetch paths for. Kept intentionally short and
 * concrete rather than aspirational: each entry here corresponds to a real
 * call site wired to the resolver (see dataStackService.ts's callers), not
 * a family the audit merely mentions. Extending this list is exactly the
 * unit of work for onboarding one more family onto the universal resolver.
 */
export const DATA_FAMILIES = ["quote", "ohlcv", "statements", "fundamentals", "macro_fx", "filings"] as const;
export type DataFamily = (typeof DATA_FAMILIES)[number];

export const PIN_SCOPES = ["global", "family", "symbol", "metric"] as const;
export type PinScope = (typeof PIN_SCOPES)[number];

export interface DataStackPin {
  id: string;
  scope: PinScope;
  /** Required for family/symbol/metric scopes; always null for "global" (applies to every family). */
  family: DataFamily | null;
  /** Required for symbol/metric scopes; null otherwise. Uppercased at write time. */
  symbol: string | null;
  /** Required for metric scope only (e.g. "revenue", "eps"); null otherwise. */
  metric: string | null;
  /** The provider id this pin forces to the front of resolution, e.g. "tiingo", "sec_edgar". */
  providerId: string;
  /** Optional user-entered note shown in Advanced/Data-truth surfaces and export appendices. */
  reason: string | null;
  createdAt: string;
  createdByUserId: number;
}

function checkScopeConsistency(pin: { scope: PinScope; family: DataFamily | null; symbol: string | null; metric: string | null }, ctx: z.RefinementCtx): void {
  if (pin.scope === "global" && pin.family !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A global pin must not carry a family." });
  }
  if (pin.scope !== "global" && pin.family === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A ${pin.scope} pin requires a family.` });
  }
  if ((pin.scope === "symbol" || pin.scope === "metric") && pin.symbol === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A ${pin.scope} pin requires a symbol.` });
  }
  if (pin.scope === "metric" && pin.metric === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A metric pin requires a metric." });
  }
  if (pin.scope !== "metric" && pin.metric !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A ${pin.scope} pin must not carry a metric.` });
  }
  if (pin.scope !== "symbol" && pin.scope !== "metric" && pin.symbol !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `A ${pin.scope} pin must not carry a symbol.` });
  }
}

export const dataStackPinSchema: z.ZodType<DataStackPin> = z.object({
  id: z.string().min(1),
  scope: z.enum(PIN_SCOPES),
  family: z.enum(DATA_FAMILIES).nullable(),
  symbol: z.string().trim().min(1).max(40).nullable(),
  metric: z.string().trim().min(1).max(80).nullable(),
  providerId: z.string().trim().min(1).max(80),
  reason: z.string().trim().max(500).nullable(),
  createdAt: z.string(),
  createdByUserId: z.number().int(),
}).superRefine(checkScopeConsistency);

export const dataStackPinsSchema = z.array(dataStackPinSchema).max(500);

/** Request-shape validator for the pin-creation endpoint -- omits the
 * server-assigned fields (id/createdAt/createdByUserId) but enforces the
 * same scope-consistency rules so a malformed request is rejected at the
 * API boundary, not silently dropped later by parseDataStackPins. */
export const createDataStackPinSchema = z.object({
  scope: z.enum(PIN_SCOPES),
  family: z.enum(DATA_FAMILIES).nullable().default(null),
  symbol: z.string().trim().min(1).max(40).nullable().default(null),
  metric: z.string().trim().min(1).max(80).nullable().default(null),
  providerId: z.string().trim().min(1).max(80),
  reason: z.string().trim().max(500).nullable().default(null),
}).superRefine(checkScopeConsistency);

export type CreateDataStackPinInput = z.infer<typeof createDataStackPinSchema>;

/** Safely coerces whatever is in the JSONB column (untyped historically,
 * and always attacker/legacy-writable in principle) into a validated pin
 * array. Any row that fails validation is dropped rather than throwing --
 * a malformed persisted pin must never crash resolution; it just stops
 * being honored, same fail-open-to-"no override" posture as a missing
 * pin. */
export function parseDataStackPins(raw: unknown): DataStackPin[] {
  const parsed = dataStackPinsSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (!Array.isArray(raw)) return [];
  const out: DataStackPin[] = [];
  for (const entry of raw) {
    const single = dataStackPinSchema.safeParse(entry);
    if (single.success) out.push(single.data);
  }
  return out;
}
