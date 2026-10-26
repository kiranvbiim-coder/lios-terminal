/**
 * LV4-04-10: the canonical Global Instrument Master resolver
 * (globalInstrumentMasterStore.ts) existed as a library function with no
 * HTTP surface -- this is that surface.
 *
 * This is deliberately a separate, additive endpoint rather than a
 * replacement for the existing /api/finance/entities/resolve
 * (server/entityResolver.ts), which companyIntelligenceSpine.ts already
 * composes quotes/financials/filings/insider-data on top of. Consolidating
 * the two resolvers is real, valuable follow-up work -- entityResolver.ts's
 * ambiguous-candidate shape and this endpoint's ranked-with-scores shape are
 * different enough that swapping the composed spine over is a separate,
 * larger change, not a same-PR rename.
 *
 * LV4-04-11 (added here in the same phase): a free-text search sibling over
 * the local common-instrument-universe index (instrumentSearchIndexStore.ts)
 * -- companies/listings plus the bundled ~67k-ticker legacy catalog -- for
 * callers that have a search-box string rather than a structured
 * ticker/MIC/identifier lookup.
 */
import type { Express } from "express";
import { z } from "zod";
import { INSTRUMENT_IDENTIFIER_TYPES } from "@shared/globalInstrumentMaster";
import { resolvePersistedInstrument } from "./globalInstrumentMasterStore";
import { searchCommonInstrumentUniverse } from "./instrumentSearchIndexStore";
import { searchGleifLegalEntities, GleifApiError } from "./gleifEntityReference";

// LV4-04-13: real point-in-time (backtest) resolution/search, not just the
// includeHistorical binary toggle -- see globalInstrumentMaster.ts's
// InstrumentResolutionQuery.asOfDate and instrumentSearchIndex.ts's
// InstrumentSearchOptions.asOfDate for the full rationale. Validated here as
// an actual calendar date, not just a YYYY-MM-DD-shaped string, so a
// malformed query param fails fast with a clear message instead of
// silently matching nothing three layers down.
const ISO_DATE_ONLY = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "asOfDate must be an ISO date (YYYY-MM-DD).")
  .refine(
    (value) => {
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) return false;
      // JS Date parsing silently rolls a nonexistent day-of-month forward
      // (e.g. 2015-02-30 becomes 2015-03-02) instead of rejecting it. For a
      // backtest tool where the exact requested date matters, round-trip
      // back to YYYY-MM-DD and require an exact match so a caller never
      // gets a silently different date than the one they asked for.
      return parsed.toISOString().slice(0, 10) === value;
    },
    { message: "asOfDate must be a real calendar date." },
  );

export const resolveInstrumentQuerySchema = z.object({
  name: z.string().trim().min(1).optional(),
  ticker: z.string().trim().min(1).optional(),
  mic: z.string().trim().min(1).optional(),
  exchange: z.string().trim().min(1).optional(),
  identifierType: z.enum(INSTRUMENT_IDENTIFIER_TYPES).optional(),
  identifierValue: z.string().trim().min(1).optional(),
  identifierProvider: z.string().trim().min(1).optional(),
  identifierRegistry: z.string().trim().min(1).optional(),
  identifierJurisdiction: z.string().trim().min(1).optional(),
  includeHistorical: z.enum(["true", "false"]).optional(),
  asOfDate: ISO_DATE_ONLY.optional(),
}).refine(
  (value) => Boolean(value.name || value.ticker || (value.identifierType && value.identifierValue)),
  { message: "Provide at least one of: name, ticker, or identifierType+identifierValue." },
).refine(
  (value) => value.identifierType !== "registry_id" || Boolean(value.identifierRegistry),
  { message: "identifierType=registry_id requires identifierRegistry (and optionally identifierJurisdiction)." },
);

export const searchInstrumentsQuerySchema = z.object({
  q: z.string().trim().min(1, "Provide a non-empty search query."),
  limit: z.coerce.number().int().positive().max(50).optional(),
  includeHistorical: z.enum(["true", "false"]).optional(),
  asOfDate: ISO_DATE_ONLY.optional(),
});

export function registerGlobalInstrumentMasterRoutes(app: Express): void {
  // CC0 legal-entity intelligence: LEI is NOT an exchange listing.
  // Results are source-attributed P5 candidates, never written/promoted.
  app.get("/api/finance/entities/gleif", async (req, res) => {
    const parsed = z.object({
      lei: z.string().trim().optional(),
      name: z.string().trim().optional(),
    }).strict().superRefine((value, ctx) => {
      if (Number(Boolean(value.lei)) + Number(Boolean(value.name)) !== 1) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Provide exactly one of lei or name." });
      }
    }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid legal entity query" });
      return;
    }
    try {
      const query = parsed.data.lei ? { lei: parsed.data.lei } : { name: parsed.data.name! };
      res.json(await searchGleifLegalEntities(query));
    } catch (error) {
      const status = error instanceof GleifApiError ? error.status : 502;
      res.status(status).json({ error: error instanceof Error ? error.message : "GLEIF lookup unavailable" });
    }
  });

  app.get("/api/finance/instruments/resolve", async (req, res) => {
    const parsed = resolveInstrumentQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
      return;
    }
    const { name, ticker, mic, exchange, identifierType, identifierValue, identifierProvider, identifierRegistry, identifierJurisdiction, includeHistorical, asOfDate } = parsed.data;

    try {
      const result = await resolvePersistedInstrument({
        name,
        ticker,
        mic,
        exchange,
        identifier: identifierType && identifierValue
          ? { type: identifierType, value: identifierValue, provider: identifierProvider, registry: identifierRegistry, jurisdiction: identifierJurisdiction }
          : undefined,
        includeHistorical: includeHistorical === "true",
        asOfDate,
      });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Instrument resolution failed." });
    }
  });

  app.get("/api/finance/instruments/search", async (req, res) => {
    const parsed = searchInstrumentsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid query." });
      return;
    }
    const { q, limit, includeHistorical, asOfDate } = parsed.data;

    try {
      const result = await searchCommonInstrumentUniverse(q, {
        limit,
        includeHistorical: includeHistorical === "true",
        asOfDate,
      });
      res.json(result);
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Instrument search failed." });
    }
  });
}
