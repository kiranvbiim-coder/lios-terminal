/**
 * Internal terminal routes for the SEC EDGAR connector -- official, free,
 * no key required. Gated by the app.use("/api", requireInternal)
 * middleware in routes.ts like everything else in this registration group.
 */
import type { Express } from "express";
import { z } from "zod";
import { getInsiderTransactions, getInsiderTransactionsPage, getCompanyFilings, getCompanyFilingsPage, normalizeEdgarPageOptions } from "./secEdgarData";
import { callPythonService, PythonServiceDataError } from "./pythonService";

const filingSearchSchema = z.object({
  query: z.string().trim().max(200).default(""),
  ticker: z.string().trim().max(10).optional(),
  forms: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).max(10_000).default(0),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export function registerSecEdgarRoutes(app: Express): void {
  app.get("/api/edgar/insiders/:ticker", async (req, res) => {
    const ticker = String(req.params.ticker);
    const hasPageControls = ["page", "from", "to", "cursor"].some((key) => req.query[key] !== undefined);
    try {
      const options = normalizeEdgarPageOptions({
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      });
      if (hasPageControls) {
        res.json(await getInsiderTransactionsPage(ticker, { ...options, from: options.from ?? undefined, to: options.to ?? undefined }));
      } else {
        res.json(await getInsiderTransactions(ticker, options.limit));
      }
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid SEC insider query." });
    }
  });

  app.get("/api/edgar/filings/:ticker", async (req, res) => {
    const ticker = String(req.params.ticker);
    const hasPageControls = ["page", "from", "to", "cursor"].some((key) => req.query[key] !== undefined);
    try {
      const options = normalizeEdgarPageOptions({
        page: req.query.page ? Number(req.query.page) : 1,
        limit: req.query.limit ? Number(req.query.limit) : 20,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      });
      if (hasPageControls) {
        res.json(await getCompanyFilingsPage(ticker, { ...options, from: options.from ?? undefined, to: options.to ?? undefined }));
      } else {
        res.json(await getCompanyFilings(ticker, req.query.limit ? options.limit : 40));
      }
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid SEC filing query." });
    }
  });

  // Real full-text search across SEC filing content via the Python sidecar
  // (edgartools -> EDGAR's own EFTS API).
  // Real full-text search across SEC filing content via the Python sidecar
  // (edgartools -> EDGAR's own EFTS API) -- distinct from the two routes
  // above, which cover XBRL numeric facts and Form 4 metadata, not filing
  // text content. See python-service/sec_search.py.
  app.post("/api/edgar/filing-search", async (req, res) => {
    const parsed = filingSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid request." });
      return;
    }
    try {
      const result = await callPythonService("/sec/filing-search", parsed.data);
      res.json(result);
    } catch (err) {
      if (err instanceof PythonServiceDataError) {
        res.status(400).json({ error: err.detail });
        return;
      }
      console.error("SEC filing search (Python sidecar) failed:", err);
      res.status(502).json({ error: "Filing search unavailable right now." });
    }
  });
}
