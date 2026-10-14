import type { Express } from "express";
import { requireRole } from "./auth";
import {
  getConnectorById,
  getConnectorRegistrySnapshot,
  getConnectorsByCapability,
} from "./connectorService";

export function registerConnectorRoutes(app: Express): void {
  // Full registry snapshot: connectors + health
  app.get("/api/admin/connectors", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (_req, res) => {
    const snapshot = await getConnectorRegistrySnapshot();
    res.json(snapshot);
  });

  // Single connector detail
  app.get("/api/admin/connectors/:id", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const id = String(req.params.id);
    const connector = getConnectorById(id);
    if (!connector) return res.status(404).json({ error: "Connector not found." });
    res.json(connector);
  });

  // Connectors that can satisfy a given contract family
  app.get("/api/admin/connectors/by-capability/:contractFamily", requireRole("internal_admin", "internal_analyst", "internal_compliance"), async (req, res) => {
    const contractFamily = String(req.params.contractFamily);
    const connectors = getConnectorsByCapability(contractFamily);
    res.json(connectors);
  });
}
