import { notifyDataChanged } from "./gatewayRuntime";
import type { Express, Request } from "express";
import { z } from "zod";
import { isHomeOwner, requireAuth, requireHomeOwner, requireRole } from "./auth";
import { resolveCustomerTrialAccess, resolveInstallationAccess } from "./accessMode";
import { importLicenseFile, LicenseImportError, licenseStatus } from "./licenseFile";
import { canStartSelfServeTrial, startLocalTrial, startSelfServeTrial, TrialStartError } from "./trialAccess";
import { resolveRuntimeMode } from "./runtimeMode";

const trialStartRequestSchema = z.object({}).strict();

async function accessForUser(req: Request) {
  const isOwner = isHomeOwner(req.user);
  const customer = resolveRuntimeMode() === "user_home_server" && req.user !== undefined && req.user.role.startsWith("client_");
  const access = customer ? await resolveCustomerTrialAccess(req.user!.organizationId) : await resolveInstallationAccess();
  const canStartTrial = isOwner ? access.canStartTrial : customer && await canStartSelfServeTrial(req.user!);
  return { ...access, canStartTrial, isOwner };
}

/** Global license/trust controls stay Home-owner-only; self-serve customers may only activate their own trial. */
export function registerLicenseRoutes(app: Express): void {
  app.get("/api/license/status", requireHomeOwner, (_req, res) => {
    res.json(licenseStatus());
  });

  /** Whether this installation may start new work, for the read-only banner and first-run choice. Any signed-in user. */
  app.get("/api/license/access", requireAuth, async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      res.json(await accessForUser(req));
    } catch (error) { next(error); }
  });

  app.post("/api/license/trial/start", requireAuth, requireRole("internal_admin", "client_admin"), async (req, res, next) => {
    try {
      if (!trialStartRequestSchema.safeParse(req.body ?? {}).success || Object.keys(req.query).length > 0) {
        return res.status(400).json({ error: "Trial activation does not accept a target organization or trial clock." });
      }
      if (isHomeOwner(req.user)) {
        await startLocalTrial(req.user!.organizationId);
        notifyDataChanged("license", { homeOwner: true });
      } else {
        await startSelfServeTrial(req.user!);
        notifyDataChanged("license", { userId: req.user!.id });
      }
      return res.json(await accessForUser(req));
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
