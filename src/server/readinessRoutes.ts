/**
 * Engine Readiness, Capability Discovery and Data Passport API.
 *
 * These routes expose the contract resolver's readiness decisions and the
 * universal capability discovery surface to the terminal UI.
 */
import type { Express } from "express";
import { z } from "zod";
import { requireRole } from "./auth";
import { getConnectorRegistrySnapshot, getOperationalConnectorIds } from "./connectorService";
import { registerCapabilityRoutes } from "./capabilityRoutes";
import {
  CONTRACT_FAMILIES,
  ENGINE_CONTRACT_DECLARATIONS,
  getContractFamily,
  getEngineDeclaration,
  resolveAllEngineReadiness,
  resolveEngineReadiness,
} from "@shared/dataContracts";
import { BUILT_IN_CONNECTORS } from "@shared/connectorRegistry";
import { buildProviderDepthReport, getProviderDepthAudit } from "./providerDepthAudit";
import { buildConnectionHealthSummary, resolveOnboardingConnectionReadiness } from "@shared/connectionCenterWaveB";

const READ_ROLES = ["internal_admin", "internal_analyst", "internal_compliance"] as const;

export function registerReadinessRoutes(app: Express): void {
  // Capability metadata lives beside readiness because both are read-only
  // system-introspection surfaces. routes.ts already places this registrar
  // behind the internal authentication gate.
  registerCapabilityRoutes(app);

  // ─── Provider-depth audit (V4-08) ───────────────────────────────────────

  /**
   * Static-code provider utilization report. It intentionally reports
   * catalog, retrieval, mapping, visibility, and engine-use stages separately;
   * credential presence alone never advances a stage.
   */
  app.get("/api/readiness/providers/depth", requireRole(...READ_ROLES), async (_req, res) => {
    const snapshot = await getConnectorRegistrySnapshot();
    res.json(buildProviderDepthReport({ connectors: snapshot.connectors, health: snapshot.health }));
  });

  app.get("/api/readiness/providers/depth/:providerId", requireRole(...READ_ROLES), async (req, res) => {
    const providerId = String(req.params.providerId).trim().toLowerCase();
    if (!providerId || providerId.length > 120) return res.status(400).json({ error: "A valid provider ID is required." });
    const snapshot = await getConnectorRegistrySnapshot();
    const audit = getProviderDepthAudit(providerId, { connectors: snapshot.connectors, health: snapshot.health });
    if (!audit) return res.status(404).json({ error: "Provider depth audit not found." });
    res.json(audit);
  });

  app.get("/api/readiness/connections/summary", requireRole(...READ_ROLES), async (_req, res) => {
    const snapshot = await getConnectorRegistrySnapshot();
    res.json({
      health: buildConnectionHealthSummary(snapshot),
      onboarding: resolveOnboardingConnectionReadiness({
        connectedCount: snapshot.health.filter((report) => report.state !== "catalog_only").length,
        health: snapshot.health,
      }),
    });
  });

  // ─── Engine readiness ───────────────────────────────────────────────────

  /** All engines with their readiness state given current connector health. */
  app.get("/api/readiness/engines", requireRole(...READ_ROLES), async (_req, res) => {
    const snapshot = await getConnectorRegistrySnapshot();
    const healthyIds = new Set(getOperationalConnectorIds(snapshot.health));

    // Build available capabilities from healthy connectors
    const availableCapabilities = new Set<string>();
    for (const connector of BUILT_IN_CONNECTORS) {
      if (healthyIds.has(connector.id)) {
        for (const cap of connector.capabilities) {
          availableCapabilities.add(cap.contractFamily);
        }
      }
    }

    const readiness = resolveAllEngineReadiness(availableCapabilities);
    res.json({ readiness, availableCapabilities: Array.from(availableCapabilities), healthyConnectors: Array.from(healthyIds) });
  });

  /** Single engine readiness detail. */
  app.get("/api/readiness/engines/:engineId", requireRole(...READ_ROLES), async (req, res) => {
    const engineId = String(req.params.engineId);
    const engine = getEngineDeclaration(engineId);
    if (!engine) return res.status(404).json({ error: "Engine not found." });

    const snapshot = await getConnectorRegistrySnapshot();
    const healthyIds = new Set(getOperationalConnectorIds(snapshot.health));

    const availableCapabilities = new Set<string>();
    for (const connector of BUILT_IN_CONNECTORS) {
      if (healthyIds.has(connector.id)) {
        for (const cap of connector.capabilities) {
          availableCapabilities.add(cap.contractFamily);
        }
      }
    }

    const readiness = resolveEngineReadiness(engine, availableCapabilities);
    res.json(readiness);
  });

  // ─── Contract families ──────────────────────────────────────────────────

  /** All contract families. */
  app.get("/api/readiness/contracts", requireRole(...READ_ROLES), async (_req, res) => {
    res.json(CONTRACT_FAMILIES);
  });

  /** Single contract family detail. */
  app.get("/api/readiness/contracts/:familyId", requireRole(...READ_ROLES), async (req, res) => {
    const familyId = String(req.params.familyId);
    const family = getContractFamily(familyId);
    if (!family) return res.status(404).json({ error: "Contract family not found." });
    res.json(family);
  });

  /** Connectors that can satisfy a given contract family. */
  app.get("/api/readiness/contracts/:familyId/connectors", requireRole(...READ_ROLES), async (req, res) => {
    const familyId = String(req.params.familyId);
    const family = getContractFamily(familyId);
    if (!family) return res.status(404).json({ error: "Contract family not found." });

    const snapshot = await getConnectorRegistrySnapshot();
    const matching = BUILT_IN_CONNECTORS.filter((c) =>
      c.capabilities.some((cap) => cap.contractFamily === familyId),
    ).map((c) => ({
      ...c,
      health: snapshot.health.find((h) => h.connectorId === c.id) ?? null,
    }));

    res.json(matching);
  });

  // ─── Engine declarations ────────────────────────────────────────────────

  /** All engine contract declarations. */
  app.get("/api/readiness/engine-declarations", requireRole(...READ_ROLES), async (_req, res) => {
    res.json(ENGINE_CONTRACT_DECLARATIONS);
  });
}
