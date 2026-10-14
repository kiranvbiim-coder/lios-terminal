import type { Express } from "express";
import { requireRole } from "./auth";
import { buildV4OperationalReadiness, findV4OperationalItem, type OperationalPhase } from "@shared/v4OperationalContracts";
import { generateDiagnosticBundle } from "./governanceEngine";
import { buildProviderAcceptanceSnapshot } from "./providerAcceptance";
import { buildDesktopAcceptanceSnapshot } from "./desktopAcceptance";
import { buildProductionAcceptanceSnapshot } from "./productionAcceptance";
import { buildSecurityAcceptanceSnapshot } from "./securityAcceptance";
import { buildP7ReleaseReadiness } from "./p7ReleaseReadiness";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

function phaseFromQuery(value: unknown): OperationalPhase | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ["V4-25", "V4-26", "V4-27", "V4-28", "V4-29"].includes(normalized)
    ? normalized as OperationalPhase
    : null;
}

/** Read-only operational evidence; no credentials or raw client data cross this boundary. */
export function registerOperationalReadinessRoutes(app: Express): void {
  app.get("/api/operations/readiness", requireRole(...READ_ROLES), (req, res) => {
    const readiness = buildV4OperationalReadiness();
    const phase = phaseFromQuery(req.query.phase);
    if (!phase) return res.json(readiness);
    res.json({ ...readiness, items: readiness.items.filter((item) => item.phase === phase), phases: readiness.phases.filter((summary) => summary.phase === phase) });
  });

  app.get("/api/operations/acceptance", requireRole(...READ_ROLES), (_req, res) => {
    const readiness = buildV4OperationalReadiness();
    res.json({ contractVersion: readiness.contractVersion, generatedAt: readiness.generatedAt, phase: "V4-28", status: readiness.phases.find((summary) => summary.phase === "V4-28")?.status ?? "blocked", items: readiness.items.filter((item) => item.phase === "V4-28") });
  });

  app.get("/api/operations/provider-acceptance", requireRole(...READ_ROLES), async (_req, res, next) => {
    try {
      res.json(await buildProviderAcceptanceSnapshot());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/desktop-acceptance", requireRole(...READ_ROLES), (_req, res) => {
    res.json(buildDesktopAcceptanceSnapshot());
  });

  app.get("/api/operations/production-acceptance", requireRole(...READ_ROLES), async (_req, res, next) => {
    try {
      res.json(await buildProductionAcceptanceSnapshot());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/security-acceptance", requireRole(...READ_ROLES), async (_req, res, next) => {
    try {
      res.json(await buildSecurityAcceptanceSnapshot());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/p7-release-readiness", requireRole(...READ_ROLES), async (_req, res, next) => {
    try {
      res.json(await buildP7ReleaseReadiness());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/operations/release", requireRole(...READ_ROLES), (_req, res) => {
    const readiness = buildV4OperationalReadiness();
    res.json({ contractVersion: readiness.contractVersion, generatedAt: readiness.generatedAt, phase: "V4-29", status: readiness.phases.find((summary) => summary.phase === "V4-29")?.status ?? "blocked", environment: readiness.environment, items: readiness.items.filter((item) => item.phase === "V4-29"), blockers: readiness.blockers });
  });

  app.get("/api/operations/items/:itemId", requireRole(...READ_ROLES), (req, res) => {
    const item = findV4OperationalItem(String(req.params.itemId));
    if (!item) return res.status(404).json({ error: "Operational item not found." });
    res.json(item);
  });

  // Support agents receive a redacted diagnostic envelope, never a vault or
  // raw process environment. Consent remains explicit and time-bounded in the
  // governance engine; this route only exposes the safe shape.
  app.get("/api/operations/support-summary", requireRole("internal_admin", "internal_compliance"), (_req, res) => {
    const readiness = buildV4OperationalReadiness();
    const bundle = generateDiagnosticBundle("operational-readiness", { status: readiness.status, phases: readiness.phases }, { environment: readiness.environment, contractVersion: readiness.contractVersion }, readiness.blockers);
    res.json(bundle);
  });
}
