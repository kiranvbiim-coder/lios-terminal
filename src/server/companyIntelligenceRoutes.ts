/**
 * Company Intelligence Data Spine: one composite entry point tying
 * together entity resolution, quotes, financial-statement conflict
 * detection, filings, and insider activity (companyIntelligenceSpine.ts).
 * Gated by the app.use("/api", requireInternal) middleware in routes.ts
 * like the rest of this registration group.
 */
import type { Express } from "express";
import { z } from "zod";
import { buildCompanySnapshot, type CompanySnapshotDependencies } from "./companyIntelligenceSpine";

const querySchema = z.string().trim().min(1).max(240);

export function registerCompanyIntelligenceRoutes(app: Express, dependencies?: Partial<CompanySnapshotDependencies>): void {
  app.get("/api/company-spine/:query", async (req, res) => {
    const query = querySchema.safeParse(req.params.query);
    if (!query.success) {
      res.status(400).json({ error: "A valid company query is required." });
      return;
    }
    try {
      res.json(await buildCompanySnapshot(query.data, dependencies));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : "Company snapshot failed." });
    }
  });
}
