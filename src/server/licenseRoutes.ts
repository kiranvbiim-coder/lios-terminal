import { notifyDataChanged } from "./gatewayRuntime";
import type { Express } from "express";
import { z } from "zod";
import { isHomeOwner, requireAuth, requireHomeOwner } from "./auth";
import { resolveInstallationAccess } from "./accessMode";
import { importLicenseFile, LicenseImportError, licenseStatus } from "./licenseFile";
import { startLocalTrial, TrialStartError } from "./trialAccess";

/**
 * Registered before the internal-account gate because a customer terminal's administrator (client_admin) imports the
 * licence too. The licence is a local, signed file or pasted key; no vendor call is made.
 */
export function registerLicenseRoutes(app: Express): void {
  app.get("/api/license/status", requireHomeOwner, (_req, res) => {
    res.json(licenseStatus());
  });

  /** Whether this installation may start new work, for the read-only banner and first-run choice. Any signed-in user. */
  app.get("/api/license/access", requireAuth, async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json({ ...(await resolveInstallationAccess()), isOwner: isHomeOwner(req.user) });
    } catch (error) { next(error); }
  });

  app.post("/api/license/trial/start", requireHomeOwner, async (req, res, next) => {
    try {
      await startLocalTrial(req.user!.organizationId);
      notifyDataChanged("license", { homeOwner: true });
      return res.json({ ...(await resolveInstallationAccess()), isOwner: true });
    } catch (error) {
      if (error instanceof TrialStartError) return res.status(error.status).json({ error: error.message });
      next(error);
    }
  });

  // Accepts the licence file's contents or a pasted `LIOS1-` key; both take the same verification path.
  app.post("/api/license/import", requireHomeOwner, (req, res) => {
    const parsed = z.object({ license: z.string().min(2).max(65_536) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Provide the licence file contents or licence key as \"license\"." });
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
