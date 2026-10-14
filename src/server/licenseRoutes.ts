import { notifyDataChanged } from "./gatewayRuntime";
import type { Express } from "express";
import { z } from "zod";
import { requireHomeOwner } from "./auth";
import { importLicenseFile, LicenseImportError, licenseStatus } from "./licenseFile";

/**
 * Registered before the internal-account gate because a customer terminal's administrator (client_admin) imports the
 * licence too. The licence is a local, signed file; no vendor call is made.
 */
export function registerLicenseRoutes(app: Express): void {
  app.get("/api/license/status", requireHomeOwner, (_req, res) => {
    res.json(licenseStatus());
  });

  app.post("/api/license/import", requireHomeOwner, (req, res) => {
    const parsed = z.object({ license: z.string().min(2).max(65_536) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide the licence file contents as \"license\"." });
    try {
      const imported = importLicenseFile(parsed.data.license);
      notifyDataChanged("license", { homeOwner: true });
      return res.json(imported);
    } catch (error) {
      if (error instanceof LicenseImportError) return res.status(400).json({ error: error.message });
      throw error;
    }
  });
}
